# Issue #44 Network Diagnostics tasklist Snapshot Design

## Goal

Resolve Windows process names for each Network Diagnostics query with at most one full `tasklist` invocation, while preserving current query semantics, output models, decoding, and background-process behavior.

## Scope

- Replace per-PID `tasklist /FI "PID eq ..."` calls with one `tasklist /FO CSV /NH` snapshot per query that needs process names.
- Parse the snapshot into a `HashMap<u32, String>` keyed by PID.
- Filter the snapshot by the unique PIDs relevant to the current port-occupancy or process-port query.
- Include a numeric process query PID in the requested set even when it is absent from `netstat`, preserving the current direct PID lookup behavior.
- Keep `netstat -ano -p tcp`, `background_command`, Windows no-console-window flags, GBK/UTF-8 decoding, response models, and frontend behavior unchanged.

This change does not add cross-request process caching, replace `netstat`, or refactor unrelated Network Diagnostics code.

## Architecture and data flow

`lookup_process_snapshot` will execute `tasklist /FO CSV /NH` through the existing `background_command` helper. It will decode stdout/stderr with the existing `decode_output` path and parse all valid rows into a process snapshot map.

`parse_tasklist_processes` will parse the process-name and PID columns from each CSV row. Invalid rows, rows without a numeric PID, and diagnostic `INFO:` lines will be ignored. A separate filtering helper will deduplicate the requested PID iterator and return only snapshot entries whose PIDs are relevant to the current query.

`inspect_port_occupancy` will keep its current `netstat` parsing, collect the unique PIDs from matching listening entries, fetch one snapshot when that set is non-empty, and attach names from the filtered map.

`inspect_process_ports` will keep its current `netstat` parsing and query resolution. It will collect all netstat PIDs, add the numeric query PID when applicable, fetch one snapshot, then resolve the query and filter returned entries from that single filtered map. No fallback per-PID lookup remains.

## Error handling and compatibility

- If `tasklist` cannot be started, exits unsuccessfully, or produces no valid rows, the snapshot is empty.
- An empty or incomplete snapshot preserves existing behavior: missing process names remain `None`, and unresolved queries return `process_found = false` with no matching entries.
- Duplicate PIDs are deduplicated before filtering, so duplicate `netstat` rows do not create duplicate lookup work.
- Existing command execution, console-window suppression, output decoding, and `netstat` errors remain unchanged.
- The public command response types and frontend contract do not change.

## Testing strategy

### Parser and filtering tests

- Parse multiple CSV rows into distinct PID-to-process-name entries.
- Ignore header/`INFO:`/malformed rows and non-numeric PIDs.
- Filter a snapshot for duplicate requested PIDs and verify each PID maps once.
- Verify missing PIDs are not reported as found.
- Preserve existing PID and process-name query resolution tests.

The pure parser/filter tests provide deterministic coverage without requiring Windows `tasklist.exe`; Windows CI covers the real command invocation and no-window command path.

## Acceptance criteria mapping

| Requirement | Design response |
| --- | --- |
| At most one tasklist per query | Each occupancy/process-port query calls the full snapshot helper once, then filters in memory |
| PID and process-name semantics preserved | Numeric query PID is included even when absent from netstat; name matching uses the filtered snapshot |
| Duplicate PIDs avoid duplicate work | Requested PIDs are deduplicated before snapshot filtering |
| Missing PIDs remain missing | Invalid/missing snapshot entries are omitted and resolve to the existing false/None results |
| Existing behavior remains stable | netstat, decoding, background command flags, response models, and frontend are unchanged |
| Regression coverage | Multi-row CSV parsing, PID mapping, duplicate filtering, and missing-PID tests are added |

## Out of scope

- Persistent process-name caching between user requests.
- Windows native process APIs.
- Frontend or serialized response changes.
- Changes to netstat command arguments or Network Diagnostics UI behavior.
