use crate::error::{BackendError, BackendResult};
use crate::models::AiSettings;
use rusqlite::{params, Connection, OptionalExtension};

pub struct AiSettingsRepository;

impl AiSettingsRepository {
    pub fn get(conn: &Connection) -> BackendResult<AiSettings> {
        let defaults = AiSettings::default();
        Ok(AiSettings {
            base_url: read_string(conn, "ai_base_url")?.unwrap_or(defaults.base_url),
            model: read_string(conn, "ai_model")?.unwrap_or(defaults.model),
            api_key: read_string(conn, "ai_api_key")?.unwrap_or(defaults.api_key),
        })
    }

    pub fn save(conn: &Connection, settings: &AiSettings) -> BackendResult<()> {
        write_string(conn, "ai_base_url", settings.base_url.trim())?;
        write_string(conn, "ai_model", settings.model.trim())?;
        write_string(conn, "ai_api_key", settings.api_key.as_str())?;
        Ok(())
    }
}

fn read_string(conn: &Connection, key: &str) -> BackendResult<Option<String>> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .optional()
    .map_err(|err| BackendError::Database(err.to_string()))
}

fn write_string(conn: &Connection, key: &str, value: &str) -> BackendResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|err| BackendError::Database(err.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn get_returns_defaults_when_ai_settings_are_missing() {
        let conn = db::test_connection();

        let settings = AiSettingsRepository::get(&conn).unwrap();

        assert_eq!(settings, AiSettings::default());
    }

    #[test]
    fn save_round_trips_ai_settings() {
        let conn = db::test_connection();
        let settings = AiSettings {
            base_url: "http://localhost:1234/v1".to_string(),
            model: "local-model".to_string(),
            api_key: "secret".to_string(),
        };

        AiSettingsRepository::save(&conn, &settings).unwrap();

        assert_eq!(AiSettingsRepository::get(&conn).unwrap(), settings);
    }
}
