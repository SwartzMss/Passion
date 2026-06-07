use crate::error::{BackendError, BackendResult};
use crate::models::{NewScriptTask, ScriptTask};
use crate::script_runner::ScriptExecutionResult;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::path::Path;
use uuid::Uuid;

pub struct ScriptTaskRepository;

const LAST_STARTED_AT_COLUMN_INDEX: usize = 5;
const LAST_FINISHED_AT_COLUMN_INDEX: usize = 6;
const CREATED_AT_COLUMN_INDEX: usize = 11;
const UPDATED_AT_COLUMN_INDEX: usize = 12;

impl ScriptTaskRepository {
    pub fn create(conn: &Connection, input: NewScriptTask) -> BackendResult<ScriptTask> {
        let name = input.name.trim().to_string();
        let script_path = input.script_path.trim().to_string();
        validate_name(&name)?;
        validate_script_path(&script_path)?;
        validate_interval(input.interval_minutes)?;

        let now = Utc::now();
        let task = ScriptTask {
            id: Uuid::new_v4().to_string(),
            name,
            script_path,
            interval_minutes: input.interval_minutes,
            enabled: input.enabled,
            last_started_at: None,
            last_finished_at: None,
            last_exit_code: None,
            last_stdout: None,
            last_stderr: None,
            last_error: None,
            created_at: now,
            updated_at: now,
        };

        conn.execute(
            "INSERT INTO script_tasks (
                id, name, script_path, interval_minutes, enabled,
                last_started_at, last_finished_at, last_exit_code, last_stdout, last_stderr,
                last_error, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, NULL, NULL, NULL, NULL, ?6, ?7)",
            params![
                task.id,
                task.name,
                task.script_path,
                task.interval_minutes,
                task.enabled,
                task.created_at.timestamp_millis(),
                task.updated_at.timestamp_millis(),
            ],
        )
        .map_err(|err| BackendError::Database(err.to_string()))?;

        Self::get(conn, &task.id)
    }

    pub fn list(conn: &Connection) -> BackendResult<Vec<ScriptTask>> {
        let mut stmt = conn
            .prepare("SELECT * FROM script_tasks ORDER BY created_at DESC")
            .map_err(|err| BackendError::Database(err.to_string()))?;
        let rows = stmt
            .query_map([], Self::from_row)
            .map_err(|err| BackendError::Database(err.to_string()))?;

        rows.map(|row| row.map_err(|err| BackendError::Database(err.to_string())))
            .collect()
    }

    pub fn enabled(conn: &Connection) -> BackendResult<Vec<ScriptTask>> {
        let mut stmt = conn
            .prepare("SELECT * FROM script_tasks WHERE enabled = 1 ORDER BY created_at DESC")
            .map_err(|err| BackendError::Database(err.to_string()))?;
        let rows = stmt
            .query_map([], Self::from_row)
            .map_err(|err| BackendError::Database(err.to_string()))?;

        rows.map(|row| row.map_err(|err| BackendError::Database(err.to_string())))
            .collect()
    }

    pub fn get(conn: &Connection, id: &str) -> BackendResult<ScriptTask> {
        conn.query_row(
            "SELECT * FROM script_tasks WHERE id = ?1",
            [id],
            Self::from_row,
        )
        .optional()
        .map_err(|err| BackendError::Database(err.to_string()))?
        .ok_or_else(script_task_not_found)
    }

    pub fn set_enabled(conn: &Connection, id: &str, enabled: bool) -> BackendResult<ScriptTask> {
        let count = conn
            .execute(
                "UPDATE script_tasks SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
                params![enabled, Utc::now().timestamp_millis(), id],
            )
            .map_err(|err| BackendError::Database(err.to_string()))?;
        if count == 0 {
            return Err(script_task_not_found());
        }
        Self::get(conn, id)
    }

    pub fn delete(conn: &Connection, id: &str) -> BackendResult<()> {
        let count = conn
            .execute("DELETE FROM script_tasks WHERE id = ?1", [id])
            .map_err(|err| BackendError::Database(err.to_string()))?;
        if count == 0 {
            return Err(script_task_not_found());
        }
        Ok(())
    }

    pub fn record_execution_result(
        conn: &Connection,
        id: &str,
        result: &ScriptExecutionResult,
    ) -> BackendResult<ScriptTask> {
        let count = conn
            .execute(
                "UPDATE script_tasks
                 SET last_started_at = ?1,
                     last_finished_at = ?2,
                     last_exit_code = ?3,
                     last_stdout = ?4,
                     last_stderr = ?5,
                     last_error = ?6,
                     updated_at = ?2
                 WHERE id = ?7",
                params![
                    result.started_at.timestamp_millis(),
                    result.finished_at.timestamp_millis(),
                    result.exit_code,
                    result.stdout,
                    result.stderr,
                    result.error,
                    id,
                ],
            )
            .map_err(|err| BackendError::Database(err.to_string()))?;
        if count == 0 {
            return Err(script_task_not_found());
        }
        Self::get(conn, id)
    }

    fn from_row(row: &Row<'_>) -> rusqlite::Result<ScriptTask> {
        Ok(ScriptTask {
            id: row.get("id")?,
            name: row.get("name")?,
            script_path: row.get("script_path")?,
            interval_minutes: row.get("interval_minutes")?,
            enabled: row.get("enabled")?,
            last_started_at: optional_millis_to_datetime(
                row.get("last_started_at")?,
                LAST_STARTED_AT_COLUMN_INDEX,
            )?,
            last_finished_at: optional_millis_to_datetime(
                row.get("last_finished_at")?,
                LAST_FINISHED_AT_COLUMN_INDEX,
            )?,
            last_exit_code: row.get("last_exit_code")?,
            last_stdout: row.get("last_stdout")?,
            last_stderr: row.get("last_stderr")?,
            last_error: row.get("last_error")?,
            created_at: millis_to_datetime(row.get("created_at")?, CREATED_AT_COLUMN_INDEX)?,
            updated_at: millis_to_datetime(row.get("updated_at")?, UPDATED_AT_COLUMN_INDEX)?,
        })
    }
}

pub fn validate_script_path(script_path: &str) -> BackendResult<()> {
    if script_path.trim().is_empty() {
        return Err(BackendError::ScriptTask("脚本路径不能为空。".to_string()));
    }
    let extension = Path::new(script_path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);
    if !matches!(extension.as_deref(), Some("ps1" | "bat" | "cmd" | "exe")) {
        return Err(BackendError::ScriptTask(
            "仅支持 .ps1、.bat、.cmd、.exe。".to_string(),
        ));
    }
    Ok(())
}

fn validate_name(name: &str) -> BackendResult<()> {
    if name.trim().is_empty() {
        return Err(BackendError::ScriptTask("任务名不能为空。".to_string()));
    }
    Ok(())
}

fn validate_interval(interval_minutes: u32) -> BackendResult<()> {
    if interval_minutes == 0 {
        return Err(BackendError::ScriptTask("执行间隔必须大于 0。".to_string()));
    }
    Ok(())
}

fn script_task_not_found() -> BackendError {
    BackendError::ScriptTask("脚本任务不存在。".to_string())
}

fn optional_millis_to_datetime(
    millis: Option<i64>,
    column_index: usize,
) -> rusqlite::Result<Option<DateTime<Utc>>> {
    millis
        .map(|value| millis_to_datetime(value, column_index))
        .transpose()
}

fn millis_to_datetime(millis: i64, column_index: usize) -> rusqlite::Result<DateTime<Utc>> {
    DateTime::<Utc>::from_timestamp_millis(millis).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            column_index,
            rusqlite::types::Type::Integer,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid script task timestamp millis {millis}"),
            )),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::error::BackendError;
    use crate::models::NewScriptTask;
    use crate::script_runner::ScriptExecutionResult;
    use chrono::Duration;

    #[test]
    fn create_trims_and_lists_script_tasks() {
        let conn = db::test_connection();

        let task = ScriptTaskRepository::create(
            &conn,
            NewScriptTask {
                name: "  Backup  ".to_string(),
                script_path: "  C:\\tools\\backup.ps1  ".to_string(),
                interval_minutes: 15,
                enabled: true,
            },
        )
        .unwrap();

        assert_eq!(task.name, "Backup");
        assert_eq!(task.script_path, "C:\\tools\\backup.ps1");
        assert_eq!(task.interval_minutes, 15);
        assert!(task.enabled);
        assert!(task.last_started_at.is_none());

        let listed = ScriptTaskRepository::list(&conn).unwrap();
        assert_eq!(listed, vec![task]);
    }

    #[test]
    fn create_rejects_invalid_input() {
        let conn = db::test_connection();

        let cases = [
            (
                NewScriptTask {
                    name: " ".to_string(),
                    script_path: "C:\\tools\\a.ps1".to_string(),
                    interval_minutes: 1,
                    enabled: true,
                },
                "任务名不能为空。",
            ),
            (
                NewScriptTask {
                    name: "A".to_string(),
                    script_path: " ".to_string(),
                    interval_minutes: 1,
                    enabled: true,
                },
                "脚本路径不能为空。",
            ),
            (
                NewScriptTask {
                    name: "A".to_string(),
                    script_path: "C:\\tools\\a.txt".to_string(),
                    interval_minutes: 1,
                    enabled: true,
                },
                "仅支持 .ps1、.bat、.cmd、.exe。",
            ),
            (
                NewScriptTask {
                    name: "A".to_string(),
                    script_path: "C:\\tools\\a.ps1".to_string(),
                    interval_minutes: 0,
                    enabled: true,
                },
                "执行间隔必须大于 0。",
            ),
        ];

        for (input, expected) in cases {
            let err = ScriptTaskRepository::create(&conn, input).unwrap_err();
            assert!(matches!(err, BackendError::ScriptTask(message) if message == expected));
        }
    }

    #[test]
    fn set_enabled_and_delete_round_trip() {
        let conn = db::test_connection();
        let task = ScriptTaskRepository::create(
            &conn,
            NewScriptTask {
                name: "Backup".to_string(),
                script_path: "C:\\tools\\backup.cmd".to_string(),
                interval_minutes: 10,
                enabled: false,
            },
        )
        .unwrap();

        let enabled = ScriptTaskRepository::set_enabled(&conn, &task.id, true).unwrap();
        assert!(enabled.enabled);

        ScriptTaskRepository::delete(&conn, &task.id).unwrap();
        assert!(ScriptTaskRepository::list(&conn).unwrap().is_empty());
    }

    #[test]
    fn delete_rejects_missing_task() {
        let conn = db::test_connection();

        let err = ScriptTaskRepository::delete(&conn, "missing").unwrap_err();

        assert!(matches!(err, BackendError::ScriptTask(message) if message == "脚本任务不存在。"));
    }

    #[test]
    fn record_execution_result_updates_last_run_fields() {
        let conn = db::test_connection();
        let task = ScriptTaskRepository::create(
            &conn,
            NewScriptTask {
                name: "Backup".to_string(),
                script_path: "C:\\tools\\backup.exe".to_string(),
                interval_minutes: 10,
                enabled: true,
            },
        )
        .unwrap();
        let started_at = Utc::now();
        let finished_at = started_at + Duration::seconds(2);
        let result = ScriptExecutionResult {
            started_at,
            finished_at,
            exit_code: Some(7),
            stdout: Some("ok".to_string()),
            stderr: Some("warn".to_string()),
            error: None,
        };

        let updated =
            ScriptTaskRepository::record_execution_result(&conn, &task.id, &result).unwrap();

        assert_eq!(
            updated.last_started_at.unwrap().timestamp_millis(),
            started_at.timestamp_millis()
        );
        assert_eq!(
            updated.last_finished_at.unwrap().timestamp_millis(),
            finished_at.timestamp_millis()
        );
        assert_eq!(updated.last_exit_code, Some(7));
        assert_eq!(updated.last_stdout, Some("ok".to_string()));
        assert_eq!(updated.last_stderr, Some("warn".to_string()));
        assert_eq!(updated.last_error, None);
    }
}
