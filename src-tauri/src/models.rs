use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReminderStatus {
    Pending,
    Triggered,
    Expired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub id: String,
    pub title: String,
    pub notes: Option<String>,
    pub remind_at: DateTime<Utc>,
    pub enabled: bool,
    pub status: ReminderStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub triggered_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewReminder {
    pub title: String,
    pub notes: Option<String>,
    pub remind_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub launch_on_startup: bool,
    pub minimize_to_tray: bool,
    pub notification_enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            launch_on_startup: false,
            minimize_to_tray: true,
            notification_enabled: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn settings_default_matches_mvp_defaults() {
        let settings = Settings::default();

        assert!(!settings.launch_on_startup);
        assert!(settings.minimize_to_tray);
        assert!(settings.notification_enabled);
    }

    #[test]
    fn reminder_status_serializes_as_snake_case() {
        let value = serde_json::to_value(ReminderStatus::Triggered).unwrap();

        assert_eq!(value, json!("triggered"));
    }
}
