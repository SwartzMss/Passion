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
            repeat_rule TEXT NOT NULL DEFAULT 'once' CHECK (repeat_rule IN ('once', 'daily', 'cn_workday') OR repeat_rule GLOB 'weekly:[1-7]*'),
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
        "ALTER TABLE reminders ADD COLUMN repeat_rule TEXT NOT NULL DEFAULT 'once' CHECK (repeat_rule IN ('once', 'daily', 'cn_workday') OR repeat_rule GLOB 'weekly:[1-7]*')",
    )?;
    relax_reminder_repeat_rule_check(conn)?;
    Ok(())
}

fn relax_reminder_repeat_rule_check(conn: &Connection) -> BackendResult<()> {
    let schema: String = conn
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'reminders'",
            [],
            |row| row.get(0),
        )
        .map_err(|err| BackendError::Database(err.to_string()))?;
    if !schema.contains("repeat_rule IN ('once', 'cn_workday')") {
        return Ok(());
    }

    conn.execute_batch(
        "
        DROP INDEX IF EXISTS idx_reminders_schedule;

        CREATE TABLE reminders_next (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            notes TEXT,
            remind_at INTEGER NOT NULL,
            enabled INTEGER NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending', 'triggered', 'expired')),
            repeat_rule TEXT NOT NULL DEFAULT 'once' CHECK (repeat_rule IN ('once', 'daily', 'cn_workday') OR repeat_rule GLOB 'weekly:[1-7]*'),
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            triggered_at INTEGER
        );

        INSERT INTO reminders_next (id, title, notes, remind_at, enabled, status, repeat_rule, created_at, updated_at, triggered_at)
        SELECT id, title, notes, remind_at, enabled, status, repeat_rule, created_at, updated_at, triggered_at
        FROM reminders;

        DROP TABLE reminders;
        ALTER TABLE reminders_next RENAME TO reminders;

        CREATE INDEX IF NOT EXISTS idx_reminders_schedule
        ON reminders (status, enabled, remind_at);
        ",
    )
    .map_err(|err| BackendError::Database(err.to_string()))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_allows_daily_and_weekly_repeat_rules() {
        let conn = Connection::open_in_memory().unwrap();

        migrate(&conn).unwrap();

        conn.execute(
            "INSERT INTO reminders (id, title, notes, remind_at, enabled, status, repeat_rule, created_at, updated_at, triggered_at)
             VALUES ('1', 'Daily', NULL, 1, 1, 'pending', 'daily', 1, 1, NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO reminders (id, title, notes, remind_at, enabled, status, repeat_rule, created_at, updated_at, triggered_at)
             VALUES ('2', 'Weekly', NULL, 1, 1, 'pending', 'weekly:1,3', 1, 1, NULL)",
            [],
        )
        .unwrap();
    }
}
