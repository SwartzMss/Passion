use chrono::{DateTime, Utc};
use serde::{de, Deserialize, Deserializer, Serialize, Serializer};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReminderStatus {
    Pending,
    Triggered,
    Expired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ReminderPriority {
    Low,
    #[default]
    Medium,
    High,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum ReminderRepeatRule {
    #[default]
    Once,
    Daily,
    CnWorkday,
}

impl ReminderRepeatRule {
    pub fn as_str(&self) -> String {
        match self {
            Self::Once => "once".to_string(),
            Self::Daily => "daily".to_string(),
            Self::CnWorkday => "cn_workday".to_string(),
        }
    }

    pub fn from_str(value: &str) -> Result<Self, String> {
        match value {
            "once" => Ok(Self::Once),
            "daily" => Ok(Self::Daily),
            "cn_workday" => Ok(Self::CnWorkday),
            other => Err(format!("invalid reminder repeat rule {other}")),
        }
    }

    pub fn is_repeating(&self) -> bool {
        !matches!(self, Self::Once)
    }
}

impl Serialize for ReminderRepeatRule {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.as_str())
    }
}

impl<'de> Deserialize<'de> for ReminderRepeatRule {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::from_str(&value).map_err(de::Error::custom)
    }
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
    pub priority: ReminderPriority,
    pub repeat_rule: ReminderRepeatRule,
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
    #[serde(default)]
    pub priority: ReminderPriority,
    #[serde(default)]
    pub repeat_rule: ReminderRepeatRule,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub launch_on_startup: bool,
    pub minimize_to_tray: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            launch_on_startup: false,
            minimize_to_tray: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub base_url: String,
    pub model: String,
    pub api_key: String,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            base_url: "http://localhost:11434/v1".to_string(),
            model: "qwen2.5:7b".to_string(),
            api_key: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationRequest {
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationResult {
    pub translated_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortCheckRequest {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortCheckResult {
    pub host: String,
    pub port: u16,
    pub open: bool,
    pub elapsed_ms: u128,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortOccupancyRequest {
    pub port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortOccupancyEntry {
    pub protocol: String,
    pub local_address: String,
    pub state: String,
    pub pid: u32,
    pub process_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortOccupancyResult {
    pub port: u16,
    pub entries: Vec<PortOccupancyEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub task_id: Option<String>,
    pub url: String,
    pub file_name: Option<String>,
    pub save_dir: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub url: String,
    pub file_name: String,
    pub saved_path: String,
    pub bytes: u64,
    pub elapsed_ms: u128,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressEvent {
    pub task_id: String,
    pub url: String,
    pub file_name: String,
    pub saved_path: String,
    pub total_bytes: Option<u64>,
    pub downloaded_bytes: u64,
    pub elapsed_ms: u128,
    pub bytes_per_second: f64,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewScriptTask {
    pub name: String,
    pub script_path: String,
    #[serde(default)]
    pub script_args: Option<String>,
    pub schedule_type: String,
    pub interval_minutes: Option<u32>,
    pub time_of_day: Option<String>,
    pub weekdays: Option<Vec<u8>>,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptTask {
    pub id: String,
    pub name: String,
    pub script_path: String,
    pub script_args: Option<String>,
    pub schedule_type: String,
    pub interval_minutes: u32,
    pub time_of_day: Option<String>,
    pub weekdays: Option<Vec<u8>>,
    pub enabled: bool,
    pub last_started_at: Option<DateTime<Utc>>,
    pub last_finished_at: Option<DateTime<Utc>>,
    pub last_exit_code: Option<i32>,
    pub last_stdout: Option<String>,
    pub last_stderr: Option<String>,
    pub last_error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SshTunnelStatus {
    Stopped,
    Starting,
    Running,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSshTunnel {
    pub name: String,
    pub description: Option<String>,
    pub local_port: u16,
    pub bind_address: String,
    pub remote_host: String,
    pub remote_port: u16,
    pub username: String,
    pub key_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnel {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub local_port: u16,
    pub bind_address: String,
    pub remote_host: String,
    pub remote_port: u16,
    pub username: String,
    pub key_path: String,
    pub auth_type: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnelInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub local_port: u16,
    pub bind_address: String,
    pub remote_host: String,
    pub remote_port: u16,
    pub username: String,
    pub key_path: String,
    pub auth_type: String,
    pub status: SshTunnelStatus,
    pub pid: Option<u32>,
    pub started_at: Option<DateTime<Utc>>,
    pub error_message: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnelSettings {
    pub ssh_executable_path: Option<String>,
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
    }

    #[test]
    fn ai_settings_default_targets_local_compatible_endpoint() {
        let settings = AiSettings::default();

        assert_eq!(settings.base_url, "http://localhost:11434/v1");
        assert_eq!(settings.model, "qwen2.5:7b");
        assert_eq!(settings.api_key, "");
    }

    #[test]
    fn reminder_status_serializes_as_snake_case() {
        let value = serde_json::to_value(ReminderStatus::Triggered).unwrap();

        assert_eq!(value, json!("triggered"));
    }

    #[test]
    fn reminder_repeat_rule_defaults_to_once() {
        let value: NewReminder = serde_json::from_value(json!({
            "title": "Test",
            "notes": null,
            "remindAt": "2026-01-05T01:00:00Z"
        }))
        .unwrap();

        assert_eq!(value.repeat_rule, ReminderRepeatRule::Once);
        assert_eq!(value.priority, ReminderPriority::Medium);
    }

    #[test]
    fn reminder_repeat_rule_supports_supported_strings_only() {
        let daily: ReminderRepeatRule = serde_json::from_value(json!("daily")).unwrap();
        let cn_workday: ReminderRepeatRule = serde_json::from_value(json!("cn_workday")).unwrap();
        let weekly = serde_json::from_value::<ReminderRepeatRule>(json!("weekly:1,3,5"));

        assert_eq!(daily, ReminderRepeatRule::Daily);
        assert_eq!(cn_workday, ReminderRepeatRule::CnWorkday);
        assert!(weekly.is_err());
    }
}
