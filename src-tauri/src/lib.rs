mod ai_settings;
mod app_state;
mod commands;
mod db;
mod error;
mod models;
mod notifications;
mod reminders;
mod scheduler;
mod settings;
mod translator;
mod tray;

use app_state::AppState;
use chrono::Utc;
use reminders::ReminderRepository;
use scheduler::Scheduler;
use settings::SettingsRepository;
use tauri::{Manager, WindowEvent};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_dir)?;
            let conn = db::open(&app_dir.join("passion.sqlite3"))?;
            let state = AppState::new(conn, Scheduler::default());
            let future_reminders = {
                let conn = state
                    .conn
                    .lock()
                    .map_err(|err| error::BackendError::Database(err.to_string()))?;
                let now = Utc::now();
                ReminderRepository::mark_due_pending_as_expired(&conn, now)?;
                ReminderRepository::pending_future_enabled(&conn, now)?
            };

            let app_handle = app.handle().clone();
            tauri::async_runtime::block_on(async {
                for reminder in future_reminders {
                    commands::schedule_existing_reminder(
                        app_handle.clone(),
                        state.clone(),
                        reminder,
                    )
                    .await;
                }
            });

            app.manage(state);
            tray::setup(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if should_minimize_to_tray(window) {
                    api.prevent_close();
                    if let Err(err) = window.hide() {
                        eprintln!("failed to hide window on close: {err}");
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_reminders,
            commands::create_reminder,
            commands::toggle_reminder,
            commands::delete_reminder,
            commands::get_settings,
            commands::update_settings,
            commands::test_notification,
            commands::get_ai_settings,
            commands::update_ai_settings,
            commands::translate_text,
            commands::test_ai_connection,
            greet,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn should_minimize_to_tray<R: tauri::Runtime>(window: &tauri::Window<R>) -> bool {
    let Some(state) = window.app_handle().try_state::<AppState>() else {
        return true;
    };
    let Ok(conn) = state.conn.lock() else {
        return true;
    };
    SettingsRepository::get(&conn)
        .map(|settings| settings.minimize_to_tray)
        .unwrap_or(true)
}
