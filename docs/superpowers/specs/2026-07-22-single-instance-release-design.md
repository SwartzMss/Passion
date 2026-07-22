# Passion Single-Instance Release Design

## Goal

Ensure only one Passion desktop process runs per user session and publish the fix as version 1.0.5.

## Behavior

- The first Passion launch starts normally.
- A later launch is intercepted before the rest of the Tauri plugins and application setup run.
- The later process exits instead of creating another tray icon, scheduler, database connection, or main window.
- The already-running process shows its `main` window and focuses it. This also restores Passion when the main window is hidden in the system tray.
- Failure to show or focus the existing window is logged without crashing the running process.

## Architecture

Add Tauri's official `tauri-plugin-single-instance` dependency and register it as the first plugin in the desktop application builder. Its callback delegates to a small helper that retrieves the existing `main` webview window, shows it, and focuses it.

Keeping the window activation behavior in a helper gives the callback one responsibility and allows its operation order and error handling to be covered by Rust tests without launching a second graphical process in CI.

No frontend changes or capability permissions are required because the plugin and window activation run entirely in Rust.

## Error Handling

The existing Passion process remains authoritative. If the main window cannot be found, shown, or focused, the callback records the failure through the existing application log where possible and otherwise writes it to standard error. The callback never terminates the existing process.

## Testing

- Add Rust unit tests for the activation helper, covering the required `show` then `focus` operation order and failure propagation.
- Run the complete Rust test suite.
- Run the complete frontend test suite and production frontend build to catch unrelated regressions.
- Run a Tauri release build to verify the desktop dependency and plugin registration compile in production configuration.
- Manually verify on Windows after installing the release: launch Passion twice, confirm only one process and tray icon remain, and confirm the existing window is shown and focused.

## Release

- Update package metadata, Tauri configuration, and the frontend version constant from 1.0.4 to 1.0.5 using the repository's existing release pattern.
- Commit and push the fix to `main` as requested for a release.
- Create and push the annotated `app-v1.0.5` tag only after verification passes; this is the tag pattern consumed by the existing Windows release workflow.
- Publish a GitHub Release named `Passion v1.0.5` describing the single-instance fix and Windows verification expectation.
- Close issue #37 through the release notes or a dedicated issue update once the release is published.

## Out of Scope

- Passing command-line arguments from the rejected process to the existing process.
- Deep-link handling.
- Changing reminder, scheduler, tray, or database behavior beyond preventing duplicate initialization.
