# Scheduled Script Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Windows-first scheduled script task feature that stores tasks in SQLite, runs allowed script files on a fixed interval, and exposes management UI.

**Architecture:** Rust owns persistence, validation, script execution, and in-process scheduling. React owns task forms, list rendering, and command invocation. The scheduler is separate from the existing reminder scheduler because script tasks repeat, record execution output, and need running-state guards.

**Tech Stack:** Tauri v2, React, Vitest, Rust, rusqlite, Tokio process/runtime.

---

### Task 1: Data Model And Repository

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/error.rs`
- Create: `src-tauri/src/script_tasks.rs`

- [ ] Write Rust tests for migration, create/list, validation, enable/disable, delete.
- [ ] Run `cargo test script_tasks` and verify failures for missing model/repository.
- [ ] Add `script_tasks` table migration, model structs, error variants, and repository methods.
- [ ] Run `cargo test script_tasks` and verify pass.

### Task 2: Runner And Scheduler

**Files:**
- Create: `src-tauri/src/script_runner.rs`
- Create: `src-tauri/src/script_task_scheduler.rs`
- Modify: `src-tauri/src/app_state.rs`

- [ ] Write tests for allowed extensions, command plan construction, output truncation, and scheduler running guard.
- [ ] Run `cargo test script_runner script_task_scheduler` and verify failures.
- [ ] Implement runner and repeat scheduler with per-task cancellation and running-state guard.
- [ ] Run targeted Rust tests and verify pass.

### Task 3: Tauri Commands And Startup Restore

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] Add commands for list/create/delete/enable/run-now.
- [ ] Wire scheduling side effects into create/enable/delete/run-now.
- [ ] Restore enabled task schedules during Tauri startup.
- [ ] Run `cargo test` and verify pass.

### Task 4: Frontend API And UI

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/api.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/WorkbenchHome.tsx`
- Modify: `src/components/WorkbenchHome.test.tsx`
- Create: `src/components/ScriptTasksPanel.tsx`
- Create: `src/components/ScriptTasksPanel.test.tsx`
- Modify: `src/styles.css`

- [ ] Write Vitest tests for workbench entry, list loading, form validation, create, run-now, toggle, and delete.
- [ ] Run targeted frontend tests and verify failures.
- [ ] Implement types, API calls, app routing, workbench card, and script task panel.
- [ ] Run targeted frontend tests and verify pass.

### Task 5: Full Verification And Commit

**Files:**
- All modified files.

- [ ] Run `cargo fmt`.
- [ ] Run `npm test -- --run`.
- [ ] Run `cargo test`.
- [ ] Run `npm run tauri build`.
- [ ] Stage relevant files.
- [ ] Commit with `feat: add scheduled script tasks`.
