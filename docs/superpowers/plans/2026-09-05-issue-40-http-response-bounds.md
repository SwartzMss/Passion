# HTTP Tester Response Bounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound HTTP Tester response-body memory at 10 MiB and expose a clear truncation state to the UI.

**Architecture:** Keep request construction and response metadata collection in `send_http_request`, but replace `Response::text()` with a bounded `Response::chunk()` loop. The loop stores at most 10 MiB, stops once overflow is detected, and returns a `truncated` boolean alongside the retained UTF-8-lossy text. The Rust and TypeScript response models carry the new flag, and the existing panel renders a warning only for truncated responses.

**Tech Stack:** Rust 2021, Tokio, reqwest 0.12, serde camelCase models, React 19, TypeScript, Vitest, Testing Library.

---

## File map

- Modify `src-tauri/src/http_tester.rs`: define the cap, stream response chunks, and test bounded responses.
- Modify `src-tauri/src/models.rs`: add `truncated: bool` to `HttpApiResponse`.
- Modify `src/types.ts`: mirror `truncated` in `HttpApiResponse`.
- Modify `src/components/http/HttpApiTesterPanel.tsx`: render the truncation label.
- Modify `src/components/http/HttpApiTesterPanel.test.tsx`: update mocks and test the warning.
- Modify `src/styles.css`: style the warning.

### Task 1: Add the response contract and failing backend tests

**Files:** `src-tauri/src/models.rs`, `src/types.ts`, `src-tauri/src/http_tester.rs`.

- [ ] **Step 1: Extend both response models.** Add `truncated: bool` after `size_bytes` in Rust and `truncated: boolean` after `sizeBytes` in TypeScript.

- [ ] **Step 2: Update the small-response Rust test.** In `sends_http_request_with_headers_query_and_body`, add:

```rust
assert!(!response.truncated);
```

- [ ] **Step 3: Add the oversized-response regression test.** Add this test inside `src-tauri/src/http_tester.rs::tests`:

```rust
#[tokio::test]
async fn truncates_responses_that_exceed_the_memory_limit() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
    let address = listener.local_addr().expect("local addr");
    let body = vec![b'a'; super::MAX_RESPONSE_BODY_BYTES + 1];
    let content_length = body.len();
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept request");
        let mut request = [0; 1024];
        stream.read(&mut request).expect("read request");
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-length: {content_length}\r\n\r\n"
        )
        .expect("write response headers");
        stream.write_all(&body).expect("write response body");
    });

    let response = super::send_http_request(HttpApiRequest {
        method: "GET".to_string(),
        url: format!("http://{address}/large"),
        headers: vec![],
        query: vec![],
        body: None,
    })
    .await
    .expect("send request");

    handle.join().expect("server thread");
    assert_eq!(response.body.len(), super::MAX_RESPONSE_BODY_BYTES);
    assert_eq!(response.size_bytes, super::MAX_RESPONSE_BODY_BYTES);
    assert!(response.truncated);
}
```

- [ ] **Step 4: Run the focused test before implementation.** Run `cargo test --manifest-path src-tauri/Cargo.toml http_tester::tests -- --nocapture`. Expected: compilation failure for the missing constant/field, not a test typo.

### Task 2: Implement bounded streaming in Rust

**Files:** `src-tauri/src/http_tester.rs`, `src-tauri/src/models.rs`.

- [ ] **Step 1: Define the fixed cap.** Add `const MAX_RESPONSE_BODY_BYTES: usize = 10 * 1024 * 1024;` beside `DEFAULT_TIMEOUT_SECONDS`.

- [ ] **Step 2: Replace the unbounded `response.text()` read.** After headers are collected, use this bounded loop:

```rust
let content_length_exceeds_limit = response
    .content_length()
    .is_some_and(|length| length > MAX_RESPONSE_BODY_BYTES as u64);
let mut body_bytes = Vec::with_capacity(
    response
        .content_length()
        .map(|length| (length as usize).min(MAX_RESPONSE_BODY_BYTES))
        .unwrap_or(0),
);
let mut truncated = content_length_exceeds_limit;

loop {
    let chunk = response
        .chunk()
        .await
        .map_err(|err| BackendError::HttpApi(err.to_string()))?;
    let Some(chunk) = chunk else { break };
    let remaining = MAX_RESPONSE_BODY_BYTES.saturating_sub(body_bytes.len());
    if chunk.len() > remaining {
        body_bytes.extend_from_slice(&chunk[..remaining]);
        truncated = true;
        break;
    }
    body_bytes.extend_from_slice(&chunk);
    if truncated && body_bytes.len() == MAX_RESPONSE_BODY_BYTES {
        break;
    }
}

let size_bytes = body_bytes.len();
let body = String::from_utf8_lossy(&body_bytes).into_owned();
```

This preserves small responses, caps retained memory, and stops after the cap once overflow is known. Include `size_bytes` and `truncated` in the `HttpApiResponse` initializer.

- [ ] **Step 3: Run focused and complete backend tests.** Run `cargo test --manifest-path src-tauri/Cargo.toml http_tester::tests -- --nocapture`, then `cargo test --manifest-path src-tauri/Cargo.toml`. Expected: exit code 0 for both.

- [ ] **Step 4: Commit the backend change.** Run:

```bash
git add src-tauri/src/http_tester.rs src-tauri/src/models.rs
git commit -m "feat: bound http tester response bodies"
```

### Task 3: Render truncation in the React panel

**Files:** `src/components/http/HttpApiTesterPanel.tsx`, `src/components/http/HttpApiTesterPanel.test.tsx`, `src/styles.css`, `src/types.ts`.

- [ ] **Step 1: Update the default mocked response.** Add `truncated: false` to the mock in `HttpApiTesterPanel.test.tsx`.

- [ ] **Step 2: Add a failing UI test.** Add this test, using `userEvent` and the existing `sendHttpRequest` mock:

```tsx
it("shows when the response body was truncated", async () => {
  const api = await import("../../lib/api");
  vi.mocked(api.sendHttpRequest).mockResolvedValueOnce({
    status: 200,
    statusText: "OK",
    elapsedMs: 42,
    sizeBytes: 10 * 1024 * 1024,
    truncated: true,
    receivedAt: "2026-06-28T14:30:00Z",
    headers: [],
    body: "retained response",
  });
  const user = userEvent.setup();
  render(<HttpApiTesterPanel />);
  await user.click(screen.getByRole("button", { name: /发送/ }));
  expect(await screen.findByText("已截断")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run the focused test and verify it fails.** Run `npm test -- --run src/components/http/HttpApiTesterPanel.test.tsx`. Expected: only the new `已截断` assertion fails.

- [ ] **Step 4: Render and style the warning.** In `.http-response-meta`, after the size span, add:

```tsx
{response.truncated ? (
  <span className="http-response-truncated" role="status">已截断</span>
) : null}
```

After `.http-response-meta strong`, add:

```css
.http-response-truncated {
  color: #b54708;
  font-weight: 800;
}
```

- [ ] **Step 5: Run focused tests, the full frontend suite, and the build.** Run `npm test -- --run src/components/http/HttpApiTesterPanel.test.tsx`, `npm test -- --run`, and `npm run build`. Expected: all tests and the build exit 0.

- [ ] **Step 6: Commit the UI change.** Run:

```bash
git add src/components/http/HttpApiTesterPanel.tsx src/components/http/HttpApiTesterPanel.test.tsx src/styles.css src/types.ts
git commit -m "feat: show truncated http responses"
```

### Task 4: Verify, review, push, and create the PR

- [ ] **Step 1: Inspect the complete diff.** Run `git diff origin/main...HEAD --stat`, `git diff origin/main...HEAD --check`, and `git status --short --branch`. Expected: only the spec, plan, and scoped HTTP Tester files are changed; no whitespace errors; clean worktree.

- [ ] **Step 2: Re-run final verification.** Run `npm test -- --run`, `npm run build`, and `cargo test --manifest-path src-tauri/Cargo.toml`. Expected: all commands exit 0.

- [ ] **Step 3: Request code review against base `b339ab8` and final `HEAD`.** Fix Critical/Important findings and rerun affected tests.

- [ ] **Step 4: Push and create the PR.** Run:

```bash
git push -u origin feat/issue-40-http-response-bounds
gh pr create --base main --head feat/issue-40-http-response-bounds --title "feat: bound HTTP Tester response memory" --body "Closes #40\n\nAdds a 10 MiB streaming response-body cap to HTTP Tester, exposes truncation metadata, and shows a UI warning for truncated responses.\n\nVerification: npm test -- --run; npm run build; cargo test --manifest-path src-tauri/Cargo.toml"
```
