# Issue #38 HTTP Client Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse one process-level `reqwest::Client` for all HTTP Tester requests while preserving the existing timeout, request behavior, and error mapping.

**Architecture:** Keep the public `send_http_request(HttpApiRequest)` API unchanged. Add a private `OnceLock<Result<Client, String>>` in `http_tester.rs`, initialize it lazily with the existing 30-second timeout, and use the cached client to create per-request builders. The cached result preserves initialization failures as `BackendError::HttpApi` without panicking.

**Tech Stack:** Rust 2021, Tokio tests, reqwest 0.12, std `OnceLock`.

---

## File map

- Modify: `src-tauri/src/http_tester.rs` — cached client provider, request call site, and unit test.
- No changes: `src-tauri/src/commands.rs` — the Tauri command continues calling the same function.

### Task 1: Cache the HTTP Tester client

**Files:**
- Modify: `src-tauri/src/http_tester.rs`

- [ ] **Step 1: Write the failing client-reuse test**

Add this test inside the existing `#[cfg(test)] mod tests` before adding the provider implementation:

```rust
#[test]
fn http_client_provider_returns_the_same_instance() {
    let first = super::http_client().expect("client should initialize");
    let second = super::http_client().expect("client should initialize");

    assert!(std::ptr::eq(first, second));
}
```

- [ ] **Step 2: Run the focused test and verify the intended failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml http_tester::tests::http_client_provider_returns_the_same_instance -- --nocapture`

Expected: compilation failure because `http_client` does not exist yet.

- [ ] **Step 3: Implement the cached provider and use it for requests**

Update the imports and add the cached provider next to `DEFAULT_TIMEOUT_SECONDS`:

```rust
use std::sync::OnceLock;

static HTTP_CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();

fn http_client() -> BackendResult<&'static Client> {
    HTTP_CLIENT
        .get_or_init(|| {
            Client::builder()
                .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECONDS))
                .build()
                .map_err(|err| err.to_string())
        })
        .as_ref()
        .map_err(|err| BackendError::HttpApi(err.clone()))
}
```

In `send_http_request`, remove the per-call `Client::builder().timeout(...).build()` block and replace it with:

```rust
let client = http_client()?;
let mut request = client.request(method.clone(), url);
```

Keep all header, body, send, response, and error handling unchanged.

- [ ] **Step 4: Run the focused tests and confirm green**

Run: `cargo test --manifest-path src-tauri/Cargo.toml http_tester -- --nocapture`

Expected: the client identity test and existing HTTP request tests pass.

- [ ] **Step 5: Format and inspect the diff**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check && git diff --check`

Expected: both commands exit successfully with no formatting or whitespace errors.

- [ ] **Step 6: Commit the implementation**

```bash
git add src-tauri/src/http_tester.rs
git commit -m "perf: reuse HTTP tester client"
```

### Task 2: Full verification before the PR

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
