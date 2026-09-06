# Issue #42 SSH Tunnel stderr Bounds Design

## Goal

Bound SSH Tunnel stderr memory usage while preserving useful recent diagnostics for long-running tunnels.

## Scope

- Replace the unbounded `read_to_end()` stderr collection with a streaming reader.
- Retain at most 64 KiB of stderr bytes in a rolling buffer.
- Continue draining stderr after the retained buffer reaches the limit so the SSH child cannot block on a full pipe.
- Preserve the latest stderr bytes, because they are the most useful context when a tunnel exits.
- Wait for the stderr reader to finish before formatting an exit diagnostic, so bytes written just before process exit are included.
- Keep existing SSH tunnel start, stop, monitoring, and status behavior unchanged.
- Add regression coverage for a real child process that writes beyond the configured limit.

This change does not add automatic reconnect, a user-configurable buffer size, or other SSH Tunnel features.

## Architecture and data flow

`SshTunnelManager::start` will continue to configure the child with a piped stderr. After taking `child.stderr`, it will create a `StderrCapture` containing a shared `StderrRingBuffer` and the reader task handle.

The reader task will repeatedly read a fixed-size byte chunk from stderr. Each chunk will be appended to `StderrRingBuffer`, implemented with `VecDeque<u8>`. When appending would exceed `SSH_STDERR_BUFFER_LIMIT_BYTES` (`64 * 1024`), the oldest bytes will be removed first. The deque is initialized at the limit, so retained memory stays bounded and no complete process-lifetime output is accumulated.

The capture object will be passed to the startup-exit path or long-running monitor. Before `stderr_suffix` formats diagnostics, it will wait up to one second for the reader task, ensuring normal closed pipes are fully drained without allowing an inherited pipe handle to block the state machine forever. If the grace period expires, the reader task will be aborted and the current rolling buffer will be used. The existing `String::from_utf8_lossy` conversion and diagnostic message format remain unchanged.

## Error handling and lifecycle behavior

- A stderr read error ends the reader task; already-retained bytes remain available for diagnostics.
- The reader task is independent of SSH process polling, so stderr continues to drain while the process is alive.
- After the main SSH process exits, diagnostic collection waits at most one second for stderr EOF; a timeout aborts the reader task and keeps the current bounded buffer.
- Startup, running, stopping, exited, and error state transitions remain unchanged.
- Stopping a tunnel still uses the existing process-tree termination path. The monitor may finish its reader task after termination without changing the stopped status behavior.
- The 64 KiB limit is a backend constant and is documented in the source and this design document.

## Testing strategy

### Ring-buffer unit tests

- A payload at or below the limit is retained unchanged.
- A payload above the limit retains exactly the latest limit bytes.
- UTF-8 text is converted with lossy decoding only at the diagnostic boundary, not while enforcing the byte limit.
- A capture whose pipe stays open returns after the one-second grace period instead of waiting forever.

### Real child-process regression test

The test binary will launch itself in a helper-test mode. The helper writes more than 64 KiB to stderr and then emits a distinctive tail marker. The test attaches the production stderr reader, waits for the child with a timeout, waits for reader completion, and asserts that:

- the child exits instead of blocking on a full stderr pipe;
- the retained buffer length is exactly the configured limit;
- the tail marker is present in the retained diagnostics; and
- old prefix bytes have been evicted.

This exercises the real child pipe and the continuous-drain behavior on supported platforms without depending on an external shell or interpreter.

## Acceptance criteria mapping

| Requirement | Design response |
| --- | --- |
| No unbounded stderr growth | Streaming reader plus a fixed 64 KiB byte ring buffer |
| stderr remains drained | Reader continues reading and discarding old bytes after the limit is reached |
| Useful exit diagnostics without a lifecycle hang | Latest bytes are retained; the reader gets a one-second grace period before timeout abort |
| Existing lifecycle unchanged | Only stderr capture is replaced; process and runtime state logic is preserved |
| Regression coverage | Real child-process test writes beyond the limit and verifies completion and tail retention |

## Out of scope

- Automatic SSH reconnect.
- Configurable stderr limits in settings or the UI.
- Persisting the complete stderr stream.
- Changes to SSH arguments, startup timing, process termination, or tunnel status semantics.
