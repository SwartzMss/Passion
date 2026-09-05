# Issue #38 Resource Bounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement both P1 resource-bound improvements from Issue #38: backend-managed cancellable port-range scanning and bounded, timed script execution.

**Architecture:** Keep single-port diagnostics and the existing script scheduler contract unchanged. Add a focused `PortScanManager`/scan engine behind Tauri commands and events, then replace the frontend batch loop with one backend task. Refactor the script runner around spawned child processes, concurrently drained bounded output readers, and an injectable timeout used by short tests.

**Tech Stack:** Rust 2021, Tokio async process/net/time/sync APIs, Tauri 2 commands/events, React 19, TypeScript, Vitest, Testing Library, Cargo test.

---

## File map

- Create `src-tauri/src/port_scan.rs`: validation, bounded async scan engine, cancellation manager, progress emission abstraction, and Rust tests.
- Modify `src-tauri/src/models.rs`: serializable scan request/progress payloads.
- Modify `src-tauri/src/app_state.rs`: own the shared `PortScanManager`.
- Modify `src-tauri/src/commands.rs`: expose start/stop scan commands and map backend errors to Tauri errors.
- Modify `src-tauri/src/lib.rs`: register the new module and commands.
- Modify `src-tauri/Cargo.toml`: enable Tokio `io-util` and `net` features needed by the new implementation.
- Modify `src/types.ts`: mirror scan request/progress types in camelCase.
- Modify `src/lib/api.ts`: add one-start/one-stop scan wrappers.
- Modify `src/lib/events.ts`: add typed `onPortScanProgress` listener.
- Modify `src/components/network/NetworkDiagnosticsPanel.tsx`: remove the frontend per-port loop and consume backend progress events.
- Modify `src/components/network/NetworkDiagnosticsPanel.test.tsx`: test start/stop/event behavior instead of per-port `checkPort` calls.
- Modify `src-tauri/src/script_runner.rs`: streaming bounded readers, timeout-aware process lifecycle, and Rust tests.

## Task 1: Add the backend scan contract and testable scan engine

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/models.rs`
- Create: `src-tauri/src/port_scan.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the failing validation and scan-engine tests**

In `src-tauri/src/port_scan.rs`, first define the test-facing contracts, then add the tests before production behavior:

```rust
use crate::models::{PortCheckResult, PortScanRequest};
use tokio::sync::watch;
use std::{future::Future, pin::Pin};

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ScanSummary {
    pub completed: u32,
    pub total: u32,
    pub open_ports: Vec<PortCheckResult>,
    pub stopped: bool,
}

pub(crate) trait PortProbe: Clone + Send + Sync + 'static {
    fn probe(
        &self,
        host: String,
        port: u16,
    ) -> Pin<Box<dyn Future<Output = PortCheckResult> + Send>>;
}
```

The production TCP probe implements `PortProbe`; tests provide `TrackingProbe` and `BlockingProbe` with the same interface. The `never_cancel()` helper returns a `watch::Receiver<bool>` whose value remains false.

Then add these tests:

```rust
#[tokio::test]
async fn scan_rejects_invalid_ranges() {
    let err = validate_request(&PortScanRequest {
        host: "127.0.0.1".into(),
        start_port: 0,
        end_port: 80,
    }).unwrap_err();
    assert!(err.to_string().contains("端口范围"));
}

#[tokio::test]
async fn scan_limits_probe_concurrency_to_sixty_four() {
    let probe = TrackingProbe::new();
    scan_ports_with_probe(request(1, 256), probe.clone(), never_cancel()).await.unwrap();
    assert!(probe.max_in_flight() <= 64);
}

#[tokio::test]
async fn scan_stops_when_cancellation_is_requested() {
    let probe = BlockingProbe::new();
    let (cancel, cancel_rx) = watch::channel(false);
    let task = tokio::spawn(scan_ports_with_probe(request(1, 65535), probe.clone(), cancel_rx));
    probe.started().await;
    cancel.send(true).unwrap();
    let progress = task.await.unwrap().unwrap();
    assert!(progress.stopped);
    assert!(progress.completed < progress.total);
}
```

The test helpers must be real async probes, not mocks of the public Tauri command: `TrackingProbe` increments an atomic in-flight counter around a short delay, and `BlockingProbe` waits until cancellation. Define the request helper with host `127.0.0.1` and the supplied inclusive range.

- [ ] **Step 2: Run the focused tests and verify they fail for the intended reason**

Run: `cargo test --manifest-path src-tauri/Cargo.toml port_scan -- --nocapture`

Expected: compilation/test failure because `PortScanRequest`, `validate_request`, `scan_ports_with_probe`, and the test probe helpers do not yet exist.

- [ ] **Step 3: Add the model types and Tokio features**

Add these serde-compatible models to `src-tauri/src/models.rs`:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortScanRequest {
    pub host: String,
    pub start_port: u16,
    pub end_port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortScanProgress {
    pub scan_id: String,
    pub completed: u32,
    pub total: u32,
    pub result: Option<PortCheckResult>,
    pub done: bool,
    pub stopped: bool,
    pub error: Option<String>,
}
```

Add Tokio features `io-util` and `net` to the existing dependency declaration, and add `mod port_scan;` to `src-tauri/src/lib.rs`.

- [ ] **Step 4: Implement the minimal bounded engine**

Implement `validate_request`, `scan_ports_with_probe`, and the production probe with these contracts:

```rust
const MAX_SCAN_CONCURRENCY: usize = 64;
const PORT_CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

pub(crate) async fn scan_ports_with_probe<P>(
    request: PortScanRequest,
    probe: P,
    mut cancel_rx: watch::Receiver<bool>,
) -> BackendResult<ScanSummary>
where
    P: PortProbe + Clone + Send + Sync + 'static,
```

Validate non-empty host, `start_port >= 1`, `end_port <= 65535`, and `start_port <= end_port`. Use exactly 64 worker tasks at most, a shared atomic next-port index, and a semaphore or equivalent guard so only 64 probes can be in flight. Each probe must select between the cancellation receiver and a 3-second async TCP connect. A failed connection produces no open-port result but still increments `completed`; an open connection produces a `PortCheckResult` with elapsed milliseconds. Return a summary containing `completed`, `total`, discovered open results, and `stopped`.

- [ ] **Step 5: Run the focused tests and confirm green**

Run: `cargo test --manifest-path src-tauri/Cargo.toml port_scan -- --nocapture`

Expected: all scan validation, concurrency, and cancellation tests pass.

- [ ] **Step 6: Commit the backend engine**

```bash
git add src-tauri/Cargo.toml src-tauri/src/models.rs src-tauri/src/port_scan.rs src-tauri/src/lib.rs
git commit -m "feat: add bounded cancellable port scan engine"
```

## Task 2: Expose scan lifecycle through Tauri and React

**Files:**
- Modify: `src-tauri/src/port_scan.rs`
- Modify: `src-tauri/src/app_state.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types.ts`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/events.ts`

- [ ] **Step 1: Add the failing frontend API/event tests**

Add a focused test in `src/lib/api.test.ts` (create the file when it does not exist) asserting the wrappers invoke exactly these commands and payloads. Import the module as `* as core` from `@tauri-apps/api/core`, import `startPortScan` and `stopPortScan` from `./api`, and define `const invoke = vi.mocked(core.invoke)` after the module mock:

```ts
it("starts and stops a port scan through Tauri", async () => {
  vi.mocked(core.invoke)
    .mockResolvedValueOnce("scan-1")
    .mockResolvedValueOnce(undefined);
  await startPortScan({ host: "127.0.0.1", startPort: 1, endPort: 3 });
  await stopPortScan("scan-1");
  expect(invoke).toHaveBeenNthCalledWith(1, "start_port_scan", {
    input: { host: "127.0.0.1", startPort: 1, endPort: 3 },
  });
  expect(invoke).toHaveBeenNthCalledWith(2, "stop_port_scan", { scanId: "scan-1" });
});
```

Use the repository’s existing `vi.mock("@tauri-apps/api/core")` pattern. Add a listener test that verifies `onPortScanProgress` subscribes to `port-scan-progress` and forwards the event payload.

- [ ] **Step 2: Run the new tests and verify the expected missing-export failure**

Run: `npm test -- src/lib/api.test.ts`

Expected: FAIL because `startPortScan`, `stopPortScan`, and `onPortScanProgress` are not implemented.

- [ ] **Step 3: Implement the manager and Tauri commands**

Add `PortScanManager` with an `Arc<Mutex<HashMap<String, watch::Sender<bool>>>>` (or a single active entry if enforcing one global scan). Implement:

```rust
pub async fn start(&self, app: AppHandle, request: PortScanRequest) -> BackendResult<String>;
pub async fn stop(&self, scan_id: &str) -> BackendResult<()>;
```

`start` cancels and removes an existing active scan, creates a UUID scan ID and cancellation channel, spawns the scan task, emits `port-scan-progress` for each completed port and a final event with `done: true`, then removes the task registration if the ID is still current. `stop` sends cancellation for the matching ID and returns a `NetworkDiagnostic` error for an unknown ID. Add `port_scan_manager: PortScanManager` to `AppState`, initialize it in `new_with_log_path`, and clone it with the existing state.

Add Tauri commands with the public signatures:

```rust
#[tauri::command]
pub async fn start_port_scan(
    app: AppHandle,
    state: State<'_, AppState>,
    input: PortScanRequest,
) -> CommandResult<String>;

#[tauri::command]
pub async fn stop_port_scan(
    state: State<'_, AppState>,
    scan_id: String,
) -> CommandResult<()>;
```

Register both commands in `generate_handler!`.

- [ ] **Step 4: Implement typed TypeScript wrappers and listener**

Add to `src/types.ts`:

```ts
export interface PortScanRequest { host: string; startPort: number; endPort: number; }
export interface PortScanProgress {
  scanId: string;
  completed: number;
  total: number;
  result?: PortCheckResult | null;
  done: boolean;
  stopped: boolean;
  error?: string | null;
}
```

Add `startPortScan`, `stopPortScan` to `src/lib/api.ts` and `onPortScanProgress` to `src/lib/events.ts`, returning the `UnlistenFn` promise from Tauri’s `listen` API.

- [ ] **Step 5: Run API/event tests and verify green**

Run: `npm test -- src/lib/api.test.ts`

Expected: all wrapper and listener tests pass.

- [ ] **Step 6: Commit the Tauri lifecycle layer**

```bash
git add src-tauri/src/port_scan.rs src-tauri/src/app_state.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/types.ts src/lib/api.ts src/lib/events.ts src/lib/api.test.ts
git commit -m "feat: expose cancellable port scans"
```

## Task 3: Replace the frontend range-scan loop with event-driven state

**Files:**
- Modify: `src/components/network/NetworkDiagnosticsPanel.tsx`
- Modify: `src/components/network/NetworkDiagnosticsPanel.test.tsx`

- [ ] **Step 1: Change the component tests to describe the new behavior**

Update the mocked API to include `startPortScan` and `stopPortScan`, mock `onPortScanProgress` with a controllable handler, and replace per-port assertions with:

```tsx
it("starts one backend scan and renders its progress event", async () => {
  const user = userEvent.setup();
  render(<NetworkDiagnosticsPanel />);
  await user.click(screen.getByRole("button", { name: "范围扫描" }));
  await user.click(screen.getByRole("button", { name: /开始扫描/ }));

  const api = await import("../../lib/api");
  expect(api.startPortScan).toHaveBeenCalledWith({
    host: "127.0.0.1", startPort: 1, endPort: 1024,
  });
  emitProgress({ scanId: "scan-1", completed: 2, total: 3, result: openPort, done: false, stopped: false, error: null });
  expect(await screen.findByText("已发现 1 个开放端口")).toBeInTheDocument();
});

it("stops the active backend scan", async () => {
  const user = userEvent.setup();
  render(<NetworkDiagnosticsPanel />);
  await user.click(screen.getByRole("button", { name: "范围扫描" }));
  await user.click(screen.getByRole("button", { name: /开始扫描/ }));
  await user.click(screen.getByRole("button", { name: "停止扫描" }));
  const api = await import("../../lib/api");
  expect(api.stopPortScan).toHaveBeenCalledWith("scan-1");
});
```

Also assert an event with `scanId: "other-scan"` does not alter the displayed count.

- [ ] **Step 2: Run the changed component tests and verify they fail**

Run: `npm test -- src/components/network/NetworkDiagnosticsPanel.test.tsx`

Expected: FAIL because the component still calls `checkPort` in a frontend loop and has no backend scan event state.

- [ ] **Step 3: Implement event-driven scan state**

Import `useEffect`, `startPortScan`, `stopPortScan`, and `onPortScanProgress`. Replace `ports`, `SCAN_CONCURRENCY`, and the `checkPort` `Promise.all` loop with `activeScanId` state/ref. In `runPortScan`, register the listener before awaiting `startPortScan`; in the handler, ignore mismatched IDs, append only `payload.result?.open`, update `completed`, and on `done` clear the listener, reset the active ID, set stopped/error state, and mark the scan idle. On start failure, await cleanup and show `readError`. `stopPortScan` must call the API for the current ID and leave final state cleanup to the backend done event; if the stop call itself fails, show the error without losing the scan ID.

Keep the existing range validation, large-range warning, result table, and single-port `checkPort` behavior unchanged.

- [ ] **Step 4: Run the component tests and verify green**

Run: `npm test -- src/components/network/NetworkDiagnosticsPanel.test.tsx`

Expected: all network workspace tests pass, including one-start-call, progress rendering, cancellation, and stale-event filtering.

- [ ] **Step 5: Commit the frontend scan integration**

```bash
git add src/components/network/NetworkDiagnosticsPanel.tsx src/components/network/NetworkDiagnosticsPanel.test.tsx
git commit -m "feat: drive port scans from backend events"
```

## Task 4: Add failing tests for bounded script output and timeout

**Files:**
- Modify: `src-tauri/src/script_runner.rs`

- [ ] **Step 1: Add pure bounded-reader and timeout regression tests**

Add tests that exercise the real reader/lifecycle helpers:

```rust
#[tokio::test]
async fn collect_output_keeps_only_the_configured_summary() {
    let input = std::io::Cursor::new(vec![b'x'; 128 * 1024]);
    let output = collect_output(input, 32 * 1024).await.unwrap();
    assert_eq!(output.len(), 32 * 1024);
}

#[tokio::test]
async fn run_script_reports_timeout_and_reaps_child() {
    let task = test_sleeping_task();
    let result = run_script_with_timeout(&task, Duration::from_millis(50)).await;
    assert!(result.error.as_deref().is_some_and(|message| message.contains("超时")));
    assert!(result.finished_at >= result.started_at);
}
```

`test_sleeping_task()` must use the platform’s available command (`sh -c "sleep 1"` on Unix and `powershell.exe -Command "Start-Sleep -Seconds 1"` on Windows) through the existing command-plan parser. The test must not wait for the production five-minute timeout.

- [ ] **Step 2: Run the focused script tests and verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml script_runner -- --nocapture`

Expected: FAIL because the bounded reader and timeout-aware runner do not yet exist, while existing command-plan tests continue to run.

## Task 5: Implement streaming script execution with process timeout

**Files:**
- Modify: `src-tauri/src/script_runner.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add the minimal bounded reader**

Use `tokio::io::{AsyncRead, AsyncReadExt}` and implement:

```rust
const MAX_OUTPUT_BYTES: usize = 32 * 1024;
const MAX_OUTPUT_CHARS: usize = 8000;
const SCRIPT_TIMEOUT: Duration = Duration::from_secs(5 * 60);

async fn collect_output<R: AsyncRead + Unpin>(mut reader: R, max_bytes: usize) -> std::io::Result<Vec<u8>> {
    let mut retained = Vec::with_capacity(max_bytes.min(4096));
    let mut chunk = [0_u8; 4096];
    loop {
        let read = reader.read(&mut chunk).await?;
        if read == 0 { break; }
        let remaining = max_bytes.saturating_sub(retained.len());
        retained.extend_from_slice(&chunk[..read.min(remaining)]);
    }
    Ok(retained)
}
```

Continue reading after the retained limit is reached so the child cannot block on a full pipe. Convert returned bytes with `String::from_utf8_lossy`, then apply the existing character truncation and `non_empty_output` behavior.

- [ ] **Step 2: Implement timeout-aware child lifecycle**

Add `run_script_with_timeout(task, timeout)` and make `run_script` call it with `SCRIPT_TIMEOUT`. Spawn the command with `stdout(Stdio::piped())` and `stderr(Stdio::piped())`, take both pipes, and run `collect_output` concurrently with `child.wait()`. On timeout, call `child.kill().await`, then `child.wait().await`, await both readers, and return a `ScriptExecutionResult` containing collected summaries plus `error: Some("脚本执行超时（超过 5 分钟）。".to_string())` for the production timeout. Preserve the existing startup-error text and exit-code behavior for normal completion.

Update `run_script`/`run_script_with_timeout` so output is retained even when timeout occurs; only startup failures have no output. The `io-util` feature was added in Task 1 and must remain enabled.

- [ ] **Step 3: Run script tests and verify green**

Run: `cargo test --manifest-path src-tauri/Cargo.toml script_runner -- --nocapture`

Expected: bounded-reader, timeout, command-plan, argument parser, and output truncation tests all pass.

- [ ] **Step 4: Commit the script runner change**

```bash
git add src-tauri/Cargo.toml src-tauri/src/script_runner.rs
git commit -m "feat: bound script output and execution time"
```

## Task 6: Full verification and PR preparation

**Files:**
- Modify only files required by failing verification; do not include unrelated formatting or P2/P3 work.

- [ ] **Step 1: Run Rust formatting and tests**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

Expected: exit 0 with no formatting diff.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: all Rust tests pass.

- [ ] **Step 2: Run frontend tests and build**

Run: `npm test`

Expected: Vitest exits 0 with zero failed tests.

Run: `npm run build`

Expected: TypeScript compilation and Vite production build exit 0.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff --check && git status --short && git diff --stat origin/main...HEAD`

Expected: no whitespace errors; only Issue #38 design/implementation files and their commits are present; no generated build output is staged.

- [ ] **Step 4: Push the feature branch and create the PR**

Create an isolated feature branch/worktree before implementation if the execution workflow requires it, then push the implementation branch:

```bash
git push -u origin feat/issue-38-resource-bounds
gh pr create --repo SwartzMss/Passion --base main --head feat/issue-38-resource-bounds --title "feat: bound high-load resource usage" --body-file /tmp/issue-38-pr-body.md
```

The PR body must summarize both P1 changes, list the commands actually run with their observed results, and include `Closes #38` only if the PR fully satisfies the issue’s completion standard. If the platform branch is already the current branch, use its exact name in `--head`.
