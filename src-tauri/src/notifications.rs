use crate::error::{BackendError, BackendResult};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

pub fn send_test_notification(app: &AppHandle) -> BackendResult<()> {
    app.notification()
        .builder()
        .title("Passion")
        .body("系统通知可以正常使用。")
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
