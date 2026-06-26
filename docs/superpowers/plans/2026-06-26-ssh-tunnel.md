# SSH Tunnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 SSH tunnel manager as a top-level Passion module using system `ssh`, SQLite configuration storage, and backend-managed process state.

**Architecture:** Persist tunnel configurations in the existing SQLite database through a repository, and persist the SSH executable path in the existing `settings` key/value table. Keep process status in a Tauri-managed in-memory `SshTunnelManager`, and run all SSH executable detection, spawn, wait, monitoring, and kill work in backend async/blocking tasks so React never blocks the UI thread. Add a dedicated React panel and top-level navigation entry that invokes backend commands and refreshes status.

**Tech Stack:** Tauri 2, Rust, Tokio, rusqlite, React 19, TypeScript, Vitest.

---

### Task 1: Database Schema And Model Types

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src/types.ts`

- [ ] **Step 1: Write failing Rust schema tests**

Add tests to `src-tauri/src/db.rs`:

```rust
#[test]
fn initialize_schema_allows_ssh_tunnels_table() {
    let conn = Connection::open_in_memory().unwrap();

    initialize_schema(&conn).unwrap();

    conn.execute(
        "INSERT INTO ssh_tunnels (
            id, name, description, local_port, bind_address, remote_host, remote_port,
            username, key_path, auth_type, created_at, updated_at
         ) VALUES (
            '1', 'QNX调试', 'debug tunnel', 8080, '127.0.0.1', '172.31.3.1', 22,
            'root', 'C:\\keys\\8797_rsa2048', 'private_key', 1, 1
         )",
        [],
    )
    .unwrap();
}

#[test]
fn initialize_schema_rejects_invalid_ssh_tunnel_bind_address() {
    let conn = Connection::open_in_memory().unwrap();

    initialize_schema(&conn).unwrap();

    let result = conn.execute(
        "INSERT INTO ssh_tunnels (
            id, name, local_port, bind_address, remote_host, remote_port,
            username, key_path, auth_type, created_at, updated_at
         ) VALUES (
            '1', 'Bad', 8080, '192.168.1.2', '172.31.3.1', 22,
            'root', 'C:\\keys\\8797_rsa2048', 'private_key', 1, 1
         )",
        [],
    );

    assert!(result.is_err());
}

#[test]
fn initialize_schema_rejects_duplicate_ssh_tunnel_names() {
    let conn = Connection::open_in_memory().unwrap();

    initialize_schema(&conn).unwrap();

    for id in ["1", "2"] {
        let result = conn.execute(
            "INSERT INTO ssh_tunnels (
                id, name, local_port, bind_address, remote_host, remote_port,
                username, key_path, auth_type, created_at, updated_at
             ) VALUES (
                ?1, 'QNX调试', 8080, '127.0.0.1', '172.31.3.1', 22,
                'root', 'C:\\keys\\8797_rsa2048', 'private_key', 1, 1
             )",
            [id],
        );
        if id == "1" {
            result.unwrap();
        } else {
            assert!(result.is_err());
        }
    }
}
```

- [ ] **Step 2: Run schema tests and verify failure**

Run:

```bash
cd src-tauri
cargo test db::tests::initialize_schema_allows_ssh_tunnels_table db::tests::initialize_schema_rejects_invalid_ssh_tunnel_bind_address db::tests::initialize_schema_rejects_duplicate_ssh_tunnel_names
```

Expected: tests fail because `ssh_tunnels` does not exist.

- [ ] **Step 3: Add SQLite schema**

Add this SQL block in `initialize_schema` after `script_tasks`:

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

- [ ] **Step 4: Add Rust model types**

Append to `src-tauri/src/models.rs` before the test module:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SshTunnelStatus {
    Stopped,
    Starting,
    Running,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSshTunnel {
    pub name: String,
    pub description: Option<String>,
    pub local_port: u16,
    pub bind_address: String,
    pub remote_host: String,
    pub remote_port: u16,
    pub username: String,
    pub key_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnel {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub local_port: u16,
    pub bind_address: String,
    pub remote_host: String,
    pub remote_port: u16,
    pub username: String,
    pub key_path: String,
    pub auth_type: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnelInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub local_port: u16,
    pub bind_address: String,
    pub remote_host: String,
    pub remote_port: u16,
    pub username: String,
    pub key_path: String,
    pub auth_type: String,
    pub status: SshTunnelStatus,
    pub pid: Option<u32>,
    pub started_at: Option<DateTime<Utc>>,
    pub error_message: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

- [ ] **Step 5: Add TypeScript model types**

Append to `src/types.ts`:

```ts
export type SshTunnelStatus = "stopped" | "starting" | "running" | "error";
export type SshTunnelBindAddress = "127.0.0.1" | "0.0.0.0";

export interface NewSshTunnel {
  name: string;
  description?: string | null;
  localPort: number;
  bindAddress: SshTunnelBindAddress;
  remoteHost: string;
  remotePort: number;
  username: string;
  keyPath: string;
}

export interface SshTunnelInfo extends NewSshTunnel {
  id: string;
  authType: "private_key";
  status: SshTunnelStatus;
  pid?: number | null;
  startedAt?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SshTunnelSettings {
  sshExecutablePath?: string | null;
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
cd src-tauri
cargo test db::tests::initialize_schema_allows_ssh_tunnels_table db::tests::initialize_schema_rejects_invalid_ssh_tunnel_bind_address db::tests::initialize_schema_rejects_duplicate_ssh_tunnel_names
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/models.rs src/types.ts
git commit -m "Add SSH tunnel schema and models"
```

### Task 2: SSH Tunnel Repository, Settings, And Command Builder

**Files:**
- Create: `src-tauri/src/ssh_tunnels.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing repository tests**

Create `src-tauri/src/ssh_tunnels.rs` with tests first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::models::NewSshTunnel;

    fn sample_input() -> NewSshTunnel {
        NewSshTunnel {
            name: "QNX调试".to_string(),
            description: Some("SSH to QNX".to_string()),
            local_port: 8080,
            bind_address: "127.0.0.1".to_string(),
            remote_host: "172.31.3.1".to_string(),
            remote_port: 22,
            username: "root".to_string(),
            key_path: "C:\\keys\\8797_rsa2048".to_string(),
        }
    }

    #[test]
    fn repository_creates_and_lists_tunnels() {
        let conn = db::test_connection();

        let tunnel = SshTunnelRepository::create(&conn, sample_input()).unwrap();
        let tunnels = SshTunnelRepository::list(&conn).unwrap();

        assert_eq!(tunnel.name, "QNX调试");
        assert_eq!(tunnel.auth_type, "private_key");
        assert_eq!(tunnels.len(), 1);
        assert_eq!(tunnels[0].id, tunnel.id);
    }

    #[test]
    fn repository_updates_tunnels() {
        let conn = db::test_connection();
        let tunnel = SshTunnelRepository::create(&conn, sample_input()).unwrap();
        let mut input = sample_input();
        input.name = "Web访问".to_string();
        input.local_port = 8081;
        input.remote_port = 80;

        let updated = SshTunnelRepository::update(&conn, &tunnel.id, input).unwrap();

        assert_eq!(updated.name, "Web访问");
        assert_eq!(updated.local_port, 8081);
        assert_eq!(updated.remote_port, 80);
    }

    #[test]
    fn repository_deletes_tunnels() {
        let conn = db::test_connection();
        let tunnel = SshTunnelRepository::create(&conn, sample_input()).unwrap();

        SshTunnelRepository::delete(&conn, &tunnel.id).unwrap();

        assert!(SshTunnelRepository::get(&conn, &tunnel.id).is_err());
    }

    #[test]
    fn repository_rejects_invalid_input() {
        let conn = db::test_connection();
        let mut input = sample_input();
        input.name = " ".to_string();
        assert!(SshTunnelRepository::create(&conn, input).is_err());

        let mut input = sample_input();
        input.bind_address = "192.168.1.2".to_string();
        assert!(SshTunnelRepository::create(&conn, input).is_err());

        let mut input = sample_input();
        input.remote_host = " ".to_string();
        assert!(SshTunnelRepository::create(&conn, input).is_err());
    }

    #[test]
    fn build_ssh_args_uses_structured_arguments() {
        let conn = db::test_connection();
        let tunnel = SshTunnelRepository::create(&conn, sample_input()).unwrap();

        let args = build_ssh_args(&tunnel);

        assert_eq!(
            args,
            vec![
                "-L",
                "127.0.0.1:8080:172.31.3.1:22",
                "-N",
                "-i",
                "C:\\keys\\8797_rsa2048",
                "-o",
                "BatchMode=yes",
                "-o",
                "StrictHostKeyChecking=no",
                "root@172.31.3.1",
            ]
        );
    }

    #[test]
    fn settings_detects_and_persists_ssh_executable_path() {
        let conn = db::test_connection();

        SshTunnelSettingsRepository::save(&conn, "C:\\Windows\\System32\\OpenSSH\\ssh.exe").unwrap();

        let settings = SshTunnelSettingsRepository::get(&conn).unwrap();
        assert_eq!(
            settings.ssh_executable_path,
            Some("C:\\Windows\\System32\\OpenSSH\\ssh.exe".to_string())
        );
    }

    #[test]
    fn detect_ssh_executable_finds_candidate_in_path_list() {
        let temp = tempfile::tempdir().unwrap();
        let executable = temp.path().join(if cfg!(target_os = "windows") { "ssh.exe" } else { "ssh" });
        std::fs::write(&executable, "").unwrap();

        let detected = detect_ssh_executable_in_paths(vec![temp.path().to_path_buf()]).unwrap();

        assert_eq!(detected, executable);
    }
}
```

- [ ] **Step 2: Run repository tests and verify failure**

Run:

```bash
cd src-tauri
cargo test ssh_tunnels::tests
```

Expected: compile failure because repository code is missing.

- [ ] **Step 3: Implement repository and builder**

Implement `src-tauri/src/ssh_tunnels.rs`:

```rust
use crate::error::{BackendError, BackendResult};
use crate::models::{NewSshTunnel, SshTunnel, SshTunnelSettings};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::path::PathBuf;
use uuid::Uuid;

pub struct SshTunnelRepository;
pub struct SshTunnelSettingsRepository;

const CREATED_AT_COLUMN_INDEX: usize = 10;
const UPDATED_AT_COLUMN_INDEX: usize = 11;
const AUTH_TYPE_PRIVATE_KEY: &str = "private_key";
const SSH_EXECUTABLE_PATH_KEY: &str = "ssh_executable_path";

impl SshTunnelRepository {
    pub fn create(conn: &Connection, input: NewSshTunnel) -> BackendResult<SshTunnel> {
        let normalized = normalize_input(input)?;
        let now = Utc::now();
        let tunnel = SshTunnel {
            id: Uuid::new_v4().to_string(),
            name: normalized.name,
            description: normalized.description,
            local_port: normalized.local_port,
            bind_address: normalized.bind_address,
            remote_host: normalized.remote_host,
            remote_port: normalized.remote_port,
            username: normalized.username,
            key_path: normalized.key_path,
            auth_type: AUTH_TYPE_PRIVATE_KEY.to_string(),
            created_at: now,
            updated_at: now,
        };
        conn.execute(
            "INSERT INTO ssh_tunnels (
                id, name, description, local_port, bind_address, remote_host, remote_port,
                username, key_path, auth_type, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                &tunnel.id,
                &tunnel.name,
                &tunnel.description,
                tunnel.local_port,
                &tunnel.bind_address,
                &tunnel.remote_host,
                tunnel.remote_port,
                &tunnel.username,
                &tunnel.key_path,
                &tunnel.auth_type,
                tunnel.created_at.timestamp_millis(),
                tunnel.updated_at.timestamp_millis(),
            ],
        )
        .map_err(database_or_tunnel_error)?;
        Self::get(conn, &tunnel.id)
    }

    pub fn list(conn: &Connection) -> BackendResult<Vec<SshTunnel>> {
        let mut stmt = conn
            .prepare("SELECT * FROM ssh_tunnels ORDER BY created_at DESC")
            .map_err(|err| BackendError::Database(err.to_string()))?;
        let rows = stmt
            .query_map([], Self::from_row)
            .map_err(|err| BackendError::Database(err.to_string()))?;
        rows.map(|row| row.map_err(|err| BackendError::Database(err.to_string())))
            .collect()
    }

    pub fn get(conn: &Connection, id: &str) -> BackendResult<SshTunnel> {
        conn.query_row("SELECT * FROM ssh_tunnels WHERE id = ?1", [id], Self::from_row)
            .optional()
            .map_err(|err| BackendError::Database(err.to_string()))?
            .ok_or_else(ssh_tunnel_not_found)
    }

    pub fn update(
        conn: &Connection,
        id: &str,
        input: NewSshTunnel,
    ) -> BackendResult<SshTunnel> {
        Self::get(conn, id)?;
        let normalized = normalize_input(input)?;
        let count = conn
            .execute(
                "UPDATE ssh_tunnels
                 SET name = ?1,
                     description = ?2,
                     local_port = ?3,
                     bind_address = ?4,
                     remote_host = ?5,
                     remote_port = ?6,
                     username = ?7,
                     key_path = ?8,
                     updated_at = ?9
                 WHERE id = ?10",
                params![
                    normalized.name,
                    normalized.description,
                    normalized.local_port,
                    normalized.bind_address,
                    normalized.remote_host,
                    normalized.remote_port,
                    normalized.username,
                    normalized.key_path,
                    Utc::now().timestamp_millis(),
                    id,
                ],
            )
            .map_err(database_or_tunnel_error)?;
        if count == 0 {
            return Err(ssh_tunnel_not_found());
        }
        Self::get(conn, id)
    }

    pub fn delete(conn: &Connection, id: &str) -> BackendResult<()> {
        let count = conn
            .execute("DELETE FROM ssh_tunnels WHERE id = ?1", [id])
            .map_err(|err| BackendError::Database(err.to_string()))?;
        if count == 0 {
            return Err(ssh_tunnel_not_found());
        }
        Ok(())
    }

    fn from_row(row: &Row<'_>) -> rusqlite::Result<SshTunnel> {
        Ok(SshTunnel {
            id: row.get("id")?,
            name: row.get("name")?,
            description: row.get("description")?,
            local_port: row.get("local_port")?,
            bind_address: row.get("bind_address")?,
            remote_host: row.get("remote_host")?,
            remote_port: row.get("remote_port")?,
            username: row.get("username")?,
            key_path: row.get("key_path")?,
            auth_type: row.get("auth_type")?,
            created_at: millis_to_datetime(row.get("created_at")?, CREATED_AT_COLUMN_INDEX)?,
            updated_at: millis_to_datetime(row.get("updated_at")?, UPDATED_AT_COLUMN_INDEX)?,
        })
    }
}

impl SshTunnelSettingsRepository {
    pub fn get(conn: &Connection) -> BackendResult<SshTunnelSettings> {
        let value = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                [SSH_EXECUTABLE_PATH_KEY],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|err| BackendError::Database(err.to_string()))?
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        Ok(SshTunnelSettings {
            ssh_executable_path: value,
        })
    }

    pub fn save(conn: &Connection, ssh_executable_path: &str) -> BackendResult<SshTunnelSettings> {
        let path = ssh_executable_path.trim();
        if path.is_empty() {
            return Err(BackendError::NetworkDiagnostic(
                "SSH 程序路径不能为空。".to_string(),
            ));
        }
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![SSH_EXECUTABLE_PATH_KEY, path],
        )
        .map_err(|err| BackendError::Database(err.to_string()))?;
        Self::get(conn)
    }
}

struct NormalizedSshTunnel {
    name: String,
    description: Option<String>,
    local_port: u16,
    bind_address: String,
    remote_host: String,
    remote_port: u16,
    username: String,
    key_path: String,
}

fn normalize_input(input: NewSshTunnel) -> BackendResult<NormalizedSshTunnel> {
    let name = required(input.name, "隧道名称不能为空。")?;
    let bind_address = required(input.bind_address, "绑定地址不能为空。")?;
    if bind_address != "127.0.0.1" && bind_address != "0.0.0.0" {
        return Err(BackendError::NetworkDiagnostic(
            "绑定地址必须是 127.0.0.1 或 0.0.0.0。".to_string(),
        ));
    }
    Ok(NormalizedSshTunnel {
        name,
        description: input
            .description
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        local_port: input.local_port,
        bind_address,
        remote_host: required(input.remote_host, "远程地址不能为空。")?,
        remote_port: input.remote_port,
        username: required(input.username, "用户名不能为空。")?,
        key_path: required(input.key_path, "私钥文件不能为空。")?,
    })
}

fn required(value: String, message: &str) -> BackendResult<String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(BackendError::NetworkDiagnostic(message.to_string()));
    }
    Ok(value)
}

pub fn build_ssh_args(tunnel: &SshTunnel) -> Vec<String> {
    vec![
        "-L".to_string(),
        format!(
            "{}:{}:{}:{}",
            tunnel.bind_address, tunnel.local_port, tunnel.remote_host, tunnel.remote_port
        ),
        "-N".to_string(),
        "-i".to_string(),
        tunnel.key_path.clone(),
        "-o".to_string(),
        "BatchMode=yes".to_string(),
        "-o".to_string(),
        "StrictHostKeyChecking=no".to_string(),
        format!("{}@{}", tunnel.username, tunnel.remote_host),
    ]
}

fn database_or_tunnel_error(err: rusqlite::Error) -> BackendError {
    let message = err.to_string();
    if message.contains("idx_ssh_tunnels_name") || message.contains("UNIQUE constraint failed") {
        BackendError::NetworkDiagnostic("隧道名称已存在。".to_string())
    } else {
        BackendError::Database(message)
    }
}

fn ssh_tunnel_not_found() -> BackendError {
    BackendError::NetworkDiagnostic("SSH 隧道不存在。".to_string())
}

fn millis_to_datetime(millis: i64, column_index: usize) -> rusqlite::Result<DateTime<Utc>> {
    DateTime::<Utc>::from_timestamp_millis(millis).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            column_index,
            rusqlite::types::Type::Integer,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid ssh tunnel timestamp millis {millis}"),
            )),
        )
    })
}

pub fn detect_ssh_executable() -> BackendResult<PathBuf> {
    let paths = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    detect_ssh_executable_in_paths(paths).ok_or_else(|| {
        BackendError::NetworkDiagnostic(
            "未在环境变量 PATH 中找到 ssh 程序，请手动选择 ssh.exe 路径。".to_string(),
        )
    })
}

fn detect_ssh_executable_in_paths(paths: Vec<PathBuf>) -> Option<PathBuf> {
    let names: &[&str] = if cfg!(target_os = "windows") {
        &["ssh.exe", "ssh"]
    } else {
        &["ssh"]
    };
    for dir in paths {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}
```

- [ ] **Step 4: Register module**

Add to `src-tauri/src/lib.rs`:

```rust
mod ssh_tunnels;
```

- [ ] **Step 5: Run repository tests**

Run:

```bash
cd src-tauri
cargo test ssh_tunnels::tests
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/ssh_tunnels.rs src-tauri/src/lib.rs
git commit -m "Add SSH tunnel repository"
```

### Task 3: Backend Process Manager And Tauri Commands

**Files:**
- Modify: `src-tauri/src/ssh_tunnels.rs`
- Modify: `src-tauri/src/app_state.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Add backend process tests**

Add these tests to `src-tauri/src/ssh_tunnels.rs`:

```rust
#[test]
fn port_available_reports_false_for_bound_port() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();

    assert!(!is_port_available("127.0.0.1", port));
}

#[test]
fn tunnel_info_merges_stopped_runtime_by_default() {
    let conn = crate::db::test_connection();
    let tunnel = SshTunnelRepository::create(&conn, tests::sample_input()).unwrap();
    let manager = SshTunnelManager::default();

    let info = manager.info_for(tunnel);

    assert_eq!(info.status, crate::models::SshTunnelStatus::Stopped);
    assert_eq!(info.pid, None);
    assert_eq!(info.error_message, None);
}

#[cfg(target_os = "windows")]
#[test]
fn windows_kill_command_uses_taskkill_tree_force() {
    assert_eq!(
        kill_process_tree_command(1234),
        ("taskkill".to_string(), vec!["/PID".to_string(), "1234".to_string(), "/T".to_string(), "/F".to_string()])
    );
}
```

- [ ] **Step 2: Run process tests and verify failure**

Run:

```bash
cd src-tauri
cargo test ssh_tunnels::tests::port_available_reports_false_for_bound_port ssh_tunnels::tests::tunnel_info_merges_stopped_runtime_by_default
```

Expected: compile failure because manager/process helpers are missing.

- [ ] **Step 3: Implement process manager**

Add to `src-tauri/src/ssh_tunnels.rs` after repository helpers:

```rust
use crate::models::{SshTunnelInfo, SshTunnelStatus};
use std::collections::HashMap;
use std::net::TcpListener;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use tokio::time::{sleep, Duration};

#[derive(Clone, Default)]
pub struct SshTunnelManager {
    runtimes: Arc<Mutex<HashMap<String, SshTunnelRuntime>>>,
}

struct SshTunnelRuntime {
    status: SshTunnelStatus,
    child: Option<Arc<tokio::sync::Mutex<Child>>>,
    pid: Option<u32>,
    started_at: Option<DateTime<Utc>>,
    error_message: Option<String>,
    stopping: bool,
}

impl SshTunnelManager {
    pub fn info_for(&self, tunnel: SshTunnel) -> SshTunnelInfo {
        let runtimes = self.runtimes.lock().unwrap();
        let runtime = runtimes.get(&tunnel.id);
        SshTunnelInfo {
            id: tunnel.id,
            name: tunnel.name,
            description: tunnel.description,
            local_port: tunnel.local_port,
            bind_address: tunnel.bind_address,
            remote_host: tunnel.remote_host,
            remote_port: tunnel.remote_port,
            username: tunnel.username,
            key_path: tunnel.key_path,
            auth_type: tunnel.auth_type,
            status: runtime.map(|value| value.status).unwrap_or(SshTunnelStatus::Stopped),
            pid: runtime.and_then(|value| value.pid),
            started_at: runtime.and_then(|value| value.started_at),
            error_message: runtime.and_then(|value| value.error_message.clone()),
            created_at: tunnel.created_at,
            updated_at: tunnel.updated_at,
        }
    }

    pub fn is_active(&self, id: &str) -> bool {
        let runtimes = self.runtimes.lock().unwrap();
        matches!(
            runtimes.get(id).map(|runtime| runtime.status),
            Some(SshTunnelStatus::Starting | SshTunnelStatus::Running)
        )
    }

    pub async fn start(
        &self,
        tunnel: SshTunnel,
        ssh_executable_path: PathBuf,
    ) -> BackendResult<SshTunnelInfo> {
        if self.is_active(&tunnel.id) {
            return Err(BackendError::NetworkDiagnostic("SSH 隧道已在运行。".to_string()));
        }
        if !ssh_executable_path.is_file() {
            return Err(BackendError::NetworkDiagnostic(format!(
                "SSH 程序不存在: {}",
                ssh_executable_path.display()
            )));
        }
        if !Path::new(&tunnel.key_path).exists() {
            return Err(BackendError::NetworkDiagnostic(format!(
                "私钥文件不存在: {}",
                tunnel.key_path
            )));
        }
        if !is_port_available(&tunnel.bind_address, tunnel.local_port) {
            return Err(BackendError::NetworkDiagnostic(format!(
                "端口 {} 已被占用，请更换端口或先停止占用该端口的程序。",
                tunnel.local_port
            )));
        }
        self.set_starting(&tunnel.id);
        let mut command = background_ssh_command(&ssh_executable_path);
        command.args(build_ssh_args(&tunnel));
        command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|err| BackendError::NetworkDiagnostic(format!("启动 ssh 失败: {err}")))?;
        let pid = child.id();
        let stderr = child.stderr.take();
        let stderr_buffer = Arc::new(tokio::sync::Mutex::new(String::new()));
        if let Some(mut stderr) = stderr {
            let stderr_buffer = stderr_buffer.clone();
            tauri::async_runtime::spawn(async move {
                let mut bytes = Vec::new();
                let _ = stderr.read_to_end(&mut bytes).await;
                let text = String::from_utf8_lossy(&bytes).to_string();
                let mut buffer = stderr_buffer.lock().await;
                *buffer = summarize_output(&text);
            });
        }
        sleep(Duration::from_secs(2)).await;
        match child.try_wait() {
            Ok(Some(status)) => {
                let error = format!(
                    "SSH 进程退出，退出码: {}{}",
                    status,
                    stderr_suffix(&stderr_buffer).await
                );
                self.set_error(&tunnel.id, error);
            }
            Ok(None) => {
                let child = Arc::new(tokio::sync::Mutex::new(child));
                self.set_running(&tunnel.id, child.clone(), pid);
                self.spawn_monitor(tunnel.id.clone(), child, stderr_buffer);
            }
            Err(err) => {
                self.set_error(&tunnel.id, format!("进程检查失败: {err}"));
            }
        }
        Ok(self.info_for(tunnel))
    }

    pub async fn stop(&self, tunnel: SshTunnel) -> BackendResult<SshTunnelInfo> {
        let pid = {
            let mut runtimes = self.runtimes.lock().unwrap();
            let runtime = runtimes.entry(tunnel.id.clone()).or_insert_with(stopped_runtime);
            runtime.stopping = true;
            runtime.pid
        };
        if let Some(pid) = pid {
            kill_process_tree(pid).await?;
        }
        {
            let mut runtimes = self.runtimes.lock().unwrap();
            runtimes.insert(tunnel.id.clone(), stopped_runtime());
        }
        Ok(self.info_for(tunnel))
    }

    fn set_starting(&self, id: &str) {
        let mut runtimes = self.runtimes.lock().unwrap();
        runtimes.insert(
            id.to_string(),
            SshTunnelRuntime {
                status: SshTunnelStatus::Starting,
                child: None,
                pid: None,
                started_at: None,
                error_message: None,
                stopping: false,
            },
        );
    }

    fn set_running(&self, id: &str, child: Arc<tokio::sync::Mutex<Child>>, pid: Option<u32>) {
        let mut runtimes = self.runtimes.lock().unwrap();
        runtimes.insert(
            id.to_string(),
            SshTunnelRuntime {
                status: SshTunnelStatus::Running,
                child: Some(child),
                pid,
                started_at: Some(Utc::now()),
                error_message: None,
                stopping: false,
            },
        );
    }

    fn set_error(&self, id: &str, message: String) {
        let mut runtimes = self.runtimes.lock().unwrap();
        runtimes.insert(
            id.to_string(),
            SshTunnelRuntime {
                status: SshTunnelStatus::Error,
                child: None,
                pid: None,
                started_at: None,
                error_message: Some(message),
                stopping: false,
            },
        );
    }

    fn spawn_monitor(
        &self,
        id: String,
        child: Arc<tokio::sync::Mutex<Child>>,
        stderr_buffer: Arc<tokio::sync::Mutex<String>>,
    ) {
        let manager = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                sleep(Duration::from_secs(3)).await;
                let wait_result = {
                    let mut child = child.lock().await;
                    child.try_wait()
                };
                match wait_result {
                    Ok(Some(status)) => {
                        if !manager.is_stopping(&id) {
                            let message = format!(
                                "SSH 进程退出，退出码: {}{}",
                                status,
                                stderr_suffix(&stderr_buffer).await
                            );
                            manager.set_error(&id, message);
                        }
                        break;
                    }
                    Ok(None) => {}
                    Err(err) => {
                        if !manager.is_stopping(&id) {
                            manager.set_error(&id, format!("进程检查失败: {err}"));
                        }
                        break;
                    }
                }
            }
        });
    }

    fn is_stopping(&self, id: &str) -> bool {
        let runtimes = self.runtimes.lock().unwrap();
        runtimes.get(id).map(|runtime| runtime.stopping).unwrap_or(false)
    }
}

fn stopped_runtime() -> SshTunnelRuntime {
    SshTunnelRuntime {
        status: SshTunnelStatus::Stopped,
        child: None,
        pid: None,
        started_at: None,
        error_message: None,
        stopping: false,
    }
}

pub fn is_port_available(bind_address: &str, port: u16) -> bool {
    TcpListener::bind((bind_address, port)).is_ok()
}

fn background_ssh_command(ssh_executable_path: &Path) -> Command {
    let mut command = Command::new(ssh_executable_path);
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000000);
    }
    command
}

async fn kill_process_tree(pid: u32) -> BackendResult<()> {
    let (program, args) = kill_process_tree_command(pid);
    let output = Command::new(program)
        .args(args)
        .output()
        .await
        .map_err(|err| BackendError::NetworkDiagnostic(format!("停止 SSH 进程失败: {err}")))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(BackendError::NetworkDiagnostic(format!(
            "停止 SSH 进程失败: {}",
            String::from_utf8_lossy(&output.stderr)
        )))
    }
}

#[cfg(target_os = "windows")]
fn kill_process_tree_command(pid: u32) -> (String, Vec<String>) {
    (
        "taskkill".to_string(),
        vec!["/PID".to_string(), pid.to_string(), "/T".to_string(), "/F".to_string()],
    )
}

#[cfg(not(target_os = "windows"))]
fn kill_process_tree_command(pid: u32) -> (String, Vec<String>) {
    ("kill".to_string(), vec!["-TERM".to_string(), pid.to_string()])
}

fn summarize_output(value: &str) -> String {
    value.chars().take(2000).collect()
}

async fn stderr_suffix(stderr_buffer: &Arc<tokio::sync::Mutex<String>>) -> String {
    let stderr = stderr_buffer.lock().await;
    if stderr.trim().is_empty() {
        String::new()
    } else {
        format!("，stderr: {}", stderr.trim())
    }
}
```

- [ ] **Step 4: Add manager to app state**

Modify `src-tauri/src/app_state.rs`:

```rust
use crate::ssh_tunnels::SshTunnelManager;
```

Add field:

```rust
pub ssh_tunnel_manager: SshTunnelManager,
```

Set it in `new_with_log_path`:

```rust
ssh_tunnel_manager: SshTunnelManager::default(),
```

- [ ] **Step 5: Add Tauri command wrappers**

Add imports to `src-tauri/src/commands.rs`:

```rust
use crate::models::{NewSshTunnel, SshTunnelInfo};
use crate::ssh_tunnels::SshTunnelRepository;
```

Add commands:

```rust
#[tauri::command]
pub async fn get_ssh_tunnel_settings(
    state: State<'_, AppState>,
) -> CommandResult<crate::models::SshTunnelSettings> {
    let conn = state
        .conn
        .lock()
        .map_err(|err| BackendError::Database(err.to_string()))?;
    crate::ssh_tunnels::SshTunnelSettingsRepository::get(&conn).map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn update_ssh_tunnel_settings(
    state: State<'_, AppState>,
    input: crate::models::SshTunnelSettings,
) -> CommandResult<crate::models::SshTunnelSettings> {
    let path = input.ssh_executable_path.unwrap_or_default();
    let conn = state
        .conn
        .lock()
        .map_err(|err| BackendError::Database(err.to_string()))?;
    crate::ssh_tunnels::SshTunnelSettingsRepository::save(&conn, &path).map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn list_ssh_tunnels(state: State<'_, AppState>) -> CommandResult<Vec<SshTunnelInfo>> {
    let tunnels = {
        let conn = state
            .conn
            .lock()
            .map_err(|err| BackendError::Database(err.to_string()))?;
        SshTunnelRepository::list(&conn).map_err(ErrorPayload::from)?
    };
    Ok(tunnels
        .into_iter()
        .map(|tunnel| state.ssh_tunnel_manager.info_for(tunnel))
        .collect())
}

#[tauri::command]
pub async fn create_ssh_tunnel(
    state: State<'_, AppState>,
    input: NewSshTunnel,
) -> CommandResult<SshTunnelInfo> {
    let ssh_executable_path = resolve_ssh_executable_path(state.inner()).map_err(ErrorPayload::from)?;
    let tunnel = {
        let conn = state
            .conn
            .lock()
            .map_err(|err| BackendError::Database(err.to_string()))?;
        SshTunnelRepository::create(&conn, input).map_err(ErrorPayload::from)?
    };
    state
        .ssh_tunnel_manager
        .start(tunnel, ssh_executable_path)
        .await
        .map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn update_ssh_tunnel(
    state: State<'_, AppState>,
    id: String,
    input: NewSshTunnel,
) -> CommandResult<SshTunnelInfo> {
    if state.ssh_tunnel_manager.is_active(&id) {
        return Err(ErrorPayload::from(BackendError::NetworkDiagnostic(
            "请先停止 SSH 隧道，再编辑。".to_string(),
        )));
    }
    let tunnel = {
        let conn = state
            .conn
            .lock()
            .map_err(|err| BackendError::Database(err.to_string()))?;
        SshTunnelRepository::update(&conn, &id, input).map_err(ErrorPayload::from)?
    };
    Ok(state.ssh_tunnel_manager.info_for(tunnel))
}

#[tauri::command]
pub async fn delete_ssh_tunnel(state: State<'_, AppState>, id: String) -> CommandResult<()> {
    if state.ssh_tunnel_manager.is_active(&id) {
        return Err(ErrorPayload::from(BackendError::NetworkDiagnostic(
            "请先停止 SSH 隧道，再删除。".to_string(),
        )));
    }
    let conn = state
        .conn
        .lock()
        .map_err(|err| BackendError::Database(err.to_string()))?;
    SshTunnelRepository::delete(&conn, &id).map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn start_ssh_tunnel(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<SshTunnelInfo> {
    let ssh_executable_path = resolve_ssh_executable_path(state.inner()).map_err(ErrorPayload::from)?;
    let tunnel = {
        let conn = state
            .conn
            .lock()
            .map_err(|err| BackendError::Database(err.to_string()))?;
        SshTunnelRepository::get(&conn, &id).map_err(ErrorPayload::from)?
    };
    state
        .ssh_tunnel_manager
        .start(tunnel, ssh_executable_path)
        .await
        .map_err(ErrorPayload::from)
}

#[tauri::command]
pub async fn stop_ssh_tunnel(
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<SshTunnelInfo> {
    let tunnel = {
        let conn = state
            .conn
            .lock()
            .map_err(|err| BackendError::Database(err.to_string()))?;
        SshTunnelRepository::get(&conn, &id).map_err(ErrorPayload::from)?
    };
    state
        .ssh_tunnel_manager
        .stop(tunnel)
        .await
        .map_err(ErrorPayload::from)
}

fn resolve_ssh_executable_path(state: &AppState) -> crate::error::BackendResult<std::path::PathBuf> {
    let conn = state
        .conn
        .lock()
        .map_err(|err| BackendError::Database(err.to_string()))?;
    let settings = crate::ssh_tunnels::SshTunnelSettingsRepository::get(&conn)?;
    if let Some(path) = settings.ssh_executable_path {
        let path = std::path::PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
        return Err(BackendError::NetworkDiagnostic(format!(
            "SSH 程序不存在: {}",
            path.display()
        )));
    }
    let detected = crate::ssh_tunnels::detect_ssh_executable()?;
    crate::ssh_tunnels::SshTunnelSettingsRepository::save(&conn, &detected.to_string_lossy())?;
    Ok(detected)
}
```

- [ ] **Step 6: Register commands**

Add to `tauri::generate_handler!` in `src-tauri/src/lib.rs`:

```rust
commands::list_ssh_tunnels,
commands::get_ssh_tunnel_settings,
commands::update_ssh_tunnel_settings,
commands::create_ssh_tunnel,
commands::update_ssh_tunnel,
commands::delete_ssh_tunnel,
commands::start_ssh_tunnel,
commands::stop_ssh_tunnel,
```

- [ ] **Step 7: Add frontend API wrappers**

Add imports and functions in `src/lib/api.ts`:

```ts
import type { NewSshTunnel, SshTunnelInfo, SshTunnelSettings } from "../types";

export async function getSshTunnelSettings(): Promise<SshTunnelSettings> {
  return invoke<SshTunnelSettings>("get_ssh_tunnel_settings");
}

export async function updateSshTunnelSettings(
  input: SshTunnelSettings,
): Promise<SshTunnelSettings> {
  return invoke<SshTunnelSettings>("update_ssh_tunnel_settings", { input });
}

export async function listSshTunnels(): Promise<SshTunnelInfo[]> {
  return invoke<SshTunnelInfo[]>("list_ssh_tunnels");
}

export async function createSshTunnel(
  input: NewSshTunnel,
): Promise<SshTunnelInfo> {
  return invoke<SshTunnelInfo>("create_ssh_tunnel", { input });
}

export async function updateSshTunnel(
  id: string,
  input: NewSshTunnel,
): Promise<SshTunnelInfo> {
  return invoke<SshTunnelInfo>("update_ssh_tunnel", { id, input });
}

export async function deleteSshTunnel(id: string): Promise<void> {
  return invoke<void>("delete_ssh_tunnel", { id });
}

export async function startSshTunnel(id: string): Promise<SshTunnelInfo> {
  return invoke<SshTunnelInfo>("start_ssh_tunnel", { id });
}

export async function stopSshTunnel(id: string): Promise<SshTunnelInfo> {
  return invoke<SshTunnelInfo>("stop_ssh_tunnel", { id });
}
```

- [ ] **Step 8: Run backend tests**

Run:

```bash
cd src-tauri
cargo test ssh_tunnels::tests
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/ssh_tunnels.rs src-tauri/src/app_state.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/api.ts
git commit -m "Add SSH tunnel backend commands"
```

### Task 4: Top-Level Navigation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/WorkbenchHome.tsx`
- Test: `src/components/WorkbenchHome.test.tsx`

- [ ] **Step 1: Write failing navigation tests**

Add expectations to `src/components/WorkbenchHome.test.tsx`:

```ts
expect(screen.getByText("SSH 隧道")).toBeInTheDocument();
await user.type(screen.getByPlaceholderText(/搜索功能/), "qnx");
expect(screen.getByText("SSH 隧道")).toBeInTheDocument();
```

- [ ] **Step 2: Run frontend tests and verify failure**

Run:

```bash
npm test -- --run src/components/WorkbenchHome.test.tsx
```

Expected: FAIL because SSH tunnel card is not present.

- [ ] **Step 3: Add nav view and placeholder panel wiring**

Modify `src/App.tsx`:

```tsx
import { SshTunnelsPanel } from "./components/SshTunnelsPanel";
```

Add to `View`:

```ts
| "ssh"
```

Add to `NavIcon`:

```ts
| "terminal"
```

Add nav item after network:

```ts
{ view: "ssh", label: "SSH 隧道", icon: "terminal" },
```

Add render branch:

```tsx
{view === "ssh" ? <SshTunnelsPanel /> : null}
```

Add icon paths:

```ts
terminal: [
  "m5 7 5 5-5 5",
  "M12 17h7",
],
```

- [ ] **Step 4: Add workbench entry**

Modify `src/components/WorkbenchHome.tsx` props:

```ts
onOpenSshTunnels: () => void;
```

Add tool entry:

```ts
{
  id: "ssh",
  label: "SSH 隧道",
  description: "管理本地端口转发隧道，支持 QNX、Linux 和内网服务访问。",
  keywords: "ssh 隧道 端口转发 qnx linux 内网",
  actions: [{ label: "管理隧道", onClick: onOpenSshTunnels, primary: true }],
}
```

Pass `onOpenSshTunnels={() => setView("ssh")}` from `App.tsx`.

- [ ] **Step 5: Create temporary panel shell**

Create `src/components/SshTunnelsPanel.tsx`:

```tsx
export function SshTunnelsPanel() {
  return (
    <section className="ssh-panel">
      <div className="ssh-hero">
        <div>
          <h1>SSH 隧道</h1>
          <p className="muted">管理本地端口转发隧道。</p>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- --run src/components/WorkbenchHome.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/components/WorkbenchHome.tsx src/components/WorkbenchHome.test.tsx src/components/SshTunnelsPanel.tsx
git commit -m "Add SSH tunnel navigation"
```

### Task 5: SSH Tunnel Panel UI

**Files:**
- Modify: `src/components/SshTunnelsPanel.tsx`
- Create: `src/components/SshTunnelsPanel.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing panel tests**

Create `src/components/SshTunnelsPanel.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { SshTunnelsPanel } from "./SshTunnelsPanel";

const stoppedTunnel = {
  id: "ssh-1",
  name: "QNX调试",
  description: "debug",
  localPort: 8080,
  bindAddress: "127.0.0.1",
  remoteHost: "172.31.3.1",
  remotePort: 22,
  username: "root",
  keyPath: "C:\\keys\\8797_rsa2048",
  authType: "private_key",
  status: "stopped",
  pid: null,
  startedAt: null,
  errorMessage: null,
  createdAt: "2026-06-26T00:00:00Z",
  updatedAt: "2026-06-26T00:00:00Z",
};

const runningTunnel = {
  ...stoppedTunnel,
  id: "ssh-2",
  name: "Web访问",
  localPort: 8081,
  remotePort: 80,
  status: "running",
  pid: 1234,
  startedAt: "2026-06-26T01:00:00Z",
};

const errorTunnel = {
  ...stoppedTunnel,
  id: "ssh-3",
  name: "失败隧道",
  localPort: 8082,
  status: "error",
  errorMessage: "Permission denied (publickey).",
};

vi.mock("../lib/api", () => ({
  getSshTunnelSettings: vi.fn(async () => ({
    sshExecutablePath: "C:\\Windows\\System32\\OpenSSH\\ssh.exe",
  })),
  updateSshTunnelSettings: vi.fn(async (input) => input),
  listSshTunnels: vi.fn(async () => [stoppedTunnel, runningTunnel, errorTunnel]),
  createSshTunnel: vi.fn(async () => runningTunnel),
  updateSshTunnel: vi.fn(async () => stoppedTunnel),
  deleteSshTunnel: vi.fn(async () => undefined),
  startSshTunnel: vi.fn(async () => runningTunnel),
  stopSshTunnel: vi.fn(async () => stoppedTunnel),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => "C:\\keys\\selected_key"),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

it("loads and shows SSH tunnels", async () => {
  render(<SshTunnelsPanel />);

  expect(screen.getByRole("heading", { name: "SSH 隧道" })).toBeInTheDocument();
  expect(await screen.findByDisplayValue("C:\\Windows\\System32\\OpenSSH\\ssh.exe")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "全部 3" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "运行中 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "已停止 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "异常 1" })).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "SSH 隧道列表" })).toBeInTheDocument();
  expect(screen.getByText("QNX调试")).toBeInTheDocument();
  expect(screen.getByText("127.0.0.1:8080")).toBeInTheDocument();
  expect(screen.getByText("172.31.3.1:22")).toBeInTheDocument();
});

it("updates SSH executable path setting", async () => {
  const user = userEvent.setup();
  render(<SshTunnelsPanel />);

  const input = await screen.findByLabelText("SSH 程序路径");
  await user.clear(input);
  await user.type(input, "D:\\Git\\usr\\bin\\ssh.exe");
  await user.click(screen.getByRole("button", { name: "保存 SSH 路径" }));

  const api = await import("../lib/api");
  expect(api.updateSshTunnelSettings).toHaveBeenCalledWith({
    sshExecutablePath: "D:\\Git\\usr\\bin\\ssh.exe",
  });
});

it("starts, stops, restarts, and deletes tunnels", async () => {
  const user = userEvent.setup();
  render(<SshTunnelsPanel />);

  const stoppedRow = await screen.findByRole("row", { name: /QNX调试/ });
  await user.click(within(stoppedRow).getByRole("button", { name: "启动" }));

  const runningRow = screen.getByRole("row", { name: /Web访问/ });
  await user.click(within(runningRow).getByRole("button", { name: "停止" }));
  expect(within(runningRow).queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();

  const errorRow = screen.getByRole("row", { name: /失败隧道/ });
  await user.click(within(errorRow).getByRole("button", { name: "重启" }));
  await user.click(within(errorRow).getByRole("button", { name: "删除" }));

  const api = await import("../lib/api");
  expect(api.startSshTunnel).toHaveBeenCalledWith("ssh-1");
  expect(api.stopSshTunnel).toHaveBeenCalledWith("ssh-2");
  expect(api.startSshTunnel).toHaveBeenCalledWith("ssh-3");
  expect(api.deleteSshTunnel).toHaveBeenCalledWith("ssh-3");
});

it("validates create form and submits create-and-start", async () => {
  const user = userEvent.setup();
  render(<SshTunnelsPanel />);

  await user.click(screen.getByRole("button", { name: "新建隧道" }));
  await user.click(screen.getByRole("button", { name: "创建并启动" }));
  expect(screen.getByText("隧道名称不能为空。")).toBeInTheDocument();

  await user.type(screen.getByLabelText("隧道名称"), "QNX调试2");
  await user.clear(screen.getByLabelText("本地端口"));
  await user.type(screen.getByLabelText("本地端口"), "8088");
  await user.type(screen.getByLabelText("远程地址"), "172.31.3.1");
  await user.clear(screen.getByLabelText("远程端口"));
  await user.type(screen.getByLabelText("远程端口"), "22");
  await user.type(screen.getByLabelText("用户名"), "root");
  await user.click(screen.getByRole("button", { name: "选择私钥" }));
  await user.click(screen.getByRole("button", { name: "创建并启动" }));

  const api = await import("../lib/api");
  expect(api.createSshTunnel).toHaveBeenCalledWith({
    name: "QNX调试2",
    description: null,
    localPort: 8088,
    bindAddress: "127.0.0.1",
    remoteHost: "172.31.3.1",
    remotePort: 22,
    username: "root",
    keyPath: "C:\\keys\\selected_key",
  });
});

it("shows error details and private key permission hint", async () => {
  render(<SshTunnelsPanel />);

  expect(await screen.findByText("Permission denied (publickey).")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run panel tests and verify failure**

Run:

```bash
npm test -- --run src/components/SshTunnelsPanel.test.tsx
```

Expected: FAIL because the panel is still a shell.

- [ ] **Step 3: Implement panel state and actions**

Replace `src/components/SshTunnelsPanel.tsx` with a component that:

```tsx
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import {
  createSshTunnel,
  deleteSshTunnel,
  getSshTunnelSettings,
  listSshTunnels,
  startSshTunnel,
  stopSshTunnel,
  updateSshTunnelSettings,
  updateSshTunnel,
} from "../lib/api";
import type { NewSshTunnel, SshTunnelBindAddress, SshTunnelInfo } from "../types";
```

The component keeps `tunnels`, `settings`, `sshExecutablePath`, `mode`, `editingTunnel`, form fields, `error`, and `isBusy` in React state. `useEffect` calls `refresh()` and `getSshTunnelSettings()` on mount. Mutating tunnel actions call the corresponding API and then `refresh()`. Saving the SSH path calls `updateSshTunnelSettings({ sshExecutablePath: sshExecutablePath.trim() })`.

The settings area renders before the tunnel list:

```tsx
<label className="field-label">
  SSH 程序路径
  <input
    aria-label="SSH 程序路径"
    value={sshExecutablePath}
    onChange={(event) => setSshExecutablePath(event.target.value)}
    placeholder="未配置时自动检测 PATH 中的 ssh.exe"
  />
</label>
<button type="button" onClick={saveSshExecutablePath}>
  保存 SSH 路径
</button>
<button type="button" onClick={chooseSshExecutable}>
  选择 SSH 程序
</button>
```

`chooseSshExecutable` uses `open({ multiple: false, directory: false })` and writes the selected path to `sshExecutablePath`; `saveSshExecutablePath` persists it.

Use these validation rules before create/update:

```ts
function validatePort(value: string, label: string) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return `${label}必须是 1 到 65535 之间的整数。`;
  }
  return null;
}
```

The create payload must be:

```ts
const payload: NewSshTunnel = {
  name: name.trim(),
  description: description.trim() ? description.trim() : null,
  localPort: Number(localPort),
  bindAddress,
  remoteHost: remoteHost.trim(),
  remotePort: Number(remotePort),
  username: username.trim(),
  keyPath: keyPath.trim(),
};
```

The list must render accessible buttons with exact labels used in tests: `启动`, `停止`, `重启`, `编辑`, `删除`, `新建隧道`, `创建并启动`, `选择私钥`, `保存 SSH 路径`, and `选择 SSH 程序`.

- [ ] **Step 4: Add focused styles**

Add CSS classes to `src/styles.css`:

```css
.ssh-panel {
  display: grid;
  gap: 18px;
}

.ssh-hero,
.ssh-toolbar,
.ssh-form-panel,
.ssh-table-wrap {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 18px;
}

.ssh-toolbar {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  align-items: center;
}

.ssh-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ssh-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.ssh-form-actions,
.ssh-row-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.ssh-status {
  display: inline-flex;
  align-items: center;
  min-width: 72px;
  font-weight: 700;
}

.ssh-error-detail {
  color: var(--danger);
  max-width: 420px;
  overflow-wrap: anywhere;
}

@media (max-width: 760px) {
  .ssh-toolbar,
  .ssh-form-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Run panel tests**

Run:

```bash
npm test -- --run src/components/SshTunnelsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/SshTunnelsPanel.tsx src/components/SshTunnelsPanel.test.tsx src/styles.css
git commit -m "Add SSH tunnel panel"
```

### Task 6: Full Verification And Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Add under implemented features:

```markdown
### SSH 隧道

- 支持本地端口转发（`ssh -L`）。
- 使用系统 OpenSSH，不内置 SSH 协议实现。
- 支持私钥文件认证。
- 支持配置 SSH 程序路径；未配置时自动检测 PATH 中的 ssh.exe/ssh 并保存。
- 支持启动、停止、重启、编辑和删除隧道。
- 使用数据库保存隧道配置，运行状态由应用后台进程管理。
- 启动前检查本地端口占用和私钥文件是否存在。
```

- [ ] **Step 2: Run frontend tests**

Run:

```bash
npm test -- --run
```

Expected: PASS.

- [ ] **Step 3: Run frontend build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Run Rust tests**

Run:

```bash
cd src-tauri
cargo test
```

Expected: PASS.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md
git commit -m "Document SSH tunnel module"
```

- [ ] **Step 6: Manual smoke test**

Run:

```bash
npm run tauri dev
```

Expected:

- The app opens with `SSH 隧道` in the sidebar.
- Creating a tunnel with an occupied local port shows a non-blocking error.
- Creating a tunnel with a missing key shows a non-blocking error.
- Starting a valid tunnel returns control to the UI while backend process management waits and monitors in Tauri.
- Stopping a running tunnel closes the local port.

## Self-Review

Spec coverage:

- Top-level module is covered by Task 4.
- SQLite persistence is covered by Tasks 1 and 2.
- SSH executable path settings and PATH auto-detection are covered by Tasks 2, 3, and 5.
- Private-key-only auth is covered by schema, repository, command builder, and UI form tasks.
- Backend-only process work is covered by Task 3.
- React UI list/create/edit/action flows are covered by Task 5.
- Verification and README are covered by Task 6.

Placeholder scan:

- No `TBD`, `TODO`, or incomplete task markers are present outside the task checkboxes.
- Each task includes concrete files, commands, and expected outcomes.

Type consistency:

- Rust serde uses camelCase, matching TypeScript `NewSshTunnel` and `SshTunnelInfo`.
- Command names match API wrappers and Tauri registration names.
