use chrono::Local;
use std::{
    ffi::OsString,
    fs::{create_dir_all, metadata, remove_file, rename, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

const MAX_LOG_FILE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_ARCHIVED_LOG_FILES: u8 = 3;
static LOG_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

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
    let line = format!("{} [{}] {}\n", Local::now().to_rfc3339(), level, message);
    write_log_line_with_limit(path, &line, MAX_LOG_FILE_BYTES)
}

fn write_log_line_with_limit(path: &Path, line: &str, max_bytes: u64) -> std::io::Result<()> {
    let _guard = LOG_WRITE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| std::io::Error::other("log writer lock poisoned"))?;
    if let Some(parent) = path.parent() {
        create_dir_all(parent)?;
    }

    let current_bytes = match metadata(path) {
        Ok(metadata) => metadata.len(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
        Err(error) => return Err(error),
    };
    if current_bytes > 0 && current_bytes.saturating_add(line.len() as u64) > max_bytes {
        rotate_log_files(path)?;
    }

    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(line.as_bytes())
}

fn rotate_log_files(path: &Path) -> std::io::Result<()> {
    let oldest = archive_path(path, MAX_ARCHIVED_LOG_FILES);
    remove_if_exists(&oldest)?;
    for index in (1..MAX_ARCHIVED_LOG_FILES).rev() {
        rename_if_exists(&archive_path(path, index), &archive_path(path, index + 1))?;
    }
    rename_if_exists(path, &archive_path(path, 1))
}

fn archive_path(path: &Path, index: u8) -> PathBuf {
    let mut file_name = path
        .file_name()
        .map(OsString::from)
        .unwrap_or_else(|| OsString::from("passion.log"));
    file_name.push(format!(".{index}"));
    path.with_file_name(file_name)
}

fn remove_if_exists(path: &Path) -> std::io::Result<()> {
    match remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn rename_if_exists(from: &Path, to: &Path) -> std::io::Result<()> {
    match rename(from, to) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
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

    #[test]
    fn rotates_log_files_and_discards_the_oldest_archive() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("passion.log");

        for index in 0..5 {
            super::write_log_line_with_limit(&path, &format!("message-{index}\n"), 10).unwrap();
        }

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "message-4\n");
        assert_eq!(
            std::fs::read_to_string(path.with_file_name("passion.log.1")).unwrap(),
            "message-3\n"
        );
        assert_eq!(
            std::fs::read_to_string(path.with_file_name("passion.log.2")).unwrap(),
            "message-2\n"
        );
        assert_eq!(
            std::fs::read_to_string(path.with_file_name("passion.log.3")).unwrap(),
            "message-1\n"
        );
        assert!(!path.with_file_name("passion.log.4").exists());
    }

    #[test]
    fn concurrent_writes_keep_at_most_three_archives() {
        let dir = tempfile::tempdir().unwrap();
        let path = std::sync::Arc::new(dir.path().join("passion.log"));
        let handles = (0..16)
            .map(|index| {
                let path = std::sync::Arc::clone(&path);
                std::thread::spawn(move || {
                    super::write_log_line_with_limit(
                        path.as_path(),
                        &format!("thread-{index:02}\n"),
                        16,
                    )
                    .unwrap();
                })
            })
            .collect::<Vec<_>>();

        for handle in handles {
            handle.join().unwrap();
        }

        assert!(path.exists());
        assert!(!path.with_file_name("passion.log.4").exists());
    }
}
