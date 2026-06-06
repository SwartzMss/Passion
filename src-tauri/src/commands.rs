use crate::app_state::AppState;
use crate::error::{BackendError, ErrorPayload};
use crate::models::{NewReminder, Reminder, Settings};
use crate::notifications;
use crate::reminders::ReminderRepository;
use crate::settings::SettingsRepository;
use chrono::Utc;
use tauri::{AppHandle, Emitter, State};

type CommandResult<T> = Result<T, ErrorPayload>;

#[tauri::command]
pub async fn list_reminders(state: State<'_, AppState>) -> CommandResult<Vec<Reminder>> {
    let conn = state
        .conn
        .lock()
        .map_err(|err| BackendError::Database(err.to_string()))?;
    ReminderRepository::list(&conn).map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn create_reminder(
    app: AppHandle,
    state: State<'_, AppState>,
    input: NewReminder,
) -> CommandResult<Reminder> {
    let reminder = {
        let conn = state
            .conn
            .lock()
            .map_err(|err| BackendError::Database(err.to_string()))?;
        ReminderRepository::create(&conn, input).map_err(ErrorPayload::from)?
    };

    schedule_reminder(app, state.inner().clone(), reminder.clone()).await;
    Ok(reminder)
}

#[tauri::command]
pub async fn toggle_reminder(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> CommandResult<Reminder> {
    let reminder = {
        let conn = state
            .conn
            .lock()
            .map_err(|err| BackendError::Database(err.to_string()))?;
        ReminderRepository::set_enabled(&conn, &id, enabled).map_err(ErrorPayload::from)?
    };

    if enabled {
        schedule_reminder(app, state.inner().clone(), reminder.clone()).await;
    } else {
        state.scheduler.cancel(&id).await;
    }

    Ok(reminder)
}

#[tauri::command]
pub async fn delete_reminder(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    {
        let conn = state
            .conn
            .lock()
            .map_err(|err| BackendError::Database(err.to_string()))?;
        ReminderRepository::delete(&conn, &id).map_err(ErrorPayload::from)?;
    }
    state.scheduler.cancel(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> CommandResult<Settings> {
    let conn = state
        .conn
        .lock()
        .map_err(|err| BackendError::Database(err.to_string()))?;
    SettingsRepository::get(&conn).map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
) -> CommandResult<Settings> {
    crate::settings::sync_autostart(&app, settings.launch_on_startup)
        .map_err(ErrorPayload::from)?;
    {
        let conn = state
            .conn
            .lock()
            .map_err(|err| BackendError::Database(err.to_string()))?;
        SettingsRepository::save(&conn, &settings).map_err(ErrorPayload::from)?;
    }
    Ok(settings)
}

#[tauri::command]
pub async fn test_notification(app: AppHandle) -> CommandResult<()> {
    notifications::send_test_notification(&app).map_err(ErrorPayload::from)
}

async fn schedule_reminder(app: AppHandle, state: AppState, reminder: Reminder) {
    let app_for_callback = app.clone();
    let state_for_callback = state.clone();
    state
        .scheduler
        .schedule(reminder, move |id| {
            let app = app_for_callback.clone();
            let state = state_for_callback.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = dispatch_triggered_reminder(app, state, id).await {
                    eprintln!("failed to dispatch reminder: {err}");
                }
            });
        })
        .await;
}

pub async fn schedule_existing_reminder(app: AppHandle, state: AppState, reminder: Reminder) {
    schedule_reminder(app, state, reminder).await;
}

async fn dispatch_triggered_reminder(
    app: AppHandle,
    state: AppState,
    id: String,
) -> crate::error::BackendResult<()> {
    let (reminder, settings) = mark_reminder_triggered_and_load_settings(&state, &id)?;

    if settings.notification_enabled {
        if let Err(err) = notifications::send_reminder_notification(&app, &reminder) {
            eprintln!("failed to send reminder notification: {err}");
        }
    }
    if let Err(err) = notifications::show_main_window(&app) {
        eprintln!("failed to show main window for reminder: {err}");
    }
    if let Err(err) = app.emit("reminder_triggered", reminder) {
        eprintln!("failed to emit reminder_triggered event: {err}");
    }

    Ok(())
}

fn mark_reminder_triggered_and_load_settings(
    state: &AppState,
    id: &str,
) -> crate::error::BackendResult<(Reminder, Settings)> {
    let conn = state
        .conn
        .lock()
        .map_err(|err| BackendError::Database(err.to_string()))?;
    let reminder = ReminderRepository::mark_triggered(&conn, id, Utc::now())?;
    let settings = SettingsRepository::get(&conn)?;
    Ok((reminder, settings))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::models::{NewReminder, ReminderStatus};
    use crate::scheduler::Scheduler;
    use chrono::{Duration, Utc};

    #[test]
    fn trigger_dispatch_marks_reminder_and_loads_settings() {
        let conn = db::test_connection();
        let reminder = ReminderRepository::create(
            &conn,
            NewReminder {
                title: "Stretch".to_string(),
                notes: None,
                remind_at: Utc::now() + Duration::minutes(5),
            },
        )
        .unwrap();
        SettingsRepository::save(
            &conn,
            &Settings {
                launch_on_startup: true,
                minimize_to_tray: false,
                notification_enabled: false,
            },
        )
        .unwrap();
        let state = AppState::new(conn, Scheduler::default());

        let (triggered, settings) =
            mark_reminder_triggered_and_load_settings(&state, &reminder.id).unwrap();

        assert_eq!(triggered.id, reminder.id);
        assert_eq!(triggered.status, ReminderStatus::Triggered);
        assert!(triggered.triggered_at.is_some());
        assert!(settings.launch_on_startup);
        assert!(!settings.minimize_to_tray);
        assert!(!settings.notification_enabled);
    }
}
