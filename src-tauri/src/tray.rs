use crate::error::{BackendError, BackendResult};
use tauri::menu::MenuBuilder;
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

const SHOW_ID: &str = "show_passion";
const EXIT_ID: &str = "exit";

pub fn setup(app: &AppHandle) -> BackendResult<()> {
    let menu = MenuBuilder::new(app)
        .text(SHOW_ID, "显示 Passion")
        .separator()
        .text(EXIT_ID, "退出")
        .build()
        .map_err(|err| BackendError::Window(err.to_string()))?;

    let icon = app
        .default_window_icon()
        .ok_or_else(|| BackendError::Window("default window icon was not found".to_string()))?;

    TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .icon(icon.clone())
        .tooltip("Passion")
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW_ID => {
                if let Err(err) = show_main_window(app) {
                    eprintln!("failed to show main window from tray: {err}");
                }
            }
            EXIT_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if should_show_main_window_from_tray_event(&event) {
                if let Err(err) = show_main_window(tray.app_handle()) {
                    eprintln!("failed to show main window from tray double click: {err}");
                }
            }
        })
        .build(app)
        .map_err(|err| BackendError::Window(err.to_string()))?;

    Ok(())
}

fn should_show_main_window_from_tray_event(event: &TrayIconEvent) -> bool {
    matches!(
        event,
        TrayIconEvent::DoubleClick {
            button: MouseButton::Left,
            ..
        }
    )
}

fn run_window_activation(
    show: impl FnOnce() -> BackendResult<()>,
    focus: impl FnOnce() -> BackendResult<()>,
) -> BackendResult<()> {
    show()?;
    focus()?;
    Ok(())
}

pub(crate) fn show_main_window(app: &AppHandle) -> BackendResult<()> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| BackendError::Window("main window was not found".to_string()))?;
    run_window_activation(
        || {
            window
                .show()
                .map_err(|err| BackendError::Window(err.to_string()))
        },
        || {
            window
                .set_focus()
                .map_err(|err| BackendError::Window(err.to_string()))
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use tauri::{tray::TrayIconId, PhysicalPosition, PhysicalSize, Position, Rect, Size};

    #[test]
    fn window_activation_shows_before_focusing() {
        let operations = RefCell::new(Vec::new());

        run_window_activation(
            || {
                operations.borrow_mut().push("show");
                Ok(())
            },
            || {
                operations.borrow_mut().push("focus");
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(*operations.borrow(), vec!["show", "focus"]);
    }

    #[test]
    fn window_activation_stops_when_show_fails() {
        let focused = Cell::new(false);

        let result = run_window_activation(
            || Err(BackendError::Window("show failed".to_string())),
            || {
                focused.set(true);
                Ok(())
            },
        );

        assert!(result.is_err());
        assert!(!focused.get());
    }

    #[test]
    fn left_double_click_shows_main_window() {
        let event = TrayIconEvent::DoubleClick {
            id: TrayIconId::new("main"),
            position: PhysicalPosition::new(0.0, 0.0),
            rect: Rect {
                position: Position::Physical(PhysicalPosition::new(0, 0)),
                size: Size::Physical(PhysicalSize::new(16, 16)),
            },
            button: MouseButton::Left,
        };

        assert!(should_show_main_window_from_tray_event(&event));
    }

    #[test]
    fn right_double_click_does_not_show_main_window() {
        let event = TrayIconEvent::DoubleClick {
            id: TrayIconId::new("main"),
            position: PhysicalPosition::new(0.0, 0.0),
            rect: Rect {
                position: Position::Physical(PhysicalPosition::new(0, 0)),
                size: Size::Physical(PhysicalSize::new(16, 16)),
            },
            button: MouseButton::Right,
        };

        assert!(!should_show_main_window_from_tray_event(&event));
    }
}
