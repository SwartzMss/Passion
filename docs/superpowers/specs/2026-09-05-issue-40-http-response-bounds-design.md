# Issue #40 HTTP Tester Response Bounds Design

## Goal

Bound the HTTP Tester response body memory usage with a fixed 10 MiB limit, while preserving the existing behavior for small responses and clearly indicating truncation in the UI.

## Scope

- Stream HTTP response bytes in the Rust backend instead of calling an unbounded full-body text read.
- Retain at most 10 MiB of response body bytes.
- Stop consuming the response once the limit is exceeded.
- Add a serialized `truncated` flag to the backend/frontend response model.
- Show a visible truncation indicator beside the existing response metadata.
- Keep formatting, copying, status, headers, timing, and small-response behavior unchanged.

This change does not add a settings control for the limit. The backend constant is the single source of truth for this iteration.

## Architecture and data flow

`send_http_request` will continue to build and send the request as it does today. After receiving headers, it will read the response through `Response::chunk()` in a loop. The reader will append only the portion needed to reach the 10 MiB cap, count retained bytes, and set `truncated` when a chunk would exceed the cap or when the response `Content-Length` is known to exceed it. Once truncation is known from body data, the loop will stop and the response will be dropped without reading the remaining body.

The bounded bytes will be decoded with `encoding_rs`, using the response `Content-Type` charset when present, UTF-8 otherwise, and the same BOM handling as reqwest's existing text path. This preserves the displayed text behavior while avoiding a panic when a byte limit splits a multibyte character. `size_bytes` is explicitly defined as the number of retained raw response bytes, which is the accurate received-byte metric for the resource limit.

The response model will add `truncated: bool`, serialized as `truncated` by the existing camelCase serde convention. The TypeScript `HttpApiResponse` will mirror this field. The panel will append a clear `已截断` label to the response metadata only when the flag is true.

## Error handling

- Network and body-read errors remain `BackendError::HttpApi` errors.
- A response that exceeds the limit is a successful response with the retained body and `truncated: true`.
- The existing status, headers, elapsed time, and received timestamp are still returned for successful responses.
- No unbounded allocation is introduced by the response reader; the retained body capacity is capped at 10 MiB.

## Testing strategy

### Rust

- Extend the existing local HTTP server test to assert `truncated == false` for a normal response.
- Add a local HTTP server test whose body is one byte larger than the limit and assert that the returned body length is exactly the limit, `size_bytes` equals the retained length, and `truncated == true`.
- Add a local HTTP server test with a non-UTF-8 `Content-Type` charset and assert that decoded text, retained raw-byte count, and `truncated == false` are correct on the real request path.
- Keep the non-HTTP URL validation test unchanged.

### Frontend

- Update mocked responses to include `truncated: false`.
- Add a panel test with `truncated: true` and assert that the visible truncation label is rendered.
- Preserve the existing request and normal response metadata assertions.

## Acceptance criteria mapping

| Requirement | Design response |
| --- | --- |
| No uncontrolled memory growth | Stream chunks and retain at most 10 MiB |
| Safely truncate oversized responses | Stop after the cap and return a successful bounded response |
| Clearly indicate truncation | Add `truncated` to the model and render `已截断` in the panel |
| Small responses unchanged | Keep request flow, status, headers, timing, and decoded text behavior intact; `size_bytes` is the documented retained raw-byte count |

## Out of scope

- Configurable response limits in settings or the HTTP Tester UI.
- Persisting response history.
- Content-type-specific parsing or download support.
