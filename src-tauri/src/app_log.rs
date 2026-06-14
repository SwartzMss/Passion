use chrono::Local;
use std::{
    fs::{create_dir_all, OpenOptions},
    io::Write,
    path::Path,
};

pub fn info(path: &Path, message: impl AsRef<str>) {
    let _ = write_log_line(path, "INFO", message.as_ref());
}

pub fn warn(path: &Path, message: impl AsRef<str>) {
    let _ = write_log_line(path, "WARN", message.as_ref());
}

pub fn error(path: &Path, message: impl AsRef<str>) {
    let _ = write_log_line(path, "ERROR", message.as_ref());
}

fn write_log_line(path: &Path, level: &str, message: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(
        file,
        "{} [{}] {}",
        Local::now().to_rfc3339(),
        level,
        message
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_log_line_appends_timestamped_message() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("passion.log");

        write_log_line(&path, "INFO", "scheduler started").unwrap();

        let content = std::fs::read_to_string(path).unwrap();
        assert!(content.contains("[INFO] scheduler started"));
        assert!(content.contains("T"));
        assert!(content
            .split_whitespace()
            .next()
            .is_some_and(|timestamp| timestamp.ends_with("+08:00")
                || timestamp.ends_with("+00:00")
                || timestamp[timestamp.len().saturating_sub(6)..].contains(':')));
    }
}
