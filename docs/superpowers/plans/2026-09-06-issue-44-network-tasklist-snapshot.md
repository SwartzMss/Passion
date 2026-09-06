# Issue #44 Network Diagnostics tasklist Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-PID `tasklist /FI` process lookups in Network Diagnostics with one full `tasklist /FO CSV /NH` snapshot per query, while preserving existing output, Windows process-launch behavior, decoding, and missing-process semantics.

**Architecture:** Keep `netstat -ano -p tcp` as the source of port/PID data. Deduplicate the requested PIDs, invoke `tasklist` once when the set is non-empty, parse its CSV rows into `HashMap<u32, String>`, and filter that snapshot in memory for each query. A failed tasklist invocation produces an empty map, matching the existing best-effort lookup behavior.

**Tech Stack:** Rust, Tauri backend, `std::process::Command`, `HashMap`/`HashSet`, Rust unit tests, Cargo tests, npm build/test.

---

## Task 1: Add failing parser and PID-selection tests

**Files:**
- Modify: `src-tauri/src/network_diagnostics.rs` (unit tests near the existing tasklist parser test)

- [x] Add a regression test covering multiple CSV rows, duplicate-safe mapping, quoted commas in process names, `INFO:` rows, and malformed PIDs:

```rust
#[test]
fn parse_tasklist_maps_multiple_rows_and_ignores_invalid_rows() {
    let output = r#"
"node.exe","1234","Console","1","50,000 K"
"ssh.exe","5678","Console","1","12,000 K"
INFO: No tasks are running which match the specified criteria.
"broken.exe","not-a-pid","Console","1","1,000 K"
"worker,with-comma.exe","9012","Console","1","2,000 K"
"#;

    let processes = parse_tasklist_processes(output);

    assert_eq!(processes.len(), 3);
    assert_eq!(processes.get(&1234), Some(&"node.exe".to_string()));
    assert_eq!(processes.get(&5678), Some(&"ssh.exe".to_string()));
    assert_eq!(
        processes.get(&9012),
        Some(&"worker,with-comma.exe".to_string())
    );
}
```

- [x] Add a test proving requested PIDs are deduplicated and missing PIDs are ignored when selecting names from a snapshot:

```rust
#[test]
fn select_process_names_deduplicates_requested_pids_and_ignores_missing() {
    let snapshot = HashMap::from([
        (1234, "node.exe".to_string()),
        (5678, "ssh.exe".to_string()),
    ]);

    let selected = select_process_names(&snapshot, [1234, 1234, 9999, 5678]);

    assert_eq!(selected.len(), 2);
    assert_eq!(selected.get(&1234), Some(&"node.exe".to_string()));
    assert_eq!(selected.get(&5678), Some(&"ssh.exe".to_string()));
    assert!(!selected.contains_key(&9999));
}
```

- [x] Update the existing single-row tasklist test to assert the parsed PID/name map rather than the soon-to-be-removed single-name helper.
- [x] Run the focused tests and confirm they fail because the new parser/selection helpers do not exist yet:

```bash
cargo test --manifest-path src-tauri/Cargo.toml network_diagnostics::tests -- --test-threads=1
```

Expected result: compilation fails with missing `parse_tasklist_processes` and/or `select_process_names` symbols.

## Task 2: Implement one-shot tasklist snapshot parsing

**Files:**
- Modify: `src-tauri/src/network_diagnostics.rs`

- [x] Import `HashSet` alongside `HashMap`.
- [x] Replace the per-PID `lookup_process_names`/`lookup_process_name` implementation with a collection-based lookup that:
  - collects requested PIDs into a `HashSet`;
  - returns immediately without spawning `tasklist` for an empty set;
  - invokes `tasklist` exactly once with `[/FO, CSV, /NH]`;
  - preserves `background_command`, success checking, and `decode_output` behavior;
  - returns an empty map if spawning or tasklist execution fails;
  - filters the full snapshot to the requested PIDs in memory.
- [x] Implement `parse_tasklist_processes` and a row parser that reads the first two CSV fields, supports quoted fields and escaped quotes, ignores blank/`INFO:`/malformed rows, and parses the PID as `u32`.
- [x] Keep process names unchanged, including names containing commas; do not alter public models or query result formatting.
- [x] Run the focused tests and confirm they pass:

```bash
cargo test --manifest-path src-tauri/Cargo.toml network_diagnostics::tests -- --test-threads=1
```

## Task 3: Wire the snapshot into both diagnostics query paths

**Files:**
- Modify: `src-tauri/src/network_diagnostics.rs`

- [x] In `inspect_port_occupancy`, pass the parsed netstat entry PIDs directly to the one-shot lookup and keep the existing per-entry `process_name` assignment.
- [x] In `inspect_process_ports`, collect/deduplicate PIDs from netstat, add the numeric query PID even if it is absent from netstat, perform one lookup, and leave `resolve_process_query` and response construction unchanged.
- [x] Verify no per-PID filter remains and no more than one tasklist invocation is reachable from either query:

```bash
rg -n "lookup_process_name|PID eq|tasklist|inspect_port_occupancy|inspect_process_ports" src-tauri/src/network_diagnostics.rs
```

- [x] Format and run focused verification:

```bash
rustfmt --edition 2021 --check src-tauri/src/network_diagnostics.rs
cargo test --manifest-path src-tauri/Cargo.toml network_diagnostics::tests -- --test-threads=1
```

Expected result: no formatting changes are reported and all Network Diagnostics tests pass.

## Task 4: Run repository verification and prepare the PR

**Files:**
- Verify: `src-tauri/src/network_diagnostics.rs`
- Verify: `docs/superpowers/specs/2026-09-06-issue-44-network-tasklist-snapshot-design.md`
- Verify: `docs/superpowers/plans/2026-09-06-issue-44-network-tasklist-snapshot.md`

- [x] Run the complete backend test suite sequentially:

```bash
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
```

Expected result: the baseline 121 tests plus the new regression tests pass; any platform-specific pre-existing failure is recorded precisely.

- [x] Run frontend verification without changing dependencies:

```bash
npm test -- --run
npm run build
```

- [x] Check the final diff and whitespace:

```bash
git diff --check
git status --short
git diff --stat origin/main...HEAD
```

Expected result: only the scoped backend change and the Issue #44 design/plan documents are present.

- [x] Commit the implementation with a focused message:

```bash
git add src-tauri/src/network_diagnostics.rs
git commit -m "fix: snapshot tasklist once per network query"
```

- [ ] Request a code review of the final diff, then push `feat/issue-44-tasklist-snapshot` and create a PR targeting `main`, linking Issue #44 and documenting verification results.
