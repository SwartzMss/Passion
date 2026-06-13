use crate::error::{BackendError, BackendResult};
use crate::models::{NewReminder, Reminder, ReminderPriority, ReminderRepeatRule, ReminderStatus};
use chrono::{DateTime, Datelike, Duration, FixedOffset, TimeZone, Timelike, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;

pub struct ReminderRepository;

const REMIND_AT_COLUMN_INDEX: usize = 3;
const CREATED_AT_COLUMN_INDEX: usize = 7;
const UPDATED_AT_COLUMN_INDEX: usize = 8;
const TRIGGERED_AT_COLUMN_INDEX: usize = 9;

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

impl ReminderPriority {
    pub fn as_str(self) -> &'static str {
        match self {
            ReminderPriority::Low => "low",
            ReminderPriority::Medium => "medium",
            ReminderPriority::High => "high",
        }
    }

    fn from_db(value: &str) -> BackendResult<Self> {
        match value {
            "low" => Ok(Self::Low),
            "medium" => Ok(Self::Medium),
            "high" => Ok(Self::High),
            other => Err(BackendError::Database(format!(
                "invalid reminder priority {other}"
            ))),
        }
    }
}

impl ReminderRepeatRule {
    fn from_db(value: &str) -> BackendResult<Self> {
        Self::from_str(value).map_err(BackendError::Database)
    }
}

impl ReminderRepository {
    pub fn create(conn: &Connection, input: NewReminder) -> BackendResult<Reminder> {
        Self::create_at(conn, input, Utc::now())
    }

    pub fn create_at(
        conn: &Connection,
        input: NewReminder,
        now: DateTime<Utc>,
    ) -> BackendResult<Reminder> {
        let title = input.title.trim().to_string();
        if title.is_empty() {
            return Err(BackendError::EmptyTitle);
        }
        let remind_at = if input.repeat_rule.is_repeating() {
            next_repeating_remind_at(&input.repeat_rule, input.remind_at, now)?
        } else {
            input.remind_at
        };
        if remind_at <= now {
            return Err(BackendError::ReminderTimeInPast);
        }

        let reminder = Reminder {
            id: Uuid::new_v4().to_string(),
            title,
            notes: input
                .notes
                .map(|notes| notes.trim().to_string())
                .filter(|notes| !notes.is_empty()),
            remind_at,
            enabled: true,
            status: ReminderStatus::Pending,
            priority: input.priority,
            repeat_rule: input.repeat_rule,
            created_at: now,
            updated_at: now,
            triggered_at: None,
        };

        conn.execute(
            "INSERT INTO reminders (id, title, notes, remind_at, enabled, status, priority, repeat_rule, created_at, updated_at, triggered_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL)",
            params![
                reminder.id,
                reminder.title,
                reminder.notes,
                reminder.remind_at.timestamp_millis(),
                reminder.enabled,
                reminder.status.as_str(),
                reminder.priority.as_str(),
                reminder.repeat_rule.as_str(),
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

    pub fn update(conn: &Connection, id: &str, input: NewReminder) -> BackendResult<Reminder> {
        Self::update_at(conn, id, input, Utc::now())
    }

    pub fn update_at(
        conn: &Connection,
        id: &str,
        input: NewReminder,
        now: DateTime<Utc>,
    ) -> BackendResult<Reminder> {
        Self::get(conn, id)?;
        let title = input.title.trim().to_string();
        if title.is_empty() {
            return Err(BackendError::EmptyTitle);
        }
        let remind_at = if input.repeat_rule.is_repeating() {
            next_repeating_remind_at(&input.repeat_rule, input.remind_at, now)?
        } else {
            input.remind_at
        };
        if remind_at <= now {
            return Err(BackendError::ReminderTimeInPast);
        }
        let notes = input
            .notes
            .map(|notes| notes.trim().to_string())
            .filter(|notes| !notes.is_empty());
        let count = conn
            .execute(
                "UPDATE reminders
                 SET title = ?1, notes = ?2, remind_at = ?3, status = 'pending', priority = ?4, repeat_rule = ?5, updated_at = ?6, triggered_at = NULL
                 WHERE id = ?7",
                params![
                    title,
                    notes,
                    remind_at.timestamp_millis(),
                    input.priority.as_str(),
                    input.repeat_rule.as_str(),
                    now.timestamp_millis(),
                    id,
                ],
            )
            .map_err(|err| BackendError::Database(err.to_string()))?;
        if count == 0 {
            return Err(BackendError::ReminderNotFound);
        }
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
            .map(|reminder| {
                if reminder.repeat_rule.is_repeating() {
                    let next =
                        next_repeating_remind_at(&reminder.repeat_rule, reminder.remind_at, now)?;
                    Self::reschedule_repeating(conn, &reminder.id, next, now)
                } else {
                    Self::mark_status(conn, &reminder.id, ReminderStatus::Expired, now)
                }
            })
            .collect()
    }

    pub fn reschedule_after_trigger(
        conn: &Connection,
        reminder: &Reminder,
        when: DateTime<Utc>,
    ) -> BackendResult<Option<Reminder>> {
        if !reminder.repeat_rule.is_repeating() {
            return Ok(None);
        }
        let next = next_repeating_remind_at(&reminder.repeat_rule, reminder.remind_at, when)?;
        Self::reschedule_repeating(conn, &reminder.id, next, when).map(Some)
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

    fn reschedule_repeating(
        conn: &Connection,
        id: &str,
        next_remind_at: DateTime<Utc>,
        when: DateTime<Utc>,
    ) -> BackendResult<Reminder> {
        conn.execute(
            "UPDATE reminders
             SET remind_at = ?1, status = 'pending', triggered_at = ?2, updated_at = ?2
             WHERE id = ?3",
            params![
                next_remind_at.timestamp_millis(),
                when.timestamp_millis(),
                id
            ],
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
        let priority: String = row.get("priority")?;
        let repeat_rule: String = row.get("repeat_rule")?;
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
            priority: ReminderPriority::from_db(&priority).map_err(|err| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(err),
                )
            })?,
            repeat_rule: ReminderRepeatRule::from_db(&repeat_rule).map_err(|err| {
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

pub fn next_repeating_remind_at(
    rule: &ReminderRepeatRule,
    requested: DateTime<Utc>,
    now: DateTime<Utc>,
) -> BackendResult<DateTime<Utc>> {
    match rule {
        ReminderRepeatRule::Once => Ok(requested),
        ReminderRepeatRule::CnWorkday => next_cn_workday_remind_at(requested, now),
        ReminderRepeatRule::Daily => next_local_day_match(requested, now, |_| true),
        ReminderRepeatRule::Weekly(days) => {
            next_local_day_match(requested, now, |date| days.contains(&date.weekday()))
        }
    }
}

fn next_local_day_match<F>(
    requested: DateTime<Utc>,
    now: DateTime<Utc>,
    matches_day: F,
) -> BackendResult<DateTime<Utc>>
where
    F: Fn(chrono::NaiveDate) -> bool,
{
    let china = FixedOffset::east_opt(8 * 3600)
        .ok_or_else(|| BackendError::Database("invalid China timezone offset".to_string()))?;
    let requested_cn = requested.with_timezone(&china);
    let time = requested_cn.time();
    let mut date = requested_cn.date_naive();

    for _ in 0..400 {
        let candidate = china
            .with_ymd_and_hms(
                date.year(),
                date.month(),
                date.day(),
                time.hour(),
                time.minute(),
                time.second(),
            )
            .single()
            .ok_or_else(|| BackendError::Database("invalid reminder local time".to_string()))?
            .with_timezone(&Utc);
        if candidate > now && matches_day(date) {
            return Ok(candidate);
        }
        date = date
            .checked_add_signed(Duration::days(1))
            .ok_or_else(|| BackendError::Database("invalid reminder next date".to_string()))?;
    }

    Err(BackendError::Database(
        "could not find next repeating reminder time".to_string(),
    ))
}

pub fn next_cn_workday_remind_at(
    requested: DateTime<Utc>,
    now: DateTime<Utc>,
) -> BackendResult<DateTime<Utc>> {
    let china = FixedOffset::east_opt(8 * 3600)
        .ok_or_else(|| BackendError::Database("invalid China timezone offset".to_string()))?;
    let requested_cn = requested.with_timezone(&china);
    let time = requested_cn.time();
    let mut date = requested_cn.date_naive();

    for _ in 0..400 {
        let candidate = china
            .with_ymd_and_hms(
                date.year(),
                date.month(),
                date.day(),
                time.hour(),
                time.minute(),
                time.second(),
            )
            .single()
            .ok_or_else(|| BackendError::Database("invalid reminder local time".to_string()))?
            .with_timezone(&Utc);
        if candidate > now && crate::workday_calendar::is_cn_legal_workday(date)? {
            return Ok(candidate);
        }
        date = date
            .checked_add_signed(Duration::days(1))
            .ok_or_else(|| BackendError::Database("invalid reminder next date".to_string()))?;
    }

    Err(BackendError::Database(
        "could not find next China legal workday".to_string(),
    ))
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
    use chrono::{Duration, TimeZone};

    #[test]
    fn create_rejects_empty_title() {
        let conn = db::test_connection();
        let input = NewReminder {
            title: "  ".to_string(),
            notes: None,
            remind_at: Utc::now() + Duration::minutes(5),
            priority: ReminderPriority::Medium,
            repeat_rule: ReminderRepeatRule::Once,
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
            priority: ReminderPriority::Medium,
            repeat_rule: ReminderRepeatRule::Once,
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
                priority: ReminderPriority::Medium,
                repeat_rule: ReminderRepeatRule::Once,
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
    fn update_resets_reminder_to_pending_with_new_content() {
        let conn = db::test_connection();
        let id = insert_raw_at(
            &conn,
            "Old",
            Utc::now() - Duration::minutes(1),
            true,
            ReminderStatus::Triggered,
            Some(Utc::now() - Duration::minutes(1)),
        );

        let updated = ReminderRepository::update(
            &conn,
            &id,
            NewReminder {
                title: "New title".to_string(),
                notes: Some(" New notes ".to_string()),
                remind_at: Utc::now() + Duration::minutes(10),
                priority: ReminderPriority::High,
                repeat_rule: ReminderRepeatRule::Daily,
            },
        )
        .unwrap();

        assert_eq!(updated.title, "New title");
        assert_eq!(updated.notes.as_deref(), Some("New notes"));
        assert_eq!(updated.status, ReminderStatus::Pending);
        assert!(updated.triggered_at.is_none());
        assert_eq!(updated.repeat_rule, ReminderRepeatRule::Daily);
        assert_eq!(updated.priority, ReminderPriority::High);
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

    #[test]
    fn create_cn_workday_reminder_moves_holiday_to_next_legal_workday() {
        let conn = db::test_connection();
        let input = NewReminder {
            title: "Standup".to_string(),
            notes: None,
            remind_at: china_time(2026, 10, 1, 9, 0),
            priority: ReminderPriority::Medium,
            repeat_rule: ReminderRepeatRule::CnWorkday,
        };

        let reminder = ReminderRepository::create(&conn, input).unwrap();

        assert_eq!(reminder.repeat_rule, ReminderRepeatRule::CnWorkday);
        assert_eq!(reminder.remind_at, china_time(2026, 10, 8, 9, 0));
    }

    #[test]
    fn reschedule_after_trigger_moves_to_next_legal_workday() {
        let conn = db::test_connection();
        let reminder = insert_raw_at_with_repeat(
            &conn,
            "Standup",
            china_time(2026, 2, 14, 9, 0),
            true,
            ReminderStatus::Pending,
            ReminderRepeatRule::CnWorkday,
            None,
        );
        let reminder = ReminderRepository::get(&conn, &reminder).unwrap();

        let next = ReminderRepository::reschedule_after_trigger(
            &conn,
            &reminder,
            china_time(2026, 2, 14, 9, 0),
        )
        .unwrap()
        .unwrap();

        assert_eq!(next.status, ReminderStatus::Pending);
        assert_eq!(next.remind_at, china_time(2026, 2, 24, 9, 0));
    }

    #[test]
    fn create_daily_reminder_moves_past_time_to_tomorrow() {
        let conn = db::test_connection();
        let input = NewReminder {
            title: "Daily".to_string(),
            notes: None,
            remind_at: china_time(2026, 6, 1, 9, 0),
            priority: ReminderPriority::Medium,
            repeat_rule: ReminderRepeatRule::Daily,
        };

        let reminder =
            ReminderRepository::create_at(&conn, input, china_time(2026, 6, 1, 10, 0)).unwrap();

        assert_eq!(reminder.remind_at, china_time(2026, 6, 2, 9, 0));
    }

    #[test]
    fn create_weekly_reminder_uses_selected_weekdays() {
        let conn = db::test_connection();
        let input = NewReminder {
            title: "Weekly".to_string(),
            notes: None,
            remind_at: china_time(2026, 6, 1, 9, 0),
            priority: ReminderPriority::Medium,
            repeat_rule: ReminderRepeatRule::Weekly(vec![chrono::Weekday::Wed]),
        };

        let reminder =
            ReminderRepository::create_at(&conn, input, china_time(2026, 6, 1, 10, 0)).unwrap();

        assert_eq!(reminder.remind_at, china_time(2026, 6, 3, 9, 0));
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
            "INSERT INTO reminders (id, title, notes, remind_at, enabled, status, repeat_rule, created_at, updated_at, triggered_at)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, 'once', ?6, ?7, ?8)",
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

    fn insert_raw_at_with_repeat(
        conn: &Connection,
        title: &str,
        remind_at: DateTime<Utc>,
        enabled: bool,
        status: ReminderStatus,
        repeat_rule: ReminderRepeatRule,
        triggered_at: Option<DateTime<Utc>>,
    ) -> String {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let triggered_at = triggered_at.map(|when| when.timestamp_millis());
        conn.execute(
            "INSERT INTO reminders (id, title, notes, remind_at, enabled, status, repeat_rule, created_at, updated_at, triggered_at)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            (
                &id,
                title,
                remind_at.timestamp_millis(),
                enabled,
                status.as_str(),
                repeat_rule.as_str(),
                now.timestamp_millis(),
                now.timestamp_millis(),
                triggered_at,
            ),
        )
        .unwrap();
        id
    }

    fn china_time(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> DateTime<Utc> {
        chrono::FixedOffset::east_opt(8 * 3600)
            .unwrap()
            .with_ymd_and_hms(year, month, day, hour, minute, 0)
            .unwrap()
            .with_timezone(&Utc)
    }
}
