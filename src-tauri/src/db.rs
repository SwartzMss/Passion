use crate::error::{BackendError, BackendResult};
use rusqlite::Connection;
use std::path::Path;

pub fn open(path: &Path) -> BackendResult<Connection> {
    let conn = Connection::open(path).map_err(|err| BackendError::Database(err.to_string()))?;
    initialize_schema(&conn)?;
    Ok(conn)
}

pub fn initialize_schema(conn: &Connection) -> BackendResult<()> {
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
            priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
            repeat_rule TEXT NOT NULL DEFAULT 'once' CHECK (repeat_rule IN ('once', 'daily', 'cn_workday')),
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
            script_args TEXT,
            schedule_type TEXT NOT NULL DEFAULT 'interval' CHECK (schedule_type IN ('interval', 'daily', 'weekly')),
            interval_minutes INTEGER NOT NULL,
            time_of_day TEXT,
            weekdays TEXT,
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

        CREATE TABLE IF NOT EXISTS ssh_tunnels (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            local_port INTEGER NOT NULL,
            bind_address TEXT NOT NULL CHECK (bind_address IN ('127.0.0.1', '0.0.0.0')),
            remote_host TEXT NOT NULL,
            remote_port INTEGER NOT NULL,
            username TEXT NOT NULL,
            key_path TEXT NOT NULL,
            auth_type TEXT NOT NULL DEFAULT 'private_key' CHECK (auth_type IN ('private_key')),
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_ssh_tunnels_name
        ON ssh_tunnels (name);
        ",
    )
    .map_err(|err| BackendError::Database(err.to_string()))?;
    Ok(())
}

#[cfg(test)]
pub fn test_connection() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    initialize_schema(&conn).unwrap();
    conn
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialize_schema_allows_supported_reminder_repeat_rules_only() {
        let conn = Connection::open_in_memory().unwrap();

        initialize_schema(&conn).unwrap();

        conn.execute(
            "INSERT INTO reminders (id, title, notes, remind_at, enabled, status, repeat_rule, created_at, updated_at, triggered_at)
             VALUES ('1', 'Daily', NULL, 1, 1, 'pending', 'daily', 1, 1, NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO reminders (id, title, notes, remind_at, enabled, status, repeat_rule, created_at, updated_at, triggered_at)
             VALUES ('2', 'Workday', NULL, 1, 1, 'pending', 'cn_workday', 1, 1, NULL)",
            [],
        )
        .unwrap();
        let weekly_result = conn.execute(
            "INSERT INTO reminders (id, title, notes, remind_at, enabled, status, repeat_rule, created_at, updated_at, triggered_at)
             VALUES ('3', 'Weekly', NULL, 1, 1, 'pending', 'weekly:1,3', 1, 1, NULL)",
            [],
        );
        assert!(weekly_result.is_err());
    }

    #[test]
    fn initialize_schema_allows_script_task_schedule_columns() {
        let conn = Connection::open_in_memory().unwrap();

        initialize_schema(&conn).unwrap();

        conn.execute(
            "INSERT INTO script_tasks (
                id, name, script_path, schedule_type, interval_minutes, time_of_day, weekdays, enabled,
                created_at, updated_at
             ) VALUES ('1', 'Daily', 'C:\\tools\\daily.ps1', 'daily', 15, '09:30', NULL, 1, 1, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO script_tasks (
                id, name, script_path, schedule_type, interval_minutes, time_of_day, weekdays, enabled,
                created_at, updated_at
             ) VALUES ('2', 'Weekly', 'C:\\tools\\weekly.ps1', 'weekly', 15, '18:00', '1,5', 1, 1, 1)",
            [],
        )
        .unwrap();
    }

    #[test]
    fn initialize_schema_allows_script_task_args_column() {
        let conn = Connection::open_in_memory().unwrap();

        initialize_schema(&conn).unwrap();

        conn.execute(
            "INSERT INTO script_tasks (
                id, name, script_path, script_args, schedule_type, interval_minutes, enabled,
                created_at, updated_at
             ) VALUES ('1', 'Py', 'C:\\tools\\sync.py', '--name test', 'interval', 15, 1, 1, 1)",
            [],
        )
        .unwrap();
    }

    #[test]
    fn initialize_schema_allows_ssh_tunnels_table() {
        let conn = Connection::open_in_memory().unwrap();

        initialize_schema(&conn).unwrap();

        conn.execute(
            "INSERT INTO ssh_tunnels (
                id, name, description, local_port, bind_address, remote_host, remote_port,
                username, key_path, auth_type, created_at, updated_at
             ) VALUES (
                '1', 'QNX调试', 'debug tunnel', 8080, '127.0.0.1', '172.31.3.1', 22,
                'root', 'C:\\keys\\8797_rsa2048', 'private_key', 1, 1
             )",
            [],
        )
        .unwrap();
    }

    #[test]
    fn initialize_schema_rejects_invalid_ssh_tunnel_bind_address() {
        let conn = Connection::open_in_memory().unwrap();

        initialize_schema(&conn).unwrap();

        let result = conn.execute(
            "INSERT INTO ssh_tunnels (
                id, name, local_port, bind_address, remote_host, remote_port,
                username, key_path, auth_type, created_at, updated_at
             ) VALUES (
                '1', 'Bad', 8080, '192.168.1.2', '172.31.3.1', 22,
                'root', 'C:\\keys\\8797_rsa2048', 'private_key', 1, 1
             )",
            [],
        );

        assert!(result.is_err());
    }

    #[test]
    fn initialize_schema_rejects_duplicate_ssh_tunnel_names() {
        let conn = Connection::open_in_memory().unwrap();

        initialize_schema(&conn).unwrap();

        for id in ["1", "2"] {
            let result = conn.execute(
                "INSERT INTO ssh_tunnels (
                    id, name, local_port, bind_address, remote_host, remote_port,
                    username, key_path, auth_type, created_at, updated_at
                 ) VALUES (
                    ?1, 'QNX调试', 8080, '127.0.0.1', '172.31.3.1', 22,
                    'root', 'C:\\keys\\8797_rsa2048', 'private_key', 1, 1
                 )",
                [id],
            );
            if id == "1" {
                result.unwrap();
            } else {
                assert!(result.is_err());
            }
        }
    }
}
