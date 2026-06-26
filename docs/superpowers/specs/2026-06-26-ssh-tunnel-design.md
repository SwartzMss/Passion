# Passion SSH Tunnel Design

## Goal

Add a lightweight SSH tunnel manager to Passion as a top-level workbench module. The first version manages local port forwarding through the system `ssh` executable and provides a complete create, start, stop, and delete flow.

This is an SSH process management tool, not an SSH protocol implementation.

## Scope

Version 1 supports:

- Top-level `SSH 隧道` module in the sidebar and workbench search.
- Local port forwarding with `ssh -L`.
- Private key authentication only.
- SQLite persistence for tunnel configurations.
- Start, stop, restart, edit, and delete actions.
- Optional bind address: `127.0.0.1` or `0.0.0.0`.
- Port conflict precheck before starting.
- Private key file existence precheck before starting.
- Startup health check after spawning `ssh`.
- Runtime status display with error messages when startup fails or the process exits unexpectedly.

Version 1 does not support:

- Password authentication.
- Remote forwarding with `-R`.
- Dynamic SOCKS forwarding with `-D`.
- Jump host or separate SSH host and target host fields.
- Automatic reconnect.
- SSH host key policy configuration.
- Built-in SSH protocol implementation.
- Traffic statistics.

## User Model

The user creates named tunnels for recurring access to QNX, Linux, or internal services. A tunnel maps a local listener to a remote host and port through SSH.

Version 1 intentionally uses one remote address:

- `remote_host` is the SSH login host.
- `remote_host` is also the target host used in the `-L` forwarding rule.

This keeps the first version simple while leaving room for a later migration to separate `ssh_host` and `target_host` fields.

## Navigation

Add a new top-level view:

- Sidebar label: `SSH 隧道`
- Home/workbench card: `SSH 隧道`
- Search keywords: `ssh`, `隧道`, `端口转发`, `qnx`, `linux`, `内网`

The module is independent from the existing `网络检测` page.

## Frontend Views

### List View

The list view shows:

- Summary counters: all, running, stopped, error.
- Search input matching name, remote host, username, local port, and remote port.
- `新建隧道` action.
- Tunnel table or list with:
  - Name
  - Local endpoint: `{bindAddress}:{localPort}`
  - Remote endpoint: `{remoteHost}:{remotePort}`
  - Username
  - Status
  - Actions

Status actions:

| Status | Actions |
| --- | --- |
| stopped | start, edit, delete |
| starting | cancel |
| running | stop |
| error | restart, edit, delete |

Editing and deletion are disabled while a tunnel is running or starting. The user must stop the tunnel first.

Rows in `error` state expose the latest error message and captured stderr summary.

### Create/Edit View

Creation and editing use an in-module page, not a modal.

Fields:

- Tunnel name, required and unique.
- Description, optional.
- Local port, required, `1..=65535`.
- Bind address, required, default `127.0.0.1`.
- Remote host, required.
- Remote port, required, `1..=65535`.
- Username, required.
- Private key file path, required.

Actions:

- `取消`
- `创建并启动` on create
- `保存` on edit

The file picker uses the existing Tauri dialog plugin.

## Backend Data Model

Add models to `src-tauri/src/models.rs` and matching TypeScript types in `src/types.ts`.

```rust
struct NewSshTunnel {
    name: String,
    description: Option<String>,
    local_port: u16,
    bind_address: String,
    remote_host: String,
    remote_port: u16,
    username: String,
    key_path: String,
}

struct SshTunnel {
    id: String,
    name: String,
    description: Option<String>,
    local_port: u16,
    bind_address: String,
    remote_host: String,
    remote_port: u16,
    username: String,
    key_path: String,
    auth_type: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

struct SshTunnelInfo {
    id: String,
    name: String,
    description: Option<String>,
    local_port: u16,
    bind_address: String,
    remote_host: String,
    remote_port: u16,
    username: String,
    key_path: String,
    auth_type: String,
    status: SshTunnelStatus,
    pid: Option<u32>,
    started_at: Option<DateTime<Utc>>,
    error_message: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}
```

`auth_type` is persisted with default `private_key`. Version 1 only accepts `private_key`; the field exists to avoid a disruptive schema change if password authentication is added later.

## SQLite Schema

Extend `src-tauri/src/db.rs`:

```sql
CREATE TABLE IF NOT EXISTS ssh_tunnels (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    local_port INTEGER NOT NULL,
    bind_address TEXT NOT NULL CHECK (bind_address IN ('127.0.0.1', '0.0.0.0')),
    remote_host TEXT NOT NULL,
    remote_port INTEGER NOT NULL,
    username TEXT NOT NULL,
    key_path TEXT NOT NULL,
    auth_type TEXT NOT NULL DEFAULT 'private_key' CHECK (auth_type IN ('private_key')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ssh_tunnels_name
ON ssh_tunnels (name);
```

Runtime status is not stored in SQLite. The database stores reusable tunnel configuration. Process state is held in memory because child process handles are not recoverable after app restart.

## Backend Modules

Use the existing repository style:

- `src-tauri/src/ssh_tunnels.rs`
  - `SshTunnelRepository`
  - validation
  - row mapping
  - command argument building helpers
  - process manager types

If the file grows too large during implementation, split process management into `ssh_tunnel_process.rs`. Do not introduce a deep module tree for v1 unless the code needs it.

Add runtime process state to `AppState`:

```rust
pub ssh_tunnel_manager: SshTunnelManager
```

The manager owns an in-memory map:

```rust
HashMap<String, SshTunnelRuntime>
```

Each runtime stores:

- status
- child process handle
- pid
- started_at
- error_message
- stderr buffer summary

The manager must be concurrency-safe because Tauri commands can overlap.

## Tauri API

Expose commands:

```typescript
list_ssh_tunnels(): Promise<SshTunnelInfo[]>
create_ssh_tunnel(input: NewSshTunnel): Promise<SshTunnelInfo>
update_ssh_tunnel(id: string, input: NewSshTunnel): Promise<SshTunnelInfo>
delete_ssh_tunnel(id: string): Promise<void>
start_ssh_tunnel(id: string): Promise<SshTunnelInfo>
stop_ssh_tunnel(id: string): Promise<SshTunnelInfo>
```

Command behavior:

- `create_ssh_tunnel` persists the config and starts it immediately.
- `update_ssh_tunnel` rejects running or starting tunnels.
- `delete_ssh_tunnel` rejects running or starting tunnels.
- `start_ssh_tunnel` rejects already running or starting tunnels.
- `stop_ssh_tunnel` is idempotent for stopped/error tunnels and returns current info.

## SSH Command

Build the command with structured args, never a shell string:

```text
ssh
  -L {bind_address}:{local_port}:{remote_host}:{remote_port}
  -N
  -i {key_path}
  -o BatchMode=yes
  -o StrictHostKeyChecking=no
  {username}@{remote_host}
```

`BatchMode=yes` prevents password/passphrase prompts from hanging a non-interactive process. If auth fails, `ssh` exits and stderr is captured for display.

## Start Flow

1. Load config from SQLite.
2. Validate `remote_host`, `username`, and `key_path`.
3. Check the key file exists.
4. Check the requested local bind address and port are available.
5. Set runtime status to `starting`.
6. Spawn system `ssh` with stderr captured and no shell.
7. Wait 2 seconds.
8. If the process exited, set status to `error` and store stderr summary.
9. If the process is still alive, set status to `running`, store PID and `started_at`.
10. Start background monitoring for unexpected process exit.

Port availability should bind the requested bind address and port. If `0.0.0.0` is selected, binding `0.0.0.0:{port}` catches broad conflicts.

## Stop Flow

1. Look up runtime by tunnel id.
2. If there is no live process, mark stopped.
3. If a process exists, terminate the process tree:
   - Windows: `taskkill /PID {pid} /T /F`
   - Unix: terminate the process group created for the child process.
4. Clear the child handle.
5. Set status to `stopped`, clear PID and error.

## Monitoring

After a tunnel reaches `running`, the backend monitors process exit. A monitor loop periodically checks whether the process is still alive.

When a process exits without an explicit stop:

- status becomes `error`
- PID is cleared
- `error_message` records the exit status and stderr summary

The monitor must avoid marking a tunnel as error when the user intentionally stopped it.

## Error Handling

User-facing errors should be specific:

- Duplicate tunnel name.
- Invalid port.
- Invalid bind address.
- Empty remote host.
- Empty username.
- Missing private key file.
- Local port already occupied.
- System `ssh` executable missing.
- SSH process exited during startup.
- SSH private key permission failure.

If stderr contains `UNPROTECTED PRIVATE KEY FILE`, `bad permissions`, or similar OpenSSH private-key permission text, the frontend displays a Windows-oriented repair hint with copyable `icacls` commands.

## Tests

Rust tests:

- SQLite schema allows `ssh_tunnels`.
- Repository create/list/get/update/delete.
- Duplicate name validation.
- Empty required field validation.
- Bind address validation.
- Port range validation through `u16` model deserialization and frontend validation.
- SSH command args are built without shell interpolation.
- Port availability detects occupied local listeners.
- Process kill command builder uses `taskkill` on Windows.

Frontend tests:

- Sidebar exposes `SSH 隧道`.
- Workbench search finds SSH tunnels.
- List view renders stopped/running/error states.
- Create form validates required fields.
- Running tunnels disable edit/delete.
- Error row displays stderr summary.

Manual verification:

- Start a tunnel with a valid key and confirm the local port opens.
- Stop it and confirm the local port closes.
- Start with an invalid key and confirm error status and stderr display.
- Start when local port is occupied and confirm the precheck blocks it.

## Open Follow-Up

Password authentication is intentionally deferred. Supporting password login with system `ssh` requires an interactive input strategy such as `sshpass`, `SSH_ASKPASS`, PTY handling, or a built-in SSH library. Those options either add platform dependencies or conflict with the v1 goal of simple system `ssh` process management.
