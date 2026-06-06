mod app_state;
mod commands;
mod db;
mod error;
mod models;
mod reminders;
mod scheduler;
mod settings;

use app_state::AppState;
use scheduler::Scheduler;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_dir)?;
            let conn = db::open(&app_dir.join("passion.sqlite3"))?;
            app.manage(AppState::new(conn, Scheduler::default()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_reminders,
            commands::create_reminder,
            commands::toggle_reminder,
            commands::delete_reminder,
            commands::get_settings,
            commands::update_settings,
            commands::test_notification,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
