use crate::error::{BackendError, BackendResult};
use crate::models::Reminder;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

pub fn send_reminder_notification(app: &AppHandle, reminder: &Reminder) -> BackendResult<()> {
    let body = reminder
        .notes
        .as_deref()
        .filter(|notes| !notes.is_empty())
        .unwrap_or("Your reminder is due.");

    app.notification()
        .builder()
        .title(reminder.title.as_str())
        .body(body)
        .show()
        .map_err(|err| BackendError::Notification(err.to_string()))
}

pub fn send_test_notification(app: &AppHandle) -> BackendResult<()> {
    app.notification()
        .builder()
        .title("Passion")
        .body("Notifications are working.")
        .show()
        .map_err(|err| BackendError::Notification(err.to_string()))
}

pub fn show_main_window(app: &AppHandle) -> BackendResult<()> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| BackendError::Window("main window was not found".to_string()))?;
    window
        .show()
        .map_err(|err| BackendError::Window(err.to_string()))?;
    window
        .set_focus()
        .map_err(|err| BackendError::Window(err.to_string()))?;
    Ok(())
}
