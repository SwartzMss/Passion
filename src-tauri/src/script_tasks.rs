use crate::error::{BackendError, BackendResult};
use crate::models::{NewScriptTask, ScriptTask};
use crate::script_runner::ScriptExecutionResult;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::path::Path;
use uuid::Uuid;

pub struct ScriptTaskRepository;

const LAST_STARTED_AT_COLUMN_INDEX: usize = 8;
const LAST_FINISHED_AT_COLUMN_INDEX: usize = 9;
const CREATED_AT_COLUMN_INDEX: usize = 14;
const UPDATED_AT_COLUMN_INDEX: usize = 15;
const DEFAULT_INTERVAL_MINUTES: u32 = 15;

impl ScriptTaskRepository {
    pub fn create(conn: &Connection, input: NewScriptTask) -> BackendResult<ScriptTask> {
        let name = input.name.trim().to_string();
        let script_path = input.script_path.trim().to_string();
        let schedule = normalize_schedule(&input)?;
        validate_name(&name)?;
        validate_script_path(&script_path)?;

        let now = Utc::now();
        let task = ScriptTask {
            id: Uuid::new_v4().to_string(),
            name,
            script_path,
            schedule_type: schedule.schedule_type,
            interval_minutes: schedule.interval_minutes,
            time_of_day: schedule.time_of_day,
            weekdays: schedule.weekdays,
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

        let weekdays = weekdays_to_string(task.weekdays.as_deref());
        conn.execute(
            "INSERT INTO script_tasks (
                id, name, script_path, schedule_type, interval_minutes, time_of_day, weekdays, enabled,
                last_started_at, last_finished_at, last_exit_code, last_stdout, last_stderr,
                last_error, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, NULL, NULL, NULL, NULL, ?9, ?10)",
            params![
                &task.id,
                &task.name,
                &task.script_path,
                &task.schedule_type,
                task.interval_minutes,
                &task.time_of_day,
                weekdays,
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
            schedule_type: row.get("schedule_type")?,
            interval_minutes: row.get("interval_minutes")?,
            time_of_day: row.get("time_of_day")?,
            weekdays: parse_weekdays(row.get::<_, Option<String>>("weekdays")?.as_deref())
                .map_err(|err| {
                    rusqlite::Error::FromSqlConversionFailure(
                        row.as_ref()
                            .column_index("weekdays")
                            .unwrap_or(UPDATED_AT_COLUMN_INDEX),
                        rusqlite::types::Type::Text,
                        Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, err)),
                    )
                })?,
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

struct NormalizedSchedule {
    schedule_type: String,
    interval_minutes: u32,
    time_of_day: Option<String>,
    weekdays: Option<Vec<u8>>,
}

fn normalize_schedule(input: &NewScriptTask) -> BackendResult<NormalizedSchedule> {
    match input.schedule_type.as_str() {
        "interval" => {
            let interval_minutes = input.interval_minutes.unwrap_or(0);
            validate_interval(interval_minutes)?;
            Ok(NormalizedSchedule {
                schedule_type: "interval".to_string(),
                interval_minutes,
                time_of_day: None,
                weekdays: None,
            })
        }
        "daily" => Ok(NormalizedSchedule {
            schedule_type: "daily".to_string(),
            interval_minutes: input.interval_minutes.unwrap_or(DEFAULT_INTERVAL_MINUTES),
            time_of_day: Some(validate_time_of_day(input.time_of_day.as_deref())?),
            weekdays: None,
        }),
        "weekly" => {
            let weekdays = validate_weekdays(input.weekdays.as_deref())?;
            Ok(NormalizedSchedule {
                schedule_type: "weekly".to_string(),
                interval_minutes: input.interval_minutes.unwrap_or(DEFAULT_INTERVAL_MINUTES),
                time_of_day: Some(validate_time_of_day(input.time_of_day.as_deref())?),
                weekdays: Some(weekdays),
            })
        }
        _ => Err(BackendError::ScriptTask(
            "执行方式必须是每隔一段时间、每天或每周。".to_string(),
        )),
    }
}

fn validate_time_of_day(value: Option<&str>) -> BackendResult<String> {
    let value = value.unwrap_or("").trim();
    let Some((hour, minute)) = value.split_once(':') else {
        return Err(BackendError::ScriptTask(
            "执行时间格式必须是 HH:mm。".to_string(),
        ));
    };
    let hour = hour
        .parse::<u8>()
        .map_err(|_| BackendError::ScriptTask("执行时间格式必须是 HH:mm。".to_string()))?;
    let minute = minute
        .parse::<u8>()
        .map_err(|_| BackendError::ScriptTask("执行时间格式必须是 HH:mm。".to_string()))?;
    if hour > 23 || minute > 59 {
        return Err(BackendError::ScriptTask(
            "执行时间格式必须是 HH:mm。".to_string(),
        ));
    }
    Ok(format!("{hour:02}:{minute:02}"))
}

fn validate_weekdays(value: Option<&[u8]>) -> BackendResult<Vec<u8>> {
    let mut weekdays = value.unwrap_or(&[]).to_vec();
    weekdays.sort_unstable();
    weekdays.dedup();
    if weekdays.is_empty() {
        return Err(BackendError::ScriptTask(
            "每周执行至少选择一天。".to_string(),
        ));
    }
    if weekdays.iter().any(|weekday| !(1..=7).contains(weekday)) {
        return Err(BackendError::ScriptTask(
            "每周执行日期必须在周一到周日之间。".to_string(),
        ));
    }
    Ok(weekdays)
}

fn weekdays_to_string(weekdays: Option<&[u8]>) -> Option<String> {
    weekdays.map(|days| days.iter().map(u8::to_string).collect::<Vec<_>>().join(","))
}

fn parse_weekdays(value: Option<&str>) -> Result<Option<Vec<u8>>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.trim().is_empty() {
        return Ok(None);
    }
    value
        .split(',')
        .map(|part| {
            part.parse::<u8>()
                .map_err(|_| format!("invalid script task weekday {part}"))
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Some)
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
                schedule_type: "interval".to_string(),
                interval_minutes: Some(15),
                time_of_day: None,
                weekdays: None,
                enabled: true,
            },
        )
        .unwrap();

        assert_eq!(task.name, "Backup");
        assert_eq!(task.script_path, "C:\\tools\\backup.ps1");
        assert_eq!(task.interval_minutes, 15);
        assert_eq!(task.schedule_type, "interval");
        assert_eq!(task.time_of_day, None);
        assert_eq!(task.weekdays, None);
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
                    schedule_type: "interval".to_string(),
                    interval_minutes: Some(1),
                    time_of_day: None,
                    weekdays: None,
                    enabled: true,
                },
                "任务名不能为空。",
            ),
            (
                NewScriptTask {
                    name: "A".to_string(),
                    script_path: " ".to_string(),
                    schedule_type: "interval".to_string(),
                    interval_minutes: Some(1),
                    time_of_day: None,
                    weekdays: None,
                    enabled: true,
                },
                "脚本路径不能为空。",
            ),
            (
                NewScriptTask {
                    name: "A".to_string(),
                    script_path: "C:\\tools\\a.txt".to_string(),
                    schedule_type: "interval".to_string(),
                    interval_minutes: Some(1),
                    time_of_day: None,
                    weekdays: None,
                    enabled: true,
                },
                "仅支持 .ps1、.bat、.cmd、.exe。",
            ),
            (
                NewScriptTask {
                    name: "A".to_string(),
                    script_path: "C:\\tools\\a.ps1".to_string(),
                    schedule_type: "interval".to_string(),
                    interval_minutes: Some(0),
                    time_of_day: None,
                    weekdays: None,
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
    fn create_accepts_daily_and_weekly_script_tasks() {
        let conn = db::test_connection();

        let daily = ScriptTaskRepository::create(
            &conn,
            NewScriptTask {
                name: "Daily".to_string(),
                script_path: "C:\\tools\\daily.ps1".to_string(),
                schedule_type: "daily".to_string(),
                interval_minutes: None,
                time_of_day: Some("09:30".to_string()),
                weekdays: None,
                enabled: true,
            },
        )
        .unwrap();
        assert_eq!(daily.schedule_type, "daily");
        assert_eq!(daily.time_of_day, Some("09:30".to_string()));

        let weekly = ScriptTaskRepository::create(
            &conn,
            NewScriptTask {
                name: "Weekly".to_string(),
                script_path: "C:\\tools\\weekly.ps1".to_string(),
                schedule_type: "weekly".to_string(),
                interval_minutes: None,
                time_of_day: Some("18:00".to_string()),
                weekdays: Some(vec![1, 5]),
                enabled: true,
            },
        )
        .unwrap();
        assert_eq!(weekly.schedule_type, "weekly");
        assert_eq!(weekly.weekdays, Some(vec![1, 5]));
    }

    #[test]
    fn set_enabled_and_delete_round_trip() {
        let conn = db::test_connection();
        let task = ScriptTaskRepository::create(
            &conn,
            NewScriptTask {
                name: "Backup".to_string(),
                script_path: "C:\\tools\\backup.cmd".to_string(),
                schedule_type: "interval".to_string(),
                interval_minutes: Some(10),
                time_of_day: None,
                weekdays: None,
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
                schedule_type: "interval".to_string(),
                interval_minutes: Some(10),
                time_of_day: None,
                weekdays: None,
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
