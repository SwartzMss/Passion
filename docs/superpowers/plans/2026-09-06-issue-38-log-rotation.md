# Issue #38 Log Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound Passion's application log disk usage with size-based rotation while preserving the existing logging API and line format.

**Architecture:** Keep `info`, `warn`, and `error` as non-failing wrappers around a private write function. Serialize the size-check, rotation, and append sequence with a module-level `OnceLock<Mutex<()>>`; rotate `passion.log` into three numbered archives before an append would exceed 5 MiB. A private size-limit parameter makes rotation behavior testable with small temporary thresholds.

**Tech Stack:** Rust 2021, standard filesystem APIs, `OnceLock`, `Mutex`, tempfile tests.

---

## File map

- Modify: `src-tauri/src/app_log.rs` — rotation constants, synchronized writer, archive helpers, and tests.
- No changes: callers in `src-tauri/src/lib.rs` and `src-tauri/src/commands.rs` — their logging API remains unchanged.

### Task 1: Add failing rotation tests

**Files:**
- Modify: `src-tauri/src/app_log.rs`

- [ ] **Step 1: Add a failing rotation-order test**

Add this test to the existing test module before implementing the helpers:

```rust
#[test]
fn rotates_log_files_and_discards_the_oldest_archive() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("passion.log");

    for index in 0..5 {
        super::write_log_line_with_limit(
            &path,
            &format!("message-{index}\\n"),
            10,
        )
        .unwrap();
    }

    assert_eq!(std::fs::read_to_string(&path).unwrap(), "message-4\\n");
    assert_eq!(
        std::fs::read_to_string(path.with_file_name("passion.log.1")).unwrap(),
        "message-3\\n"
    );
    assert_eq!(
        std::fs::read_to_string(path.with_file_name("passion.log.2")).unwrap(),
        "message-2\\n"
    );
    assert_eq!(
        std::fs::read_to_string(path.with_file_name("passion.log.3")).unwrap(),
        "message-1\\n"
    );
    assert!(!path.with_file_name("passion.log.4").exists());
}
```

- [ ] **Step 2: Add a failing concurrent-write bound test**

Add this test, which uses real threads and the filesystem rather than mocking the writer:

```rust
#[test]
fn concurrent_writes_keep_at_most_three_archives() {
    let dir = tempfile::tempdir().unwrap();
    let path = std::sync::Arc::new(dir.path().join("passion.log"));
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(16));
    let handles = (0..16)
        .map(|index| {
            let path = std::sync::Arc::clone(&path);
            let barrier = std::sync::Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                super::write_log_line_with_limit(
                    path.as_path(),
                    &format!("thread-{index:02}\\n"),
                    40,
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

    let mut actual = Vec::new();
    for index in 0..=3 {
        let file = if index == 0 {
            path.as_path().to_path_buf()
        } else {
            path.with_file_name(format!("passion.log.{index}"))
        };
        if file.exists() {
            actual.extend(
                std::fs::read_to_string(file)
                    .unwrap()
                    .lines()
                    .map(str::to_string),
            );
        }
    }
    actual.sort();
    let mut expected = (0..16)
        .map(|index| format!("thread-{index:02}"))
        .collect::<Vec<_>>();
    expected.sort();
    assert_eq!(actual, expected);
}
```

- [ ] **Step 3: Add production-boundary and oversized-line tests**

Add tests that use the production 5 MiB constant and verify that a single line larger than a test limit remains intact:

```rust
#[test]
fn rotates_at_the_production_size_boundary() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("passion.log");
    let almost_full = "a".repeat((super::MAX_LOG_FILE_BYTES - 1) as usize);

    super::write_log_line_with_limit(&path, &almost_full, super::MAX_LOG_FILE_BYTES).unwrap();
    super::write_log_line_with_limit(&path, "b", super::MAX_LOG_FILE_BYTES).unwrap();
    assert_eq!(std::fs::metadata(&path).unwrap().len(), super::MAX_LOG_FILE_BYTES);

    super::write_log_line_with_limit(&path, "c", super::MAX_LOG_FILE_BYTES).unwrap();

    assert_eq!(
        std::fs::metadata(path.with_file_name("passion.log.1"))
            .unwrap()
            .len(),
        super::MAX_LOG_FILE_BYTES
    );
    assert_eq!(std::fs::read_to_string(path).unwrap(), "c");
}

#[test]
fn keeps_a_single_log_line_that_exceeds_the_limit_intact() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("passion.log");
    let line = "x".repeat(32);

    super::write_log_line_with_limit(&path, &line, 16).unwrap();

    assert_eq!(std::fs::read_to_string(&path).unwrap(), line);
    assert!(!path.with_file_name("passion.log.1").exists());
}
```

- [ ] **Step 4: Run the focused tests and verify the intended failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml app_log -- --nocapture`

Expected: compilation failure because `write_log_line_with_limit` does not exist yet.

### Task 2: Implement synchronized size-based rotation

**Files:**
- Modify: `src-tauri/src/app_log.rs`

- [ ] **Step 1: Add constants, synchronization, and line construction**

Extend the imports and constants as follows:

```rust
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
```

Change `write_log_line` to format one complete line and delegate to a size-parameterized writer:

```rust
fn write_log_line(path: &Path, level: &str, message: &str) -> std::io::Result<()> {
    let line = format!(
        "{} [{}] {}\\n",
        Local::now().to_rfc3339(),
        level,
        message
    );
    write_log_line_with_limit(path, &line, MAX_LOG_FILE_BYTES)
}
```

- [ ] **Step 2: Implement the bounded writer and rotation helpers**

Add the following behavior below `write_log_line`:

```rust
fn write_log_line_with_limit(
    path: &Path,
    line: &str,
    max_bytes: u64,
) -> std::io::Result<()> {
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
    if current_bytes > 0
        && current_bytes.saturating_add(line.len() as u64) > max_bytes
    {
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
```

This keeps all rotation operations under the same lock as the append and leaves a single oversized log line intact.

- [ ] **Step 3: Run the focused tests and confirm green**

Run: `cargo test --manifest-path src-tauri/Cargo.toml app_log -- --nocapture`

Expected: existing formatting test, rotation-order test, and concurrent-write test all pass.

- [ ] **Step 4: Format and inspect the diff**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && git diff --check`

Expected: both commands exit successfully with no formatting or whitespace errors.

- [ ] **Step 5: Commit the implementation**

```bash
git add src-tauri/src/app_log.rs
git commit -m "feat: rotate application logs by size"
```

### Task 3: Full verification before the PR

**Files:**
- Inspect only; no additional files should change.

- [ ] **Step 1: Run the complete Rust test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: all Rust tests pass.

- [ ] **Step 2: Build the backend**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`

Expected: backend compilation succeeds.

- [ ] **Step 3: Confirm scope and clean working tree**

Run: `git diff --check && git status --short`

Expected: no diff-check errors and no uncommitted files.
