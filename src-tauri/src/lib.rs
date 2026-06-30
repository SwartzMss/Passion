mod ai_settings;
mod app_log;
mod app_state;
mod commands;
mod db;
mod downloader;
mod error;
mod http_tester;
mod models;
mod network_diagnostics;
mod reminders;
mod scheduler;
mod script_runner;
mod script_task_scheduler;
mod script_tasks;
mod settings;
mod ssh_tunnels;
mod translator;
mod tray;
mod workday_calendar;

use app_state::AppState;
use chrono::Utc;
use reminders::ReminderRepository;
use scheduler::Scheduler;
use settings::SettingsRepository;
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_dir)?;
            let db_path = app_dir.join("passion.sqlite3");
            let log_path = app_dir.join("passion.log");
            app_log::info(
                &log_path,
                format!(
                    "startup app_dir={} db={} log={}",
                    app_dir.display(),
                    db_path.display(),
                    log_path.display()
                ),
            );
            let conn = db::open(&db_path)?;
            let state = AppState::new_with_log_path(conn, Scheduler::default(), log_path.clone());
            let future_reminders = {
                let conn = state
                    .conn
                    .lock()
                    .map_err(|err| error::BackendError::Database(err.to_string()))?;
                let now = Utc::now();
                let expired = ReminderRepository::mark_due_pending_as_expired(&conn, now)?;
                let future = ReminderRepository::pending_future_enabled(&conn, now)?;
                app_log::info(
                    &log_path,
                    format!(
                        "startup reminder reconcile expired={} scheduled={}",
                        expired.len(),
                        future.len()
                    ),
                );
                future
            };
            let enabled_script_tasks = {
                let conn = state
                    .conn
                    .lock()
                    .map_err(|err| error::BackendError::Database(err.to_string()))?;
                script_tasks::ScriptTaskRepository::enabled(&conn)?
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
                for task in enabled_script_tasks {
                    commands::schedule_existing_script_task(state.clone(), task).await;
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
            commands::update_reminder,
            commands::toggle_reminder,
            commands::delete_reminder,
            commands::get_settings,
            commands::update_settings,
            commands::get_ai_settings,
            commands::update_ai_settings,
            commands::translate_text,
            commands::test_ai_connection,
            commands::check_port,
            commands::inspect_port_occupancy,
            commands::inspect_process_ports,
            commands::send_http_request,
            commands::get_ssh_tunnel_settings,
            commands::update_ssh_tunnel_settings,
            commands::list_ssh_tunnels,
            commands::create_ssh_tunnel,
            commands::update_ssh_tunnel,
            commands::delete_ssh_tunnel,
            commands::start_ssh_tunnel,
            commands::stop_ssh_tunnel,
            commands::download_file,
            commands::pause_download,
            commands::cancel_download,
            commands::get_default_download_dir,
            commands::list_script_tasks,
            commands::create_script_task,
            commands::set_script_task_enabled,
            commands::delete_script_task,
            commands::run_script_task_now,
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
