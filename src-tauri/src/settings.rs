use crate::error::{BackendError, BackendResult};
use crate::models::Settings;
use rusqlite::{params, Connection};
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

pub struct SettingsRepository;

impl SettingsRepository {
    pub fn get(conn: &Connection) -> BackendResult<Settings> {
        Ok(Settings {
            launch_on_startup: read_bool(conn, "launch_on_startup")?.unwrap_or(false),
            minimize_to_tray: read_bool(conn, "minimize_to_tray")?.unwrap_or(true),
        })
    }

    pub fn save(conn: &Connection, settings: &Settings) -> BackendResult<()> {
        write_bool(conn, "launch_on_startup", settings.launch_on_startup)?;
        write_bool(conn, "minimize_to_tray", settings.minimize_to_tray)?;
        Ok(())
    }
}

pub fn sync_autostart(app: &AppHandle, enabled: bool) -> BackendResult<()> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable()
    } else {
        manager.disable()
    }
    .map_err(|err| BackendError::Startup(err.to_string()))
}

fn read_bool(conn: &Connection, key: &str) -> BackendResult<Option<bool>> {
    let value: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|err| BackendError::Database(err.to_string()))?;
    match value.as_deref() {
        None => Ok(None),
        Some("true") => Ok(Some(true)),
        Some("false") => Ok(Some(false)),
        Some(other) => Err(BackendError::Database(format!(
            "invalid setting {key} value {other}"
        ))),
    }
}

fn write_bool(conn: &Connection, key: &str, value: bool) -> BackendResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, if value { "true" } else { "false" }],
    )
    .map_err(|err| BackendError::Database(err.to_string()))?;
    Ok(())
}

use rusqlite::OptionalExtension;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn get_returns_defaults_when_settings_are_missing() {
        let conn = db::test_connection();

        let settings = SettingsRepository::get(&conn).unwrap();

        assert_eq!(settings, Settings::default());
    }

    #[test]
    fn update_round_trips_settings() {
        let conn = db::test_connection();
        let settings = Settings {
            launch_on_startup: true,
            minimize_to_tray: false,
        };

        SettingsRepository::save(&conn, &settings).unwrap();

        assert_eq!(SettingsRepository::get(&conn).unwrap(), settings);
    }

    #[test]
    fn get_rejects_invalid_persisted_bool_values() {
        let conn = db::test_connection();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params!["launch_on_startup", "maybe"],
        )
        .unwrap();

        let err = SettingsRepository::get(&conn).unwrap_err();

        assert!(matches!(err, BackendError::Database(_)));
    }

    #[test]
    fn save_updates_existing_settings() {
        let conn = db::test_connection();
        let first_settings = Settings {
            launch_on_startup: true,
            minimize_to_tray: false,
        };
        let second_settings = Settings {
            launch_on_startup: false,
            minimize_to_tray: true,
        };

        SettingsRepository::save(&conn, &first_settings).unwrap();
        SettingsRepository::save(&conn, &second_settings).unwrap();

        assert_eq!(SettingsRepository::get(&conn).unwrap(), second_settings);
    }

    #[test]
    fn save_stores_bool_values_as_true_false_strings() {
        let conn = db::test_connection();
        let settings = Settings {
            launch_on_startup: true,
            minimize_to_tray: false,
        };

        SettingsRepository::save(&conn, &settings).unwrap();

        assert_eq!(stored_setting(&conn, "launch_on_startup"), "true");
        assert_eq!(stored_setting(&conn, "minimize_to_tray"), "false");
    }

    fn stored_setting(conn: &rusqlite::Connection, key: &str) -> String {
        conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .unwrap()
    }
}
