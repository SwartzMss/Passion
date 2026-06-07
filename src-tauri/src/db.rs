use crate::error::{BackendError, BackendResult};
use rusqlite::Connection;
use std::path::Path;

pub fn open(path: &Path) -> BackendResult<Connection> {
    let conn = Connection::open(path).map_err(|err| BackendError::Database(err.to_string()))?;
    migrate(&conn)?;
    Ok(conn)
}

pub fn migrate(conn: &Connection) -> BackendResult<()> {
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS reminders (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            notes TEXT,
            remind_at INTEGER NOT NULL,
            enabled INTEGER NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending', 'triggered', 'expired')),
            repeat_rule TEXT NOT NULL DEFAULT 'once' CHECK (repeat_rule IN ('once', 'cn_workday')),
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            triggered_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_reminders_schedule
        ON reminders (status, enabled, remind_at);

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS script_tasks (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            script_path TEXT NOT NULL,
            interval_minutes INTEGER NOT NULL,
            enabled INTEGER NOT NULL,
            last_started_at INTEGER,
            last_finished_at INTEGER,
            last_exit_code INTEGER,
            last_stdout TEXT,
            last_stderr TEXT,
            last_error TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_script_tasks_enabled
        ON script_tasks (enabled);
        ",
    )
    .map_err(|err| BackendError::Database(err.to_string()))?;
    add_column_if_missing(
        conn,
        "reminders",
        "repeat_rule",
        "ALTER TABLE reminders ADD COLUMN repeat_rule TEXT NOT NULL DEFAULT 'once' CHECK (repeat_rule IN ('once', 'cn_workday'))",
    )?;
    Ok(())
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    statement: &str,
) -> BackendResult<()> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|err| BackendError::Database(err.to_string()))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|err| BackendError::Database(err.to_string()))?;
    for row in rows {
        if row.map_err(|err| BackendError::Database(err.to_string()))? == column {
            return Ok(());
        }
    }
    conn.execute(statement, [])
        .map_err(|err| BackendError::Database(err.to_string()))?;
    Ok(())
}

#[cfg(test)]
pub fn test_connection() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn).unwrap();
    conn
}
