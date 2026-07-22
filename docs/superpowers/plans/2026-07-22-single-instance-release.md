# Passion Single-Instance Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent duplicate Passion processes, reactivate the existing main window on a later launch, and publish Passion 1.0.5.

**Architecture:** Register Tauri's official single-instance plugin before every other plugin. Reuse the tray window-restoration path through a small closure-driven helper so the `show` then `focus` behavior and error short-circuiting can be tested without starting a GUI.

**Tech Stack:** Rust, Tauri 2, `tauri-plugin-single-instance`, Cargo tests, Vitest, GitHub Actions, Git tags/releases

---

### Task 1: Test and isolate main-window activation

**Files:**
- Modify: `src-tauri/src/tray.rs`

- [ ] **Step 1: Write failing tests for activation order and error handling**

Add tests that call a not-yet-defined `run_window_activation` helper with closures. One test records `show` and `focus` and expects that exact order; a second makes `show` fail and asserts `focus` is never called and the error is returned.

```rust
#[test]
fn window_activation_shows_before_focusing() {
    let operations = RefCell::new(Vec::new());

    run_window_activation(
        || {
            operations.borrow_mut().push("show");
            Ok(())
        },
        || {
            operations.borrow_mut().push("focus");
            Ok(())
        },
    )
    .unwrap();

    assert_eq!(*operations.borrow(), vec!["show", "focus"]);
}

#[test]
fn window_activation_stops_when_show_fails() {
    let focused = Cell::new(false);

    let result = run_window_activation(
        || Err(BackendError::Window("show failed".to_string())),
        || {
            focused.set(true);
            Ok(())
        },
    );

    assert!(result.is_err());
    assert!(!focused.get());
}
```

- [ ] **Step 2: Run the targeted tests and verify RED**

Run: `cargo test tray::tests::window_activation --manifest-path src-tauri/Cargo.toml`

Expected: compilation fails because `run_window_activation` does not exist.

- [ ] **Step 3: Implement the minimal activation helper**

Add the helper and route `show_main_window` through it. Expose `show_main_window` within the crate for the single-instance callback.

```rust
fn run_window_activation(
    show: impl FnOnce() -> BackendResult<()>,
    focus: impl FnOnce() -> BackendResult<()>,
) -> BackendResult<()> {
    show()?;
    focus()?;
    Ok(())
}

pub(crate) fn show_main_window(app: &AppHandle) -> BackendResult<()> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| BackendError::Window("main window was not found".to_string()))?;
    run_window_activation(
        || window.show().map_err(|err| BackendError::Window(err.to_string())),
        || window.set_focus().map_err(|err| BackendError::Window(err.to_string())),
    )
}
```

- [ ] **Step 4: Run targeted and complete Rust tests and verify GREEN**

Run: `cargo test tray::tests::window_activation --manifest-path src-tauri/Cargo.toml`

Expected: 2 tests pass.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: all Rust tests pass.

### Task 2: Reject duplicate processes and restore the running window

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the official desktop single-instance dependency**

Add the dependency under the desktop target so mobile builds do not include it, then refresh the lockfile.

```toml
[target.'cfg(any(target_os = "macos", windows, target_os = "linux"))'.dependencies]
tauri-plugin-single-instance = "2"
```

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: Cargo resolves the plugin and compilation succeeds.

- [ ] **Step 2: Register the plugin first and activate the existing window**

Build the Tauri builder in a mutable variable, register the single-instance plugin before opener/dialog/autostart, and log callback failures without exiting the existing process.

```rust
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Err(err) = tray::show_main_window(app) {
                eprintln!("failed to activate main window from second launch: {err}");
            }
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
```

- [ ] **Step 3: Verify compilation and Rust regression tests**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

Expected: formatting check passes.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: all Rust tests pass.

### Task 3: Prepare version 1.0.5

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Update the frontend package version**

Run: `npm version 1.0.5 --no-git-tag-version`

Expected: `package.json` and the root entries in `package-lock.json` report 1.0.5.

- [ ] **Step 2: Update Rust and Tauri bundle versions**

Set the package version in `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` to `1.0.5`, then refresh Cargo metadata with:

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: the `passion` entry in `Cargo.lock` reports 1.0.5 and compilation succeeds.

- [ ] **Step 3: Verify all canonical version fields**

Run: `rg -n '1\.0\.4|1\.0\.5' package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json`

Expected: canonical project fields use 1.0.5 and no project metadata remains at 1.0.4.

### Task 4: Full verification and commit

**Files:**
- Verify all changed files

- [ ] **Step 1: Run frontend tests**

Run: `npm test -- --run`

Expected: all Vitest tests pass.

- [ ] **Step 2: Run the frontend production build**

Run: `npm run build`

Expected: TypeScript and Vite build successfully.

- [ ] **Step 3: Run Rust formatting, tests, and release build**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Run: `cargo build --release --manifest-path src-tauri/Cargo.toml`

Expected: every command exits successfully with no test failures.

- [ ] **Step 4: Inspect the release diff**

Run: `git diff --check && git status --short && git diff --stat && git diff`

Expected: only the single-instance implementation, dependency locks, version metadata, spec correction, and this plan are present.

- [ ] **Step 5: Commit the implementation and release metadata**

```bash
git add docs/superpowers/specs/2026-07-22-single-instance-release-design.md docs/superpowers/plans/2026-07-22-single-instance-release.md src-tauri/src/tray.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json src-tauri/tauri.conf.json
git commit -m "Release 1.0.5"
```

### Task 5: Publish and verify the GitHub release

**Files:**
- No repository file changes expected

- [ ] **Step 1: Push `main`**

Run: `git push origin main`

Expected: `origin/main` advances to the verified release commit.

- [ ] **Step 2: Create and push the release tag**

Run: `git tag -a app-v1.0.5 -m "Passion v1.0.5"`

Run: `git push origin app-v1.0.5`

Expected: the tag push starts `.github/workflows/release.yml`.

- [ ] **Step 3: Monitor the Windows Release workflow**

Use the GitHub Actions API/connector to monitor the tag-triggered run until it finishes.

Expected: frontend tests, Rust tests, and Tauri Windows packaging all succeed.

- [ ] **Step 4: Verify release assets and issue state**

Confirm the public `Passion v1.0.5` release exists with its Windows installer assets. Add a release link to issue #37 and close it as completed if the workflow did not close it automatically.

- [ ] **Step 5: Report the release**

Return the release URL, commit SHA, tag, verification results, workflow status, and the remaining Windows manual double-launch check.
