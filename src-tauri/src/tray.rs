use crate::error::{BackendError, BackendResult};
use crate::notifications;
use tauri::menu::MenuBuilder;
use tauri::tray::TrayIconBuilder;
use tauri::AppHandle;

const SHOW_ID: &str = "show_passion";
const TEST_NOTIFICATION_ID: &str = "test_notification";
const EXIT_ID: &str = "exit";

pub fn setup(app: &AppHandle) -> BackendResult<()> {
    let menu = MenuBuilder::new(app)
        .text(SHOW_ID, "显示 Passion")
        .text(TEST_NOTIFICATION_ID, "测试通知")
        .separator()
        .text(EXIT_ID, "退出")
        .build()
        .map_err(|err| BackendError::Window(err.to_string()))?;

    let icon = app
        .default_window_icon()
        .ok_or_else(|| BackendError::Window("default window icon was not found".to_string()))?;

    TrayIconBuilder::new()
        .menu(&menu)
        .icon(icon.clone())
        .tooltip("Passion")
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW_ID => {
                if let Err(err) = notifications::show_main_window(app) {
                    eprintln!("failed to show main window from tray: {err}");
                }
            }
            TEST_NOTIFICATION_ID => {
                if let Err(err) = notifications::send_test_notification(app) {
                    eprintln!("failed to send test notification from tray: {err}");
                }
            }
            EXIT_ID => app.exit(0),
            _ => {}
        })
        .build(app)
        .map_err(|err| BackendError::Window(err.to_string()))?;

    Ok(())
}
