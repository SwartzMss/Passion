# Windows CI 进程树测试稳定性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or **superpowers:executing-plans** to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax.

**Goal:** Make the Windows Rust test workflow reliably validate process-tree cleanup without depending on flaky PowerShell startup timing or moving \`windows-latest\` images.

**Architecture:** Keep \`run_script_inner\` and \`windows_job::JobObject\` behavior unchanged. Stabilize only the Windows tests with a process-test mutex, per-test \`tempfile::TempDir\`, and a parent-side launch marker; pin the test workflow to \`windows-2022\` and run Rust tests serially so process-lifecycle tests do not compete with unrelated child-process tests.

**Tech Stack:** Rust 2021, Tokio tests, \`tempfile\`, GitHub Actions Windows runner.

---

## File map

- Modify: \`src-tauri/src/script_runner.rs\` — Windows test synchronization, temporary files, and process-launch test scripts.
- Modify: \`.github/workflows/windows-test.yml\` — pin the runner and serialize Cargo tests.
- No production changes: \`run_script_inner\` and \`src-tauri/src/windows_job.rs\` remain unchanged.

### Task 1: Make Windows process-tree tests deterministic

**Files:**
- Modify: \`src-tauri/src/script_runner.rs\` in \`#[cfg(test)] mod tests\`.

- [ ] **Step 1: Add a Windows-only test mutex and bounded marker wait helper**

Add these definitions near the start of the test module:

~~~
    #[cfg(windows)]
    static WINDOWS_PROCESS_TEST_LOCK: std::sync::OnceLock<std::sync::Mutex<()>> =
        std::sync::OnceLock::new();

    #[cfg(windows)]
    fn windows_process_test_lock() -> &'static std::sync::Mutex<()> {
        WINDOWS_PROCESS_TEST_LOCK.get_or_init(|| std::sync::Mutex::new(()))
    }

    #[cfg(windows)]
    async fn wait_for_path(path: &Path, timeout: Duration) -> bool {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if path.exists() {
                return true;
            }
            if tokio::time::Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }
~~~

The mutex serializes the two tests that directly exercise Job Object lifecycle. The helper retries only filesystem observation and has a hard deadline; it must not be used to extend the script timeout.

- [ ] **Step 2: Rewrite the descendant timeout test to mark parent-side launch**

At the beginning of \`run_script_times_out_when_windows_descendant_keeps_output_pipe_open\`, acquire the mutex and replace the four process-specific paths with a unique temporary directory:

~~~
        let _guard = windows_process_test_lock()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let temp_dir = tempfile::tempdir().unwrap();
        let started_marker_path = temp_dir.path().join("started.txt");
        let alive_marker_path = temp_dir.path().join("alive.txt");
        let child_script_path = temp_dir.path().join("child.ps1");
        let parent_script_path = temp_dir.path().join("parent.ps1");
        let quote_path = |path: &Path| path.to_string_lossy().replace('\'', "''");
~~~

Keep the child script as a real descendant that inherits the output pipe, but let the parent write the launch marker immediately after \`Start-Process\` returns. Use a long child sleep and no parent polling loop:

~~~
        std::fs::write(
            &child_script_path,
            format!(
                "Start-Sleep -Seconds 30\nSet-Content -LiteralPath '{}' -Value alive\n",
                quote_path(&alive_marker_path)
            ),
        )
        .unwrap();
        std::fs::write(
            &parent_script_path,
            format!(
                "$child = Start-Process powershell.exe -NoNewWindow -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','{}') -PassThru\nSet-Content -LiteralPath '{}' -Value launched\nexit 0\n",
                quote_path(&child_script_path),
                quote_path(&started_marker_path)
            ),
        )
        .unwrap();
~~~

Use a 10-second outer timeout, then wait at most one second for the parent-side marker, and verify the descendant did not reach its delayed alive marker:

~~~
        let result = run_script_with_timeout(&task, Duration::from_secs(10)).await;

        assert!(result
            .error
            .as_deref()
            .is_some_and(|message| message.contains("超时")));
        assert!(started.elapsed() < Duration::from_secs(11));
        assert!(wait_for_path(&started_marker_path, Duration::from_secs(1)).await);

        tokio::time::sleep(Duration::from_secs(1)).await;
        assert!(!alive_marker_path.exists());
~~~

\`TempDir\` performs cleanup after the test. The parent marker proves \`Start-Process\` returned; the child’s delayed marker verifies that timeout cleanup terminated the descendant before it could finish.

- [ ] **Step 3: Make the preserve-process test use the same mutex and a generous assertion deadline**

Add the same lock acquisition as the first Windows test, and use a short real sleep with a 10-second observation limit:

~~~
        let _guard = windows_process_test_lock()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-Command", "Start-Sleep -Milliseconds 250"]);
        let mut child = command.spawn().unwrap();
        let job = windows_job::JobObject::attach(&child).unwrap();
        job.preserve_processes().unwrap();
        drop(job);

        let status = tokio::time::timeout(Duration::from_secs(10), child.wait())
            .await
            .unwrap()
            .unwrap();
        assert!(status.success());
~~~

- [ ] **Step 4: Run the focused Rust tests and inspect the diff**

Run:

~~~
cargo test --manifest-path src-tauri/Cargo.toml script_runner::tests
git diff --check
~~~

Expected on the current Linux environment: the non-Windows \`script_runner\` tests pass; Windows-only additions are compile-gated and therefore skipped. The diff check exits successfully.

- [ ] **Step 5: Commit the test stabilization**

~~~
git add src-tauri/src/script_runner.rs
git commit -m "test: stabilize Windows process tree coverage"
~~~

### Task 2: Pin and serialize the Windows test workflow

**Files:**
- Modify: \`.github/workflows/windows-test.yml\`.

- [ ] **Step 1: Pin the Windows runner**

Change the Rust job from:

~~~
    runs-on: windows-latest
~~~

to:

~~~
    runs-on: windows-2022
~~~

- [ ] **Step 2: Serialize Cargo’s test harness**

Change the test command from:

~~~
        run: cargo test
~~~

to:

~~~
        run: cargo test -- --test-threads=1
~~~

Leave the build step unchanged so the workflow still checks a normal backend build after tests.

- [ ] **Step 3: Validate YAML scope and commit the workflow change**

Run:

~~~
git diff --check
git diff -- .github/workflows/windows-test.yml
~~~

Expected: only the runner label and Cargo test argument change. Then commit:

~~~
git add .github/workflows/windows-test.yml
git commit -m "ci: stabilize Windows Rust tests"
~~~

### Task 3: Full local verification

**Files:**
- Inspect only; no additional source changes.

- [ ] **Step 1: Run the full Rust test suite**

Run:

~~~
cargo test --manifest-path src-tauri/Cargo.toml
~~~

Expected: exit code 0 with no failed tests on Linux.

- [ ] **Step 2: Check formatting and build**

Run:

~~~
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo build --manifest-path src-tauri/Cargo.toml
~~~

Expected: both commands exit code 0.

- [ ] **Step 3: Confirm the final scope**

Run:

~~~
git diff HEAD~2..HEAD --check
git status --short --branch
~~~

Expected: no whitespace errors; only the test stabilization, workflow change, and their documentation commits are present. The remote Windows Actions run remains the final validation for Windows-only behavior.

