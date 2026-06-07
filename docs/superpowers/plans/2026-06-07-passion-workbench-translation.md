# Passion Workbench Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the workbench home view and OpenAI-compatible translation feature.

**Architecture:** The React app uses local view state for `home`, `reminders`, `translation`, and `settings`. The Rust backend stores AI settings in the existing SQLite key-value table and exposes Tauri commands for AI settings and translation through an OpenAI-compatible Chat Completions client.

**Tech Stack:** React 19, Vitest, Tauri v2, Rust, rusqlite, reqwest, serde.

---

## File Structure

- Modify `src/App.tsx`: replace two-tab layout with workbench navigation and view switching.
- Create `src/components/WorkbenchHome.tsx`: dashboard cards for reminders and translation.
- Create `src/components/WorkbenchHome.test.tsx`: dashboard rendering and action tests.
- Create `src/components/TranslationPanel.tsx`: translation UI.
- Create `src/components/TranslationPanel.test.tsx`: validation and translate command behavior tests.
- Modify `src/components/SettingsPanel.tsx`: add AI provider settings controls.
- Modify `src/components/SettingsPanel.test.tsx`: verify AI settings load/save.
- Modify `src/types.ts`: add AI settings, translation input, and view types.
- Modify `src/lib/api.ts`: add AI settings and translation invocations.
- Create `src-tauri/src/ai_settings.rs`: AI provider settings repository.
- Create `src-tauri/src/translator.rs`: OpenAI-compatible Chat Completions client helpers.
- Modify `src-tauri/src/commands.rs`: add AI settings and translation commands.
- Modify `src-tauri/src/error.rs`: add AI/translation error variants if needed.
- Modify `src-tauri/src/lib.rs`: register new modules and commands.
- Modify `src-tauri/Cargo.toml`: add HTTP client dependency.

## Task 1: Frontend Workbench Shell

**Files:**
- Create: `src/components/WorkbenchHome.tsx`
- Test: `src/components/WorkbenchHome.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing dashboard tests**

Create tests that render the dashboard and click feature cards.

- [ ] **Step 2: Run frontend tests and confirm failure**

Run: `npm test -- --run src/components/WorkbenchHome.test.tsx`

Expected: fails because `WorkbenchHome` does not exist.

- [ ] **Step 3: Implement dashboard and route state**

Create `WorkbenchHome` and update `App.tsx` to support `home`, `reminders`, `translation`, and `settings`.

- [ ] **Step 4: Run frontend tests**

Run: `npm test -- --run`

Expected: all frontend tests pass.

## Task 2: Frontend Translation UI

**Files:**
- Create: `src/components/TranslationPanel.tsx`
- Test: `src/components/TranslationPanel.test.tsx`
- Modify: `src/lib/api.ts`
- Modify: `src/types.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing translation panel tests**

Tests cover empty input validation and successful display of translated text.

- [ ] **Step 2: Run frontend tests and confirm failure**

Run: `npm test -- --run src/components/TranslationPanel.test.tsx`

Expected: fails because `TranslationPanel` does not exist.

- [ ] **Step 3: Implement translation panel and API wrapper**

Add typed `translateText` API wrapper and a focused two-panel UI.

- [ ] **Step 4: Run frontend tests**

Run: `npm test -- --run`

Expected: all frontend tests pass.

## Task 3: AI Settings UI

**Files:**
- Modify: `src/components/SettingsPanel.tsx`
- Test: `src/components/SettingsPanel.test.tsx`
- Modify: `src/lib/api.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Extend failing settings tests**

Tests cover loading AI settings, saving edited AI settings, and test connection action.

- [ ] **Step 2: Run frontend tests and confirm failure**

Run: `npm test -- --run src/components/SettingsPanel.test.tsx`

Expected: fails because AI settings API wrappers and fields are missing.

- [ ] **Step 3: Implement AI settings controls**

Add the "AI 翻译设置" section with base URL, model, optional key, default target language, save, and test connection controls.

- [ ] **Step 4: Run frontend tests**

Run: `npm test -- --run`

Expected: all frontend tests pass.

## Task 4: Rust AI Settings and Translator

**Files:**
- Create: `src-tauri/src/ai_settings.rs`
- Create: `src-tauri/src/translator.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/error.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Write failing Rust tests**

Add tests for AI setting defaults/round-trip, endpoint URL normalization, response parsing, and empty input validation.

- [ ] **Step 2: Run Rust tests and confirm failure**

Run: `cargo test`

Expected: fails because new modules/functions do not exist.

- [ ] **Step 3: Implement backend modules and commands**

Implement AI settings persistence and OpenAI-compatible Chat Completions request/response parsing.

- [ ] **Step 4: Run Rust tests**

Run: `cargo test`

Expected: all Rust tests pass.

## Task 5: Full Verification and Git

**Files:**
- All changed files.

- [ ] **Step 1: Run frontend tests**

Run: `npm test -- --run`

Expected: all frontend tests pass.

- [ ] **Step 2: Run Rust tests**

Run: `cargo test`

Expected: all Rust tests pass.

- [ ] **Step 3: Build release bundle**

Run: `npm run tauri build`

Expected: MSI and NSIS setup bundles are produced.

- [ ] **Step 4: Commit and push**

Run:

```bash
git add .
git commit -m "feat: add workbench translation feature"
git push
```

Expected: branch updates on origin.
