# SSH Tunnel stderr Bounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SSH Tunnel's unbounded stderr collection with a continuously drained 64 KiB rolling buffer while preserving recent exit diagnostics and existing lifecycle behavior.

**Architecture:** Add a byte-oriented `StderrRingBuffer` and a `StderrCapture` wrapper in `src-tauri/src/ssh_tunnels.rs`. The capture owns the shared rolling buffer and reader task; startup and monitor paths await that task before formatting exit diagnostics. The real-child regression test uses the test binary itself, so the pipe can be saturated without relying on a platform shell.

**Tech Stack:** Rust 2021, Tokio async process/IO, Tauri async runtime, `VecDeque<u8>`, Cargo unit tests.

---

## Files and responsibilities

- Modify `src-tauri/src/ssh_tunnels.rs`: define the bounded buffer/capture types, integrate them into startup and monitoring, and add unit plus real-child regression tests in the existing module.
- Create `docs/superpowers/specs/2026-09-06-issue-42-ssh-stderr-bounds-design.md`: already committed as the approved design and remains the source-of-truth for the fixed limit and lifecycle constraints.
- Create `docs/superpowers/plans/2026-09-06-issue-42-ssh-stderr-bounds.md`: this implementation plan.

No frontend files, Cargo dependencies, SSH arguments, or database models need to change.

### Task 1: Add failing bounded-buffer and child-pipe tests

**Files:**
- Modify: `src-tauri/src/ssh_tunnels.rs:1-25, 766-777, 779-975`

- [x] **Step 1: Add the constants and tests before adding the implementation.**

Add these constants beside the existing SSH timing constants:

```rust
const SSH_STDERR_BUFFER_LIMIT_BYTES: usize = 64 * 1024;
const SSH_STDERR_READ_CHUNK_BYTES: usize = 4096;
const STDERR_CHILD_ENV: &str = "PASSION_SSH_STDERR_CHILD";
```

Add these imports inside the existing `tests` module:

```rust
use std::io::Write;
use tokio::time::timeout;
```

Add the following tests before the existing Windows-only tests. These tests intentionally reference `StderrRingBuffer`, `spawn_stderr_capture`, and `StderrCapture::snapshot`, which do not exist yet:

```rust
#[test]
fn stderr_ring_buffer_keeps_latest_bytes() {
    let mut buffer = StderrRingBuffer::new();
    let input: Vec<u8> = (0..SSH_STDERR_BUFFER_LIMIT_BYTES + 3)
        .map(|value| (value % 251) as u8)
        .collect();

    buffer.append(&input);

    assert_eq!(buffer.snapshot(), input[3..].to_vec());
}

#[test]
fn stderr_ring_buffer_decodes_utf8_only_at_snapshot_boundary() {
    let mut buffer = StderrRingBuffer::new();
    buffer.append("连接失败".as_bytes());

    assert_eq!(buffer.to_lossy_string(), "连接失败");
}

#[test]
fn stderr_writer_child() {
    if std::env::var_os(STDERR_CHILD_ENV).is_none() {
        return;
    }

    let mut stderr = std::io::stderr().lock();
    stderr.write_all(b"old-prefix-marker").unwrap();
    let chunk = vec![b'x'; SSH_STDERR_READ_CHUNK_BYTES];
    for _ in 0..(SSH_STDERR_BUFFER_LIMIT_BYTES / SSH_STDERR_READ_CHUNK_BYTES + 2) {
        stderr.write_all(&chunk).unwrap();
    }
    stderr.write_all(b"tail-marker").unwrap();
    stderr.flush().unwrap();
}

#[tokio::test]
async fn stderr_reader_drains_a_child_and_keeps_the_latest_limit() {
    let executable = std::env::current_exe().unwrap();
    let mut child = TokioCommand::new(executable)
        .args([
            "--exact",
            "ssh_tunnels::tests::stderr_writer_child",
            "--nocapture",
        ])
        .env(STDERR_CHILD_ENV, "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let stderr = child.stderr.take().unwrap();
    let mut capture = spawn_stderr_capture(stderr);

    let status = timeout(Duration::from_secs(5), child.wait())
        .await
        .expect("child blocked on stderr pipe")
        .unwrap();
    assert!(status.success());

    let output = capture.snapshot().await;
    assert_eq!(output.as_bytes().len(), SSH_STDERR_BUFFER_LIMIT_BYTES);
    assert!(output.ends_with("tail-marker"));
    assert!(!output.contains("old-prefix-marker"));
}
```

- [x] **Step 2: Run the focused tests and verify they fail for the expected missing-implementation reason.**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml ssh_tunnels::tests
```

Expected: compilation fails because `StderrRingBuffer` and `spawn_stderr_capture` are not defined. Do not change production code before observing this failure.

### Task 2: Implement the bounded capture and make the focused tests pass

**Files:**
- Modify: `src-tauri/src/ssh_tunnels.rs:1-25, 766-777`

- [x] **Step 1: Add the byte-oriented rolling buffer.**

Add `VecDeque` to the collections import:

```rust
use std::collections::{HashMap, VecDeque};
```

Add this implementation above `stderr_suffix`:

```rust
struct StderrRingBuffer {
    bytes: VecDeque<u8>,
}

impl StderrRingBuffer {
    fn new() -> Self {
        Self {
            bytes: VecDeque::with_capacity(SSH_STDERR_BUFFER_LIMIT_BYTES),
        }
    }

    fn append(&mut self, chunk: &[u8]) {
        if chunk.len() >= SSH_STDERR_BUFFER_LIMIT_BYTES {
            self.bytes.clear();
            self.bytes.extend(
                chunk[chunk.len() - SSH_STDERR_BUFFER_LIMIT_BYTES..]
                    .iter()
                    .copied(),
            );
            return;
        }

        let overflow = self
            .bytes
            .len()
            .saturating_add(chunk.len())
            .saturating_sub(SSH_STDERR_BUFFER_LIMIT_BYTES);
        for _ in 0..overflow {
            self.bytes.pop_front();
        }
        self.bytes.extend(chunk.iter().copied());
    }

    fn snapshot(&self) -> Vec<u8> {
        self.bytes.iter().copied().collect()
    }

    fn to_lossy_string(&self) -> String {
        String::from_utf8_lossy(&self.snapshot()).into_owned()
    }
}
```

- [x] **Step 2: Add a capture wrapper that drains the reader and awaits completion before diagnostics.**

Add this implementation immediately after `StderrRingBuffer`:

```rust
struct StderrCapture {
    buffer: Arc<tokio::sync::Mutex<StderrRingBuffer>>,
    reader_task: Option<tauri::async_runtime::JoinHandle<()>>,
}

fn spawn_stderr_capture<R>(mut stderr: R) -> StderrCapture
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let buffer = Arc::new(tokio::sync::Mutex::new(StderrRingBuffer::new()));
    let shared_buffer = buffer.clone();
    let reader_task = tauri::async_runtime::spawn(async move {
        let mut chunk = [0u8; SSH_STDERR_READ_CHUNK_BYTES];
        loop {
            match stderr.read(&mut chunk).await {
                Ok(0) | Err(_) => break,
                Ok(size) => {
                    let mut buffer = shared_buffer.lock().await;
                    buffer.append(&chunk[..size]);
                }
            }
        }
    });

    StderrCapture {
        buffer,
        reader_task: Some(reader_task),
    }
}

impl StderrCapture {
    async fn snapshot(&mut self) -> String {
        if let Some(reader_task) = self.reader_task.take() {
            let _ = reader_task.await;
        }
        let buffer = self.buffer.lock().await;
        buffer.to_lossy_string()
    }
}
```

- [x] **Step 3: Replace the old unbounded `stderr_suffix` helper.**

Replace `summarize_output` and the old `stderr_suffix` with:

```rust
async fn stderr_suffix(stderr_capture: Option<&mut StderrCapture>) -> String {
    let Some(stderr_capture) = stderr_capture else {
        return String::new();
    };
    let stderr = stderr_capture.snapshot().await;
    if stderr.trim().is_empty() {
        String::new()
    } else {
        format!("，stderr: {}", stderr.trim())
    }
}
```

- [x] **Step 4: Run the focused tests and verify they pass.**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml ssh_tunnels::tests
```

Expected: 3 tests pass. The child-process test must complete within the timeout; a hang indicates the reader is not draining the pipe.

- [x] **Step 5: Commit the bounded capture implementation.**

```bash
git add src-tauri/src/ssh_tunnels.rs
git commit -m "feat: add bounded ssh stderr capture"
```

### Task 3: Integrate `StderrCapture` into SSH startup and monitoring

**Files:**
- Modify: `src-tauri/src/ssh_tunnels.rs:471-515, 620-666`

- [x] **Step 1: Replace startup stderr setup with an optional capture.**

Replace the current `stderr_buffer` setup in `SshTunnelManager::start` with:

```rust
let mut stderr_capture = child.stderr.take().map(spawn_stderr_capture);
```

In the `SshStartupState::Exited` arm, make the capture mutable and pass it to the helper:

```rust
SshStartupState::Exited(status) => {
    let error = format!(
        "SSH 进程退出，退出码: {}{}",
        status,
        stderr_suffix(stderr_capture.as_mut()).await
    );
    // existing set_error and logging remain unchanged
}
```

In the `SshStartupState::Running` arm, pass `stderr_capture` to `spawn_monitor` unchanged:

```rust
self.spawn_monitor(tunnel.id.clone(), child, stderr_capture, log_path);
```

The `CheckFailed` arm continues to set the same error and drops the capture task, which remains bounded and will finish when the child pipe closes.

- [x] **Step 2: Update `spawn_monitor` to own and finish the capture.**

Change its parameter from `Arc<tokio::sync::Mutex<String>>` to `Option<StderrCapture>`:

```rust
fn spawn_monitor(
    &self,
    id: String,
    child: Arc<tokio::sync::Mutex<Child>>,
    mut stderr_capture: Option<StderrCapture>,
    log_path: PathBuf,
) {
```

In the exited branch, replace `stderr_suffix(&stderr_buffer).await` with `stderr_suffix(stderr_capture.as_mut()).await`. Keep the existing `is_stopping` guard, log text, `set_error`, polling interval, and break behavior exactly as they are.

- [x] **Step 3: Format and run SSH tests.**

Run:

```bash
rustfmt --edition 2021 --check src-tauri/src/ssh_tunnels.rs
cargo test --manifest-path src-tauri/Cargo.toml ssh_tunnels::tests
```

Expected: the changed SSH file is formatted and all SSH tunnel tests pass, including the new child-pipe regression test. The full-workspace Cargo format check may still report an existing difference in `src-tauri/src/settings.rs`.

- [x] **Step 4: Commit the lifecycle integration.**

```bash
git add src-tauri/src/ssh_tunnels.rs
git commit -m "fix: bound ssh tunnel stderr memory"
```

### Task 4: Full verification and PR preparation

**Files:**
- Modify: none unless verification reveals a defect.

- [x] **Step 1: Run the complete backend test suite.**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all backend tests pass with zero failures.

- [x] **Step 2: Run frontend tests and the production build.**

```bash
npm test -- --run
npm run build
```

Expected: all existing frontend tests pass and TypeScript/Vite build exits successfully. The `npm install` baseline reported audit findings; do not change dependency versions as part of this issue.

- [x] **Step 3: Inspect the final diff and verify repository state.**

```bash
git diff origin/main...HEAD --check
git diff --stat origin/main...HEAD
git status --short --branch
```

Expected: only the approved design/plan documents and `src-tauri/src/ssh_tunnels.rs` are changed; no generated build artifacts are tracked.

- [x] **Step 4: Request code review before creating the PR.**

Review the diff against `origin/main` for these requirements:

- no `read_to_end()` remains in SSH stderr handling;
- retained bytes never exceed 64 KiB;
- the reader continues after the limit is reached;
- exit diagnostics await reader completion and retain the tail marker in the regression test;
- existing startup, monitor, stop, and status behavior is unchanged.

- [x] **Step 5: Push the feature branch and create the PR.**

```bash
git push -u origin feat/issue-42-ssh-stderr-bounds
gh pr create \
  --base main \
  --head feat/issue-42-ssh-stderr-bounds \
  --title "fix: bound SSH Tunnel stderr memory" \
  --body "$(cat <<'EOF'
## Summary

- Replace unbounded SSH Tunnel stderr collection with a continuously drained 64 KiB rolling buffer.
- Preserve the latest stderr bytes for exit diagnostics and wait for reader completion.
- Add unit and real-child regression coverage for the memory bound and pipe draining behavior.

## Related issue

Closes #42

## Test plan

- [x] `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml`
- [x] `npm test -- --run`
- [x] `npm run build`
EOF
)"
```
