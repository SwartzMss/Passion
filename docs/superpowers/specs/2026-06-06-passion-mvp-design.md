# Passion MVP Design

## Overview

Passion is a personal desktop assistant. The first version focuses on a minimal reminder workflow for Windows users:

- Manage one-time reminder tasks.
- Keep running in the background through the system tray.
- Trigger reminders at the configured time.
- Notify the user with a Windows system notification and an in-app popup.
- Provide basic settings for startup behavior, tray behavior, and notification testing.

The MVP does not support recurring reminders, cloud sync, multi-device use, accounts, calendars, or advanced natural language input.

## Product Scope

### Supported Platform

Windows is the priority platform for the first release. The project may use cross-platform Tauri APIs where practical, but behavior only needs to be verified on Windows for the MVP.

### Reminder Type

Only one-time reminders are supported. A reminder is triggered at most once. After it fires, its status becomes `triggered` and it will not be scheduled again. If Passion starts after a pending reminder's scheduled time has already passed, that reminder becomes `expired` and is not delivered late.

### Runtime Model

Passion must keep working while running in the background:

- Closing the main window hides it to the tray when `minimize_to_tray` is enabled.
- The process continues running and scheduled reminders remain active.
- The app only fully exits through the tray menu's exit action.
- If the app is not running, it does not trigger reminders.
- Enabling launch on startup starts Passion automatically after Windows login so reminders can be scheduled again.

## Recommended Technology

Use Tauri 2 with a Rust backend and a React + TypeScript frontend.

Rust owns:

- SQLite persistence.
- Reminder scheduling.
- System notifications.
- Tray menu behavior.
- Window show/hide behavior.
- Launch-on-startup integration.

React owns:

- Reminder list UI.
- Add reminder form.
- Enable, disable, and delete actions.
- Settings UI.
- In-app reminder popup.

SQLite is preferred over a JSON file because it gives the MVP a small but durable data layer that can support later filtering, migrations, and history without reworking persistence.

## Architecture

### Frontend UI

The frontend communicates with Rust through Tauri commands and events.

Primary commands:

- `list_reminders`
- `create_reminder`
- `toggle_reminder`
- `delete_reminder`
- `get_settings`
- `update_settings`
- `test_notification`

Primary events:

- `reminder_triggered`: emitted by Rust when a reminder fires. The frontend uses it to show the in-app popup and refresh the reminder list.

### Rust Backend

The backend is split into focused modules:

- `db`: database connection, schema setup, migrations.
- `reminders`: CRUD operations and validation.
- `scheduler`: in-memory timer management.
- `notifications`: Windows system notification dispatch.
- `settings`: settings persistence and startup integration.
- `tray`: tray menu and main window visibility behavior.

The scheduler is an in-memory runtime service. SQLite is the source of truth, and the scheduler is rebuilt from pending reminders on app startup.

## Data Model

### `reminders`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Unique reminder ID. |
| `title` | string | Required. |
| `notes` | string nullable | Optional detail text. |
| `remind_at` | integer | Local reminder time stored as a timestamp. |
| `enabled` | boolean | Disabled reminders are not scheduled. |
| `status` | string | `pending`, `triggered`, or `expired`. |
| `created_at` | integer | Creation timestamp. |
| `updated_at` | integer | Last update timestamp. |
| `triggered_at` | integer nullable | Set when the reminder fires or is marked expired on startup. |

### `settings`

| Field | Type | Notes |
| --- | --- | --- |
| `launch_on_startup` | boolean | Controls Windows login startup. |
| `minimize_to_tray` | boolean | When true, closing the window hides the app instead of exiting. |
| `notification_enabled` | boolean | Controls system notification dispatch. |

Default settings:

- `launch_on_startup`: false
- `minimize_to_tray`: true
- `notification_enabled`: true

## User Interface

### Reminder Tasks View

The main view shows reminders in a list.

Each row displays:

- Title.
- Reminder time.
- Enabled state.
- Status.
- Actions for enable/disable and delete.

The view includes:

- An add reminder button.
- Empty state with a short prompt and add action.
- Visible state for triggered and expired reminders so users can understand why they will not fire again.

### Add Reminder Dialog

Fields:

- Title, required.
- Notes, optional.
- Date and time, required.

Actions:

- Save.
- Cancel.

Validation:

- Title must not be empty.
- Reminder time must be in the future.

### Settings View

Settings include:

- Launch on startup toggle.
- Minimize to tray toggle.
- System notification toggle.
- Test notification button.

When a setting update fails, the UI shows a clear error and keeps the previous state.

### In-App Reminder Popup

When a reminder triggers, Passion shows a modal popup containing:

- Reminder title.
- Reminder notes if present.
- Reminder time.
- A single confirmation button: "I know".

If the main window is hidden, the backend shows the window before the popup appears.

## Reminder Flow

### App Startup

On startup, Rust:

1. Initializes SQLite and applies migrations.
2. Loads settings.
3. Creates the tray menu.
4. Loads enabled reminders where `status = pending`.
5. Marks pending reminders whose `remind_at <= now` as `expired`.
6. Schedules enabled pending reminders whose `remind_at > now`.

Expired pending reminders are not backfilled as late notifications. They are surfaced in the list as expired so the user has a clear state.

### Creating a Reminder

1. Frontend validates input.
2. Frontend calls `create_reminder`.
3. Rust validates that `remind_at` is in the future.
4. Rust stores the reminder with `enabled = true` and `status = pending`.
5. Rust registers it with the scheduler.
6. Frontend refreshes the list.

### Disabling a Reminder

1. Frontend calls `toggle_reminder`.
2. Rust updates `enabled = false`.
3. Rust cancels the in-memory timer if present.
4. Frontend refreshes the list.

### Enabling a Reminder

1. Frontend calls `toggle_reminder`.
2. Rust rejects the action if the reminder time is already in the past.
3. Rust updates `enabled = true`.
4. Rust registers the timer.
5. Frontend refreshes the list.

### Deleting a Reminder

1. Frontend calls `delete_reminder`.
2. Rust cancels the in-memory timer if present.
3. Rust deletes the database row.
4. Frontend refreshes the list.

### Triggering a Reminder

When a timer fires:

1. Rust updates the reminder status to `triggered`.
2. Rust sets `triggered_at`.
3. Rust sends a Windows system notification if notifications are enabled.
4. Rust shows the main window if it is hidden.
5. Rust emits `reminder_triggered`.
6. Frontend shows the in-app popup and refreshes the list.

## Tray Behavior

The tray menu includes:

- Show Passion.
- Test notification.
- Exit.

Window close behavior:

- If `minimize_to_tray = true`, hide the main window and keep the process running.
- If `minimize_to_tray = false`, close exits the application.

The first-run default is `minimize_to_tray = true` because background reminders are a core MVP requirement.

## Error Handling

Frontend validation handles common user input issues before calling Rust:

- Empty title.
- Missing date/time.
- Reminder time in the past.

Rust still validates all commands because it is the authority for persistence and scheduling.

Errors returned to the UI should be explicit enough for direct display:

- Reminder time must be in the future.
- Notification failed.
- Startup setting update failed.
- Database operation failed.

Implementation details such as raw SQL or OS error strings should be logged but not exposed directly as primary UI copy.

## Testing Strategy

### Rust Tests

Cover:

- Reminder create, list, toggle, and delete behavior.
- Rejection of past reminder times.
- Scheduler registration and cancellation.
- Trigger path updates reminder status.
- Startup loading only schedules enabled pending future reminders.
- Startup handling of expired pending reminders.

### Frontend Tests

Cover:

- Empty reminder list state.
- Add reminder form validation.
- Reminder list rendering for pending, disabled, triggered, and expired states.
- Enable, disable, and delete user interactions.
- Settings toggles and test notification action.
- In-app popup display after a `reminder_triggered` event.

### Manual Windows Verification

Before calling the MVP complete, manually verify:

- Windows system notification appears.
- Closing the window keeps Passion running in the tray.
- A reminder triggers while the window is hidden.
- The in-app popup appears after triggering.
- Tray menu can show the app, test notification, and exit.
- Launch-on-startup setting can be enabled and disabled.

## Non-Goals

The MVP intentionally excludes:

- Recurring reminders.
- Snooze.
- Reminder editing after creation.
- Search and filtering.
- Calendar integrations.
- Cloud sync.
- Mobile apps.
- User accounts.
- Cross-platform behavioral guarantees beyond Windows.
- Natural language reminder parsing.

These can be added later after the core desktop reminder loop is working.

## Implementation Notes

No product decisions remain open for the MVP design. Implementation may still choose specific Tauri plugins and crate versions based on current official documentation and compatibility at implementation time.
