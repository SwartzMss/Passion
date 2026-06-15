use crate::ai_settings::AiSettingsRepository;
use crate::app_state::AppState;
use crate::error::{BackendError, ErrorPayload};
use crate::models::{
    AiSettings, DownloadRequest, DownloadResult, NewReminder, NewScriptTask, PingRequest,
    PingResult, PortCheckRequest, PortCheckResult, PortOccupancyRequest, PortOccupancyResult,
    Reminder, ScriptTask, Settings, SystemSnapshot, TranslationRequest, TranslationResult,
};
use crate::notifications;
use crate::reminders::ReminderRepository;
use crate::script_tasks::ScriptTaskRepository;
use crate::settings::SettingsRepository;
use chrono::Utc;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

type CommandResult<T> = Result<T, ErrorPayload>;

#[tauri::command]
pub async fn list_reminders(state: State<'_, AppState>) -> CommandResult<Vec<Reminder>> {
    list_reminders_after_reconciling_due(state.inner()).map_err(ErrorPayload::from)
}

fn list_reminders_after_reconciling_due(
    state: &AppState,
) -> crate::error::BackendResult<Vec<Reminder>> {
    let conn = state
        .conn
        .lock()
        .map_err(|err| BackendError::Database(err.to_string()))?;
    let expired = ReminderRepository::mark_due_pending_as_expired(&conn, Utc::now())?;
    if !expired.is_empty() {
        crate::app_log::info(
            state.log_path.as_path(),
            format!("list_reminders reconciled expired={}", expired.len()),
        );
    }
    ReminderRepository::list(&conn)
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
    crate::app_log::info(
        state.log_path.as_path(),
        format!(
            "create_reminder id={} title={} remind_at={}",
            reminder.id, reminder.title, reminder.remind_at
        ),
    );

    schedule_reminder(app, state.inner().clone(), reminder.clone()).await;
    Ok(reminder)
}

#[tauri::command]
pub async fn update_reminder(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    input: NewReminder,
) -> CommandResult<Reminder> {
    let reminder = {
        let conn = state
            .conn
            .lock()
            .map_err(|err| BackendError::Database(err.to_string()))?;
        ReminderRepository::update(&conn, &id, input).map_err(ErrorPayload::from)?
    };
    state.scheduler.cancel(&id).await;
    if reminder.enabled && reminder.status == crate::models::ReminderStatus::Pending {
        schedule_reminder(app, state.inner().clone(), reminder.clone()).await;
    }
    crate::app_log::info(
        state.log_path.as_path(),
        format!(
            "update_reminder id={} title={} remind_at={}",
            reminder.id, reminder.title, reminder.remind_at
        ),
    );
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
    crate::app_log::info(
        state.log_path.as_path(),
        format!("toggle_reminder id={} enabled={}", id, enabled),
    );

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
    crate::app_log::info(state.log_path.as_path(), format!("delete_reminder id={id}"));
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
    let previous = save_settings_and_get_previous(state.inner(), &settings)?;
    if previous.launch_on_startup != settings.launch_on_startup {
        if let Err(err) = crate::settings::sync_autostart(&app, settings.launch_on_startup) {
            rollback_settings(state.inner(), &previous);
            return Err(ErrorPayload::from(err));
        }
    }
    Ok(settings)
}

#[tauri::command]
pub async fn test_notification(app: AppHandle) -> CommandResult<()> {
    notifications::send_test_notification(&app).map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn get_ai_settings(state: State<'_, AppState>) -> CommandResult<AiSettings> {
    let conn = state
        .conn
        .lock()
        .map_err(|err| BackendError::Database(err.to_string()))?;
    AiSettingsRepository::get(&conn).map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn update_ai_settings(
    state: State<'_, AppState>,
    settings: AiSettings,
) -> CommandResult<AiSettings> {
    crate::translator::validate_ai_settings(&settings).map_err(ErrorPayload::from)?;
    let conn = state
        .conn
        .lock()
        .map_err(|err| BackendError::Database(err.to_string()))?;
    AiSettingsRepository::save(&conn, &settings).map_err(ErrorPayload::from)?;
    Ok(settings)
}

#[tauri::command]
pub async fn translate_text(
    state: State<'_, AppState>,
    input: TranslationRequest,
) -> CommandResult<TranslationResult> {
    let settings = {
        let conn = state
            .conn
            .lock()
            .map_err(|err| BackendError::Database(err.to_string()))?;
        AiSettingsRepository::get(&conn).map_err(ErrorPayload::from)?
    };
    crate::translator::translate(&settings, &input)
        .await
        .map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn test_ai_connection(state: State<'_, AppState>) -> CommandResult<()> {
    let settings = {
        let conn = state
            .conn
            .lock()
            .map_err(|err| BackendError::Database(err.to_string()))?;
        AiSettingsRepository::get(&conn).map_err(ErrorPayload::from)?
    };
    crate::translator::test_connection(&settings)
        .await
        .map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn ping_host(input: PingRequest) -> CommandResult<PingResult> {
    crate::network_diagnostics::ping_host(input)
        .await
        .map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn check_port(input: PortCheckRequest) -> CommandResult<PortCheckResult> {
    crate::network_diagnostics::check_port(input)
        .await
        .map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn inspect_port_occupancy(
    input: PortOccupancyRequest,
) -> CommandResult<PortOccupancyResult> {
    crate::network_diagnostics::inspect_port_occupancy(input)
        .await
        .map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn download_file(
    app: AppHandle,
    input: DownloadRequest,
) -> CommandResult<DownloadResult> {
    crate::downloader::download_file(&app, input)
        .await
        .map_err(ErrorPayload::from)
}

#[tauri::command]
pub fn pause_download(task_id: String) -> CommandResult<()> {
    crate::downloader::pause_download(&task_id).map_err(ErrorPayload::from)
}

#[tauri::command]
pub fn get_default_download_dir(app: AppHandle) -> CommandResult<String> {
    crate::downloader::default_download_dir(&app).map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn get_system_snapshot() -> CommandResult<SystemSnapshot> {
    Ok(crate::system_monitor::get_system_snapshot())
}

#[tauri::command]
pub async fn list_script_tasks(state: State<'_, AppState>) -> CommandResult<Vec<ScriptTask>> {
    let conn = state
        .conn
        .lock()
        .map_err(|err| BackendError::Database(err.to_string()))?;
    ScriptTaskRepository::list(&conn).map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn create_script_task(
    state: State<'_, AppState>,
    input: NewScriptTask,
) -> CommandResult<ScriptTask> {
    let task = {
        let conn = state
            .conn
            .lock()
            .map_err(|err| BackendError::Database(err.to_string()))?;
        ScriptTaskRepository::create(&conn, input).map_err(ErrorPayload::from)?
    };
    if task.enabled {
        schedule_script_task(state.inner().clone(), task.clone()).await;
    }
    Ok(task)
}

#[tauri::command]
pub async fn set_script_task_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> CommandResult<ScriptTask> {
    let task = {
        let conn = state
            .conn
            .lock()
            .map_err(|err| BackendError::Database(err.to_string()))?;
        ScriptTaskRepository::set_enabled(&conn, &id, enabled).map_err(ErrorPayload::from)?
    };
    if task.enabled {
        schedule_script_task(state.inner().clone(), task.clone()).await;
    } else {
        state.script_task_scheduler.cancel(&task.id).await;
    }
    Ok(task)
}

#[tauri::command]
pub async fn delete_script_task(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    {
        let conn = state
            .conn
            .lock()
            .map_err(|err| BackendError::Database(err.to_string()))?;
        ScriptTaskRepository::delete(&conn, &id).map_err(ErrorPayload::from)?;
    }
    state.script_task_scheduler.cancel(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn run_script_task_now(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<ScriptTask> {
    let task = {
        let conn = state
            .conn
            .lock()
            .map_err(|err| BackendError::Database(err.to_string()))?;
        ScriptTaskRepository::get(&conn, &id).map_err(ErrorPayload::from)?
    };
    let state_for_run = state.inner().clone();
    let id_for_run = task.id.clone();
    let result = state
        .script_task_scheduler
        .run_if_idle(&task.id, move || {
            let state = state_for_run.clone();
            let id = id_for_run.clone();
            async move { execute_script_task(state, id).await }
        })
        .await
        .ok_or_else(|| {
            ErrorPayload::from(BackendError::ScriptTask("脚本任务正在运行。".to_string()))
        })?;
    result.map_err(ErrorPayload::from)
}

async fn schedule_reminder(app: AppHandle, state: AppState, reminder: Reminder) {
    crate::app_log::info(
        state.log_path.as_path(),
        format!(
            "schedule_reminder id={} title={} remind_at={} status={} enabled={}",
            reminder.id,
            reminder.title,
            reminder.remind_at,
            reminder.status.as_str(),
            reminder.enabled
        ),
    );
    let app_for_callback = app.clone();
    let state_for_callback = state.clone();
    let log_path = state.log_path.clone();
    let scheduler = state.scheduler.clone();
    scheduler
        .schedule(reminder, move |id| {
            crate::app_log::info(log_path.as_path(), format!("reminder_timer_fired id={id}"));
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

pub async fn schedule_existing_script_task(state: AppState, task: ScriptTask) {
    schedule_script_task(state, task).await;
}

async fn schedule_script_task(state: AppState, task: ScriptTask) {
    let scheduler = state.script_task_scheduler.clone();
    scheduler
        .schedule(&task, move |id| {
            let state = state.clone();
            async move {
                if let Err(err) = execute_script_task(state, id).await {
                    eprintln!("failed to execute scheduled script task: {err}");
                }
            }
        })
        .await;
}

async fn execute_script_task(
    state: AppState,
    id: String,
) -> crate::error::BackendResult<ScriptTask> {
    let task = {
        let conn = state
            .conn
            .lock()
            .map_err(|err| BackendError::Database(err.to_string()))?;
        ScriptTaskRepository::get(&conn, &id)?
    };
    let result = crate::script_runner::run_script(&task).await;
    let conn = state
        .conn
        .lock()
        .map_err(|err| BackendError::Database(err.to_string()))?;
    ScriptTaskRepository::record_execution_result(&conn, &id, &result)
}

async fn dispatch_triggered_reminder(
    app: AppHandle,
    state: AppState,
    id: String,
) -> crate::error::BackendResult<()> {
    crate::app_log::info(
        state.log_path.as_path(),
        format!("dispatch_triggered_reminder id={id}"),
    );
    let Some(reminder) = mark_reminder_triggered(&state, &id)? else {
        crate::app_log::warn(
            state.log_path.as_path(),
            format!("dispatch_triggered_reminder skipped id={id} reason=not_due_pending_enabled"),
        );
        return Ok(());
    };

    crate::app_log::info(
        state.log_path.as_path(),
        format!("dispatch_triggered_reminder marked id={}", reminder.id),
    );
    if let Err(err) = show_reminder_window(&app, &reminder) {
        crate::app_log::error(
            state.log_path.as_path(),
            format!("show_reminder_window failed id={} error={err}", reminder.id),
        );
    }
    if let Err(err) = emit_reminder_triggered(&app, &reminder) {
        eprintln!("failed to emit reminder_triggered event: {err}");
        crate::app_log::error(
            state.log_path.as_path(),
            format!(
                "emit reminder_triggered failed id={} error={err}",
                reminder.id
            ),
        );
    } else {
        crate::app_log::info(
            state.log_path.as_path(),
            format!("emit reminder_triggered ok id={}", reminder.id),
        );
    }
    if let Some(next) = reschedule_repeating_reminder(&state, &reminder)? {
        crate::app_log::info(
            state.log_path.as_path(),
            format!(
                "reschedule_repeating_reminder previous_id={} next_at={}",
                reminder.id, next.remind_at
            ),
        );
        std::thread::spawn(move || {
            tauri::async_runtime::block_on(schedule_reminder(app, state, next));
        });
    }

    Ok(())
}

fn emit_reminder_triggered(
    app: &AppHandle,
    reminder: &Reminder,
) -> crate::error::BackendResult<()> {
    app.emit("reminder_triggered", reminder.clone())
        .map_err(|err| BackendError::Window(err.to_string()))
}

fn show_reminder_window(app: &AppHandle, reminder: &Reminder) -> crate::error::BackendResult<()> {
    let label = reminder_window_label(&reminder.id);
    if let Some(window) = app.get_webview_window(&label) {
        window
            .close()
            .map_err(|err| BackendError::Window(err.to_string()))?;
    }
    WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App(reminder_window_path(&reminder.id)),
    )
    .title("提醒")
    .inner_size(340.0, 160.0)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .transparent(true)
    .focused(true)
    .center()
    .build()
    .map_err(|err| BackendError::Window(err.to_string()))?;
    Ok(())
}

fn reminder_window_label(id: &str) -> String {
    format!("reminder-{id}")
}

fn reminder_window_path(id: &str) -> PathBuf {
    format!("index.html?reminderId={id}").into()
}

fn reschedule_repeating_reminder(
    state: &AppState,
    reminder: &Reminder,
) -> crate::error::BackendResult<Option<Reminder>> {
    let conn = state
        .conn
        .lock()
        .map_err(|err| BackendError::Database(err.to_string()))?;
    ReminderRepository::reschedule_after_trigger(&conn, reminder, Utc::now())
}

fn mark_reminder_triggered(
    state: &AppState,
    id: &str,
) -> crate::error::BackendResult<Option<Reminder>> {
    let conn = state
        .conn
        .lock()
        .map_err(|err| BackendError::Database(err.to_string()))?;
    let Some(reminder) =
        ReminderRepository::mark_due_pending_enabled_as_triggered(&conn, id, Utc::now())?
    else {
        return Ok(None);
    };
    Ok(Some(reminder))
}

fn save_settings_and_get_previous(
    state: &AppState,
    settings: &Settings,
) -> crate::error::BackendResult<Settings> {
    let conn = state
        .conn
        .lock()
        .map_err(|err| BackendError::Database(err.to_string()))?;
    let previous = SettingsRepository::get(&conn)?;
    SettingsRepository::save(&conn, settings)?;
    Ok(previous)
}

fn rollback_settings(state: &AppState, previous: &Settings) {
    let result = state
        .conn
        .lock()
        .map_err(|err| BackendError::Database(err.to_string()))
        .and_then(|conn| SettingsRepository::save(&conn, previous));
    if let Err(err) = result {
        eprintln!("failed to roll back settings after startup sync failure: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::models::{NewReminder, ReminderPriority, ReminderRepeatRule, ReminderStatus};
    use crate::scheduler::Scheduler;
    use chrono::{Duration, Utc};

    #[test]
    fn trigger_dispatch_marks_reminder_without_native_notification_settings() {
        let conn = db::test_connection();
        let reminder = insert_raw(&conn, "Stretch", -5, true, ReminderStatus::Pending);
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

        let triggered = mark_reminder_triggered(&state, &reminder).unwrap().unwrap();

        assert_eq!(triggered.id, reminder);
        assert_eq!(triggered.status, ReminderStatus::Triggered);
        assert!(triggered.triggered_at.is_some());
    }

    #[test]
    fn listing_reminders_reconciles_due_pending_reminders() {
        let conn = db::test_connection();
        let due = insert_raw(&conn, "Missed", -5, true, ReminderStatus::Pending);
        let future = insert_raw(&conn, "Future", 5, true, ReminderStatus::Pending);
        let state = AppState::new(conn, Scheduler::default());

        let reminders = list_reminders_after_reconciling_due(&state).unwrap();

        let due = reminders
            .iter()
            .find(|reminder| reminder.id == due)
            .expect("due reminder should be listed");
        let future = reminders
            .iter()
            .find(|reminder| reminder.id == future)
            .expect("future reminder should be listed");
        assert_ne!(due.status, ReminderStatus::Pending);
        assert_eq!(future.status, ReminderStatus::Pending);
    }

    #[test]
    fn trigger_dispatch_skips_future_reminder() {
        let conn = db::test_connection();
        let reminder = ReminderRepository::create(
            &conn,
            NewReminder {
                title: "Stretch".to_string(),
                notes: None,
                remind_at: Utc::now() + Duration::minutes(5),
                priority: ReminderPriority::Medium,
                repeat_rule: ReminderRepeatRule::Once,
            },
        )
        .unwrap();
        let state = AppState::new(conn, Scheduler::default());

        let result = mark_reminder_triggered(&state, &reminder.id).unwrap();

        assert!(result.is_none());
    }

    #[test]
    fn reminder_window_uses_stable_label_and_query_url() {
        let id = "8d9b3616-f4d9-4a49-a096-a7c2c9c13f70";

        assert_eq!(
            reminder_window_label(id),
            "reminder-8d9b3616-f4d9-4a49-a096-a7c2c9c13f70"
        );
        assert_eq!(
            reminder_window_path(id),
            PathBuf::from("index.html?reminderId=8d9b3616-f4d9-4a49-a096-a7c2c9c13f70")
        );
    }

    #[test]
    fn save_settings_returns_previous_settings() {
        let conn = db::test_connection();
        let previous = Settings {
            launch_on_startup: true,
            minimize_to_tray: false,
            notification_enabled: true,
        };
        let next = Settings {
            launch_on_startup: false,
            minimize_to_tray: true,
            notification_enabled: false,
        };
        SettingsRepository::save(&conn, &previous).unwrap();
        let state = AppState::new(conn, Scheduler::default());

        let returned = save_settings_and_get_previous(&state, &next).unwrap();
        let saved = {
            let conn = state.conn.lock().unwrap();
            SettingsRepository::get(&conn).unwrap()
        };

        assert_eq!(returned, previous);
        assert_eq!(saved, next);
    }

    #[test]
    fn dispatch_reschedules_cn_workday_reminder() {
        let conn = db::test_connection();
        let id = insert_raw_with_repeat(
            &conn,
            "Standup",
            -5,
            true,
            ReminderStatus::Triggered,
            ReminderRepeatRule::CnWorkday,
        );
        let state = AppState::new(conn, Scheduler::default());
        let reminder = {
            let conn = state.conn.lock().unwrap();
            ReminderRepository::get(&conn, &id).unwrap()
        };

        let next = reschedule_repeating_reminder(&state, &reminder)
            .unwrap()
            .unwrap();

        assert_eq!(next.status, ReminderStatus::Pending);
        assert!(next.remind_at > Utc::now());
        assert_eq!(next.repeat_rule, ReminderRepeatRule::CnWorkday);
    }

    fn insert_raw(
        conn: &rusqlite::Connection,
        title: &str,
        offset_minutes: i64,
        enabled: bool,
        status: ReminderStatus,
    ) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        conn.execute(
            "INSERT INTO reminders (id, title, notes, remind_at, enabled, status, repeat_rule, created_at, updated_at, triggered_at)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, 'once', ?6, ?7, NULL)",
            (
                &id,
                title,
                (now + Duration::minutes(offset_minutes)).timestamp_millis(),
                enabled,
                status.as_str(),
                now.timestamp_millis(),
                now.timestamp_millis(),
            ),
        )
        .unwrap();
        id
    }

    fn insert_raw_with_repeat(
        conn: &rusqlite::Connection,
        title: &str,
        offset_minutes: i64,
        enabled: bool,
        status: ReminderStatus,
        repeat_rule: ReminderRepeatRule,
    ) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        conn.execute(
            "INSERT INTO reminders (id, title, notes, remind_at, enabled, status, repeat_rule, created_at, updated_at, triggered_at)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, NULL)",
            (
                &id,
                title,
                (now + Duration::minutes(offset_minutes)).timestamp_millis(),
                enabled,
                status.as_str(),
                repeat_rule.as_str(),
                now.timestamp_millis(),
                now.timestamp_millis(),
            ),
        )
        .unwrap();
        id
    }
}
