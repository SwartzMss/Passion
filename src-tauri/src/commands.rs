use crate::app_state::AppState;
use crate::error::{BackendError, ErrorPayload};
use crate::models::{NewReminder, Reminder, Settings};
use crate::reminders::ReminderRepository;
use crate::settings::SettingsRepository;
use tauri::State;

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

    schedule_reminder(state.inner().clone(), reminder.clone()).await;
    Ok(reminder)
}

#[tauri::command]
pub async fn toggle_reminder(
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
        schedule_reminder(state.inner().clone(), reminder.clone()).await;
    } else {
        state.scheduler.cancel(&id).await;
    }

    Ok(reminder)
}

#[tauri::command]
pub async fn delete_reminder(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    state.scheduler.cancel(&id).await;
    let conn = state
        .conn
        .lock()
        .map_err(|err| BackendError::Database(err.to_string()))?;
    ReminderRepository::delete(&conn, &id).map_err(ErrorPayload::from)
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
    state: State<'_, AppState>,
    settings: Settings,
) -> CommandResult<Settings> {
    let conn = state
        .conn
        .lock()
        .map_err(|err| BackendError::Database(err.to_string()))?;
    SettingsRepository::save(&conn, &settings).map_err(ErrorPayload::from)?;
    Ok(settings)
}

#[tauri::command]
pub async fn test_notification() -> CommandResult<()> {
    Ok(())
}

async fn schedule_reminder(state: AppState, reminder: Reminder) {
    state
        .scheduler
        .schedule(reminder, move |id| {
            eprintln!("reminder fired: {id}");
        })
        .await;
}
