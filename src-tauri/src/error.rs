use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum BackendError {
    #[error("Reminder time must be in the future.")]
    ReminderTimeInPast,
    #[error("Reminder title is required.")]
    EmptyTitle,
    #[error("Reminder was not found.")]
    ReminderNotFound,
    #[error("Database operation failed: {0}")]
    Database(String),
    #[error("Notification failed: {0}")]
    Notification(String),
    #[error("Startup setting update failed: {0}")]
    Startup(String),
    #[error("{0}")]
    Translation(String),
    #[error("AI provider request failed: {0}")]
    AiProvider(String),
    #[error("{0}")]
    NetworkDiagnostic(String),
    #[error("Window operation failed: {0}")]
    Window(String),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorPayload {
    pub message: String,
}

impl From<BackendError> for ErrorPayload {
    fn from(value: BackendError) -> Self {
        Self {
            message: value.to_string(),
        }
    }
}

pub type BackendResult<T> = Result<T, BackendError>;
