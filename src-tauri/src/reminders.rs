use crate::error::{BackendError, BackendResult};
use crate::models::{NewReminder, Reminder, ReminderStatus};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;

pub struct ReminderRepository;

const REMIND_AT_COLUMN_INDEX: usize = 3;
const CREATED_AT_COLUMN_INDEX: usize = 6;
const UPDATED_AT_COLUMN_INDEX: usize = 7;
const TRIGGERED_AT_COLUMN_INDEX: usize = 8;

impl ReminderStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            ReminderStatus::Pending => "pending",
            ReminderStatus::Triggered => "triggered",
            ReminderStatus::Expired => "expired",
        }
    }

    fn from_db(value: &str) -> BackendResult<Self> {
        match value {
            "pending" => Ok(Self::Pending),
            "triggered" => Ok(Self::Triggered),
            "expired" => Ok(Self::Expired),
            other => Err(BackendError::Database(format!(
                "invalid reminder status {other}"
            ))),
        }
    }
}

impl ReminderRepository {
    pub fn create(conn: &Connection, input: NewReminder) -> BackendResult<Reminder> {
        let title = input.title.trim().to_string();
        if title.is_empty() {
            return Err(BackendError::EmptyTitle);
        }
        if input.remind_at <= Utc::now() {
            return Err(BackendError::ReminderTimeInPast);
        }

        let now = Utc::now();
        let reminder = Reminder {
            id: Uuid::new_v4().to_string(),
            title,
            notes: input
                .notes
                .map(|notes| notes.trim().to_string())
                .filter(|notes| !notes.is_empty()),
            remind_at: input.remind_at,
            enabled: true,
            status: ReminderStatus::Pending,
            created_at: now,
            updated_at: now,
            triggered_at: None,
        };

        conn.execute(
            "INSERT INTO reminders (id, title, notes, remind_at, enabled, status, created_at, updated_at, triggered_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)",
            params![
                reminder.id,
                reminder.title,
                reminder.notes,
                reminder.remind_at.timestamp_millis(),
                reminder.enabled,
                reminder.status.as_str(),
                reminder.created_at.timestamp_millis(),
                reminder.updated_at.timestamp_millis(),
            ],
        )
        .map_err(|err| BackendError::Database(err.to_string()))?;

        Self::get(conn, &reminder.id)
    }

    pub fn list(conn: &Connection) -> BackendResult<Vec<Reminder>> {
        let mut stmt = conn
            .prepare("SELECT * FROM reminders ORDER BY remind_at ASC")
            .map_err(|err| BackendError::Database(err.to_string()))?;
        let rows = stmt
            .query_map([], Self::from_row)
            .map_err(|err| BackendError::Database(err.to_string()))?;

        rows.map(|row| row.map_err(|err| BackendError::Database(err.to_string())))
            .collect()
    }

    pub fn get(conn: &Connection, id: &str) -> BackendResult<Reminder> {
        conn.query_row(
            "SELECT * FROM reminders WHERE id = ?1",
            [id],
            Self::from_row,
        )
        .optional()
        .map_err(|err| BackendError::Database(err.to_string()))?
        .ok_or(BackendError::ReminderNotFound)
    }

    pub fn set_enabled(conn: &Connection, id: &str, enabled: bool) -> BackendResult<Reminder> {
        let reminder = Self::get(conn, id)?;
        if enabled && reminder.remind_at <= Utc::now() {
            return Err(BackendError::ReminderTimeInPast);
        }

        conn.execute(
            "UPDATE reminders SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
            params![enabled, Utc::now().timestamp_millis(), id],
        )
        .map_err(|err| BackendError::Database(err.to_string()))?;
        Self::get(conn, id)
    }

    pub fn delete(conn: &Connection, id: &str) -> BackendResult<()> {
        let count = conn
            .execute("DELETE FROM reminders WHERE id = ?1", [id])
            .map_err(|err| BackendError::Database(err.to_string()))?;
        if count == 0 {
            return Err(BackendError::ReminderNotFound);
        }
        Ok(())
    }

    pub fn pending_future_enabled(
        conn: &Connection,
        now: DateTime<Utc>,
    ) -> BackendResult<Vec<Reminder>> {
        Self::query_by_clause(
            conn,
            "status = 'pending' AND enabled = 1 AND remind_at > ?1 ORDER BY remind_at ASC",
            now.timestamp_millis(),
        )
    }

    pub fn mark_triggered(
        conn: &Connection,
        id: &str,
        when: DateTime<Utc>,
    ) -> BackendResult<Reminder> {
        Self::mark_status(conn, id, ReminderStatus::Triggered, when)
    }

    pub fn mark_due_pending_enabled_as_triggered(
        conn: &Connection,
        id: &str,
        when: DateTime<Utc>,
    ) -> BackendResult<Option<Reminder>> {
        let count = conn
            .execute(
                "UPDATE reminders
                 SET status = ?1, triggered_at = ?2, updated_at = ?2
                 WHERE id = ?3 AND status = 'pending' AND enabled = 1 AND remind_at <= ?2",
                params![
                    ReminderStatus::Triggered.as_str(),
                    when.timestamp_millis(),
                    id
                ],
            )
            .map_err(|err| BackendError::Database(err.to_string()))?;
        if count == 0 {
            return Ok(None);
        }
        Self::get(conn, id).map(Some)
    }

    pub fn mark_due_pending_as_expired(
        conn: &Connection,
        now: DateTime<Utc>,
    ) -> BackendResult<Vec<Reminder>> {
        let due = Self::query_by_clause(
            conn,
            "status = 'pending' AND remind_at <= ?1 ORDER BY remind_at ASC",
            now.timestamp_millis(),
        )?;
        due.into_iter()
            .map(|reminder| Self::mark_status(conn, &reminder.id, ReminderStatus::Expired, now))
            .collect()
    }

    fn mark_status(
        conn: &Connection,
        id: &str,
        status: ReminderStatus,
        when: DateTime<Utc>,
    ) -> BackendResult<Reminder> {
        conn.execute(
            "UPDATE reminders SET status = ?1, triggered_at = ?2, updated_at = ?2 WHERE id = ?3",
            params![status.as_str(), when.timestamp_millis(), id],
        )
        .map_err(|err| BackendError::Database(err.to_string()))?;
        Self::get(conn, id)
    }

    fn query_by_clause(
        conn: &Connection,
        clause: &str,
        millis: i64,
    ) -> BackendResult<Vec<Reminder>> {
        let sql = format!("SELECT * FROM reminders WHERE {clause}");
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|err| BackendError::Database(err.to_string()))?;
        let rows = stmt
            .query_map([millis], Self::from_row)
            .map_err(|err| BackendError::Database(err.to_string()))?;
        rows.map(|row| row.map_err(|err| BackendError::Database(err.to_string())))
            .collect()
    }

    fn from_row(row: &Row<'_>) -> rusqlite::Result<Reminder> {
        let status: String = row.get("status")?;
        Ok(Reminder {
            id: row.get("id")?,
            title: row.get("title")?,
            notes: row.get("notes")?,
            remind_at: millis_to_datetime(row.get("remind_at")?, REMIND_AT_COLUMN_INDEX)?,
            enabled: row.get("enabled")?,
            status: ReminderStatus::from_db(&status).map_err(|err| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(err),
                )
            })?,
            created_at: millis_to_datetime(row.get("created_at")?, CREATED_AT_COLUMN_INDEX)?,
            updated_at: millis_to_datetime(row.get("updated_at")?, UPDATED_AT_COLUMN_INDEX)?,
            triggered_at: row
                .get::<_, Option<i64>>("triggered_at")?
                .map(|millis| millis_to_datetime(millis, TRIGGERED_AT_COLUMN_INDEX))
                .transpose()?,
        })
    }
}

fn millis_to_datetime(millis: i64, column_index: usize) -> rusqlite::Result<DateTime<Utc>> {
    DateTime::<Utc>::from_timestamp_millis(millis).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            column_index,
            rusqlite::types::Type::Integer,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid reminder timestamp millis {millis}"),
            )),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use chrono::Duration;

    #[test]
    fn create_rejects_empty_title() {
        let conn = db::test_connection();
        let input = NewReminder {
            title: "  ".to_string(),
            notes: None,
            remind_at: Utc::now() + Duration::minutes(5),
        };

        let err = ReminderRepository::create(&conn, input).unwrap_err();

        assert!(matches!(err, BackendError::EmptyTitle));
    }

    #[test]
    fn create_rejects_past_time() {
        let conn = db::test_connection();
        let input = NewReminder {
            title: "Past".to_string(),
            notes: None,
            remind_at: Utc::now() - Duration::minutes(1),
        };

        let err = ReminderRepository::create(&conn, input).unwrap_err();

        assert!(matches!(err, BackendError::ReminderTimeInPast));
    }

    #[test]
    fn create_list_toggle_delete_round_trip() {
        let conn = db::test_connection();
        let reminder = ReminderRepository::create(
            &conn,
            NewReminder {
                title: "Drink water".to_string(),
                notes: Some("Stand up first".to_string()),
                remind_at: Utc::now() + Duration::minutes(5),
            },
        )
        .unwrap();

        assert!(reminder.enabled);
        assert_eq!(reminder.status, ReminderStatus::Pending);

        let listed = ReminderRepository::list(&conn).unwrap();
        assert_eq!(listed.len(), 1);

        ReminderRepository::set_enabled(&conn, &reminder.id, false).unwrap();
        let disabled = ReminderRepository::get(&conn, &reminder.id).unwrap();
        assert!(!disabled.enabled);

        ReminderRepository::delete(&conn, &reminder.id).unwrap();
        assert!(ReminderRepository::list(&conn).unwrap().is_empty());
    }

    #[test]
    fn mark_expired_changes_only_due_pending_reminders() {
        let conn = db::test_connection();
        let due = insert_raw(&conn, "Due", -5, true, ReminderStatus::Pending);
        let future = insert_raw(&conn, "Future", 5, true, ReminderStatus::Pending);

        let expired = ReminderRepository::mark_due_pending_as_expired(&conn, Utc::now()).unwrap();

        assert_eq!(expired.len(), 1);
        assert_eq!(expired[0].id, due);
        assert_eq!(
            ReminderRepository::get(&conn, &future).unwrap().status,
            ReminderStatus::Pending
        );
    }

    #[test]
    fn set_enabled_rejects_past_reminder() {
        let conn = db::test_connection();
        let id = insert_raw(&conn, "Past", -5, false, ReminderStatus::Pending);

        let err = ReminderRepository::set_enabled(&conn, &id, true).unwrap_err();

        assert!(matches!(err, BackendError::ReminderTimeInPast));
    }

    #[test]
    fn pending_future_enabled_filters_and_orders() {
        let conn = db::test_connection();
        let now = Utc::now();
        let later = insert_raw_at(
            &conn,
            "Later",
            now + Duration::minutes(10),
            true,
            ReminderStatus::Pending,
            None,
        );
        let sooner = insert_raw_at(
            &conn,
            "Sooner",
            now + Duration::minutes(5),
            true,
            ReminderStatus::Pending,
            None,
        );
        insert_raw_at(
            &conn,
            "Disabled",
            now + Duration::minutes(3),
            false,
            ReminderStatus::Pending,
            None,
        );
        insert_raw_at(
            &conn,
            "Due",
            now - Duration::minutes(1),
            true,
            ReminderStatus::Pending,
            None,
        );
        insert_raw_at(
            &conn,
            "Triggered",
            now + Duration::minutes(1),
            true,
            ReminderStatus::Triggered,
            Some(now),
        );
        insert_raw_at(
            &conn,
            "Expired",
            now + Duration::minutes(2),
            true,
            ReminderStatus::Expired,
            Some(now),
        );

        let pending = ReminderRepository::pending_future_enabled(&conn, now).unwrap();

        let ids = pending
            .into_iter()
            .map(|reminder| reminder.id)
            .collect::<Vec<_>>();
        assert_eq!(ids, vec![sooner, later]);
    }

    #[test]
    fn mark_due_pending_enabled_as_triggered_only_changes_due_active_reminders() {
        let conn = db::test_connection();
        let now = Utc::now();
        let due = insert_raw_at(
            &conn,
            "Due",
            now - Duration::minutes(1),
            true,
            ReminderStatus::Pending,
            None,
        );
        let future = insert_raw_at(
            &conn,
            "Future",
            now + Duration::minutes(1),
            true,
            ReminderStatus::Pending,
            None,
        );
        let disabled = insert_raw_at(
            &conn,
            "Disabled",
            now - Duration::minutes(1),
            false,
            ReminderStatus::Pending,
            None,
        );
        let triggered = insert_raw_at(
            &conn,
            "Triggered",
            now - Duration::minutes(1),
            true,
            ReminderStatus::Triggered,
            Some(now - Duration::minutes(1)),
        );

        let changed =
            ReminderRepository::mark_due_pending_enabled_as_triggered(&conn, &due, now).unwrap();

        let changed = changed.unwrap();
        assert_eq!(changed.id, due);
        assert_eq!(changed.status, ReminderStatus::Triggered);
        assert_eq!(
            changed.triggered_at.unwrap().timestamp_millis(),
            now.timestamp_millis()
        );
        assert!(
            ReminderRepository::mark_due_pending_enabled_as_triggered(&conn, &future, now)
                .unwrap()
                .is_none()
        );
        assert!(
            ReminderRepository::mark_due_pending_enabled_as_triggered(&conn, &disabled, now)
                .unwrap()
                .is_none()
        );
        assert!(
            ReminderRepository::mark_due_pending_enabled_as_triggered(&conn, &triggered, now)
                .unwrap()
                .is_none()
        );
        assert_eq!(
            ReminderRepository::get(&conn, &future).unwrap().status,
            ReminderStatus::Pending
        );
        assert_eq!(
            ReminderRepository::get(&conn, &disabled).unwrap().status,
            ReminderStatus::Pending
        );
        assert!(!ReminderRepository::get(&conn, &disabled).unwrap().enabled);
        assert_eq!(
            ReminderRepository::get(&conn, &triggered).unwrap().status,
            ReminderStatus::Triggered
        );
    }

    #[test]
    fn mark_expired_skips_due_non_pending_reminders() {
        let conn = db::test_connection();
        let now = Utc::now();
        let pending = insert_raw_at(
            &conn,
            "Pending",
            now - Duration::minutes(3),
            true,
            ReminderStatus::Pending,
            None,
        );
        let triggered = insert_raw_at(
            &conn,
            "Triggered",
            now - Duration::minutes(2),
            true,
            ReminderStatus::Triggered,
            Some(now - Duration::minutes(1)),
        );
        let expired = insert_raw_at(
            &conn,
            "Expired",
            now - Duration::minutes(1),
            true,
            ReminderStatus::Expired,
            Some(now - Duration::minutes(1)),
        );

        let changed = ReminderRepository::mark_due_pending_as_expired(&conn, now).unwrap();

        assert_eq!(changed.len(), 1);
        assert_eq!(changed[0].id, pending);
        assert_eq!(changed[0].status, ReminderStatus::Expired);
        assert_eq!(
            ReminderRepository::get(&conn, &triggered).unwrap().status,
            ReminderStatus::Triggered
        );
        assert_eq!(
            ReminderRepository::get(&conn, &expired).unwrap().status,
            ReminderStatus::Expired
        );
    }

    #[test]
    fn invalid_timestamp_returns_database_error() {
        let conn = db::test_connection();
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        conn.execute(
            "INSERT INTO reminders (id, title, notes, remind_at, enabled, status, created_at, updated_at, triggered_at)
             VALUES (?1, 'Invalid', NULL, ?2, 1, 'pending', ?3, ?4, NULL)",
            (
                &id,
                i64::MAX,
                now.timestamp_millis(),
                now.timestamp_millis(),
            ),
        )
        .unwrap();

        let err = ReminderRepository::get(&conn, &id).unwrap_err();

        assert!(matches!(err, BackendError::Database(_)));
    }

    fn insert_raw(
        conn: &Connection,
        title: &str,
        offset_minutes: i64,
        enabled: bool,
        status: ReminderStatus,
    ) -> String {
        insert_raw_at(
            conn,
            title,
            Utc::now() + Duration::minutes(offset_minutes),
            enabled,
            status,
            None,
        )
    }

    fn insert_raw_at(
        conn: &Connection,
        title: &str,
        remind_at: DateTime<Utc>,
        enabled: bool,
        status: ReminderStatus,
        triggered_at: Option<DateTime<Utc>>,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let triggered_at = triggered_at.map(|when| when.timestamp_millis());
        conn.execute(
            "INSERT INTO reminders (id, title, notes, remind_at, enabled, status, created_at, updated_at, triggered_at)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8)",
            (
                &id,
                title,
                remind_at.timestamp_millis(),
                enabled,
                status.as_str(),
                now.timestamp_millis(),
                now.timestamp_millis(),
                triggered_at,
            ),
        )
        .unwrap();
        id
    }
}
