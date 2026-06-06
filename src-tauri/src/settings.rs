use crate::error::{BackendError, BackendResult};
use crate::models::Settings;
use rusqlite::{params, Connection};

pub struct SettingsRepository;

impl SettingsRepository {
    pub fn get(conn: &Connection) -> BackendResult<Settings> {
        Ok(Settings {
            launch_on_startup: read_bool(conn, "launch_on_startup")?.unwrap_or(false),
            minimize_to_tray: read_bool(conn, "minimize_to_tray")?.unwrap_or(true),
            notification_enabled: read_bool(conn, "notification_enabled")?.unwrap_or(true),
        })
    }

    pub fn save(conn: &Connection, settings: &Settings) -> BackendResult<()> {
        write_bool(conn, "launch_on_startup", settings.launch_on_startup)?;
        write_bool(conn, "minimize_to_tray", settings.minimize_to_tray)?;
        write_bool(conn, "notification_enabled", settings.notification_enabled)?;
        Ok(())
    }
}

fn read_bool(conn: &Connection, key: &str) -> BackendResult<Option<bool>> {
    let value: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|err| BackendError::Database(err.to_string()))?;
    Ok(value.map(|value| value == "true"))
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
            notification_enabled: false,
        };

        SettingsRepository::save(&conn, &settings).unwrap();

        assert_eq!(SettingsRepository::get(&conn).unwrap(), settings);
    }
}
