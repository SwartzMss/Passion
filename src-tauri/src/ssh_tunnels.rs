use crate::error::{BackendError, BackendResult};
use crate::models::{NewSshTunnel, SshTunnel, SshTunnelSettings};
use crate::models::{SshTunnelInfo, SshTunnelStatus};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::{HashMap, VecDeque};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command as TokioCommand};
use tokio::time::{sleep, timeout, Duration, Instant};
use uuid::Uuid;

pub struct SshTunnelRepository;
pub struct SshTunnelSettingsRepository;

const AUTH_TYPE_PRIVATE_KEY: &str = "private_key";
const SSH_EXECUTABLE_PATH_KEY: &str = "ssh_executable_path";
const CREATED_AT_COLUMN_INDEX: usize = 10;
const UPDATED_AT_COLUMN_INDEX: usize = 11;
const SSH_CONNECT_TIMEOUT_SECS: u64 = 5;
const SSH_STARTUP_TIMEOUT_SECS: u64 = SSH_CONNECT_TIMEOUT_SECS + 2;
const SSH_STARTUP_POLL_MS: u64 = 200;
// Retain only the most recent stderr bytes so long-running tunnels stay bounded.
const SSH_STDERR_BUFFER_LIMIT_BYTES: usize = 64 * 1024;
const SSH_STDERR_READ_CHUNK_BYTES: usize = 4096;
const SSH_STDERR_DRAIN_TIMEOUT_SECS: u64 = 1;
#[cfg(test)]
const STDERR_CHILD_ENV: &str = "PASSION_SSH_STDERR_CHILD";

impl SshTunnelRepository {
    pub fn create(conn: &Connection, input: NewSshTunnel) -> BackendResult<SshTunnel> {
        let input = normalize_input(input)?;
        let now = Utc::now();
        let tunnel = SshTunnel {
            id: Uuid::new_v4().to_string(),
            name: input.name,
            description: input.description,
            local_port: input.local_port,
            bind_address: input.bind_address,
            remote_host: input.remote_host,
            remote_port: input.remote_port,
            username: input.username,
            key_path: input.key_path,
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
        conn.query_row(
            "SELECT * FROM ssh_tunnels WHERE id = ?1",
            [id],
            Self::from_row,
        )
        .optional()
        .map_err(|err| BackendError::Database(err.to_string()))?
        .ok_or_else(ssh_tunnel_not_found)
    }

    pub fn update(conn: &Connection, id: &str, input: NewSshTunnel) -> BackendResult<SshTunnel> {
        Self::get(conn, id)?;
        let input = normalize_input(input)?;
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
                    input.name,
                    input.description,
                    input.local_port,
                    input.bind_address,
                    input.remote_host,
                    input.remote_port,
                    input.username,
                    input.key_path,
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
    let bind_address = required(input.bind_address, "绑定地址不能为空。")?;
    if bind_address != "127.0.0.1" && bind_address != "0.0.0.0" {
        return Err(BackendError::NetworkDiagnostic(
            "绑定地址必须是 127.0.0.1 或 0.0.0.0。".to_string(),
        ));
    }

    Ok(NormalizedSshTunnel {
        name: required(input.name, "隧道名称不能为空。")?,
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
        "-o".to_string(),
        "ExitOnForwardFailure=yes".to_string(),
        "-o".to_string(),
        format!("ConnectTimeout={SSH_CONNECT_TIMEOUT_SECS}"),
        "-o".to_string(),
        "ConnectionAttempts=1".to_string(),
        format!("{}@{}", tunnel.username, tunnel.remote_host),
    ]
}

pub fn tunnel_log_context(tunnel: &SshTunnel) -> String {
    format!(
        "id={} name={} local={}:{} remote={}:{} username={} key_path={}",
        tunnel.id,
        tunnel.name,
        tunnel.bind_address,
        tunnel.local_port,
        tunnel.remote_host,
        tunnel.remote_port,
        tunnel.username,
        tunnel.key_path
    )
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

#[derive(Clone, Default)]
pub struct SshTunnelManager {
    runtimes: Arc<Mutex<HashMap<String, SshTunnelRuntime>>>,
}

struct SshTunnelRuntime {
    status: SshTunnelStatus,
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
            status: runtime
                .map(|value| value.status)
                .unwrap_or(SshTunnelStatus::Stopped),
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
        log_path: PathBuf,
    ) -> BackendResult<SshTunnelInfo> {
        crate::app_log::info(
            log_path.as_path(),
            format!(
                "ssh_tunnel_start_requested {} ssh_path={}",
                tunnel_log_context(&tunnel),
                ssh_executable_path.display()
            ),
        );
        if self.is_active(&tunnel.id) {
            crate::app_log::warn(
                log_path.as_path(),
                format!(
                    "ssh_tunnel_start_rejected reason=already_running id={}",
                    tunnel.id
                ),
            );
            return Err(BackendError::NetworkDiagnostic(
                "SSH 隧道已在运行。".to_string(),
            ));
        }
        if !ssh_executable_path.is_file() {
            crate::app_log::error(
                log_path.as_path(),
                format!(
                    "ssh_tunnel_start_rejected reason=ssh_missing {} ssh_path={}",
                    tunnel_log_context(&tunnel),
                    ssh_executable_path.display()
                ),
            );
            return Err(BackendError::NetworkDiagnostic(format!(
                "SSH 程序不存在: {}",
                ssh_executable_path.display()
            )));
        }
        if !Path::new(&tunnel.key_path).exists() {
            crate::app_log::error(
                log_path.as_path(),
                format!(
                    "ssh_tunnel_start_rejected reason=key_missing {}",
                    tunnel_log_context(&tunnel)
                ),
            );
            return Err(BackendError::NetworkDiagnostic(format!(
                "私钥文件不存在: {}",
                tunnel.key_path
            )));
        }
        if !is_port_available(&tunnel.bind_address, tunnel.local_port) {
            crate::app_log::error(
                log_path.as_path(),
                format!(
                    "ssh_tunnel_start_rejected reason=port_in_use {}",
                    tunnel_log_context(&tunnel)
                ),
            );
            return Err(BackendError::NetworkDiagnostic(format!(
                "端口 {} 已被占用，请更换端口或先停止占用该端口的程序。",
                tunnel.local_port
            )));
        }

        self.set_starting(&tunnel.id);
        let mut command = background_ssh_command(&ssh_executable_path);
        command.args(build_ssh_args(&tunnel));
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        let mut child = command.spawn().map_err(|err| {
            let message = format!("启动 ssh 失败: {err}");
            self.set_error(&tunnel.id, message.clone());
            crate::app_log::error(
                log_path.as_path(),
                format!(
                    "ssh_tunnel_spawn_failed {} ssh_path={} error={err}",
                    tunnel_log_context(&tunnel),
                    ssh_executable_path.display()
                ),
            );
            BackendError::NetworkDiagnostic(message)
        })?;
        let pid = child.id();
        crate::app_log::info(
            log_path.as_path(),
            format!(
                "ssh_tunnel_spawned {} ssh_path={} pid={}",
                tunnel_log_context(&tunnel),
                ssh_executable_path.display(),
                pid.map(|value| value.to_string())
                    .unwrap_or_else(|| "<unknown>".to_string())
            ),
        );
        let mut stderr_capture = child.stderr.take().map(spawn_stderr_capture);

        match wait_for_ssh_startup(&mut child).await {
            SshStartupState::Exited(status) => {
                let error = format!(
                    "SSH 进程退出，退出码: {}{}",
                    status,
                    stderr_suffix(stderr_capture.as_mut()).await
                );
                self.set_error(&tunnel.id, error.clone());
                crate::app_log::error(
                    log_path.as_path(),
                    format!(
                        "ssh_tunnel_start_failed {} pid={} error={}",
                        tunnel_log_context(&tunnel),
                        pid.map(|value| value.to_string())
                            .unwrap_or_else(|| "<unknown>".to_string()),
                        error
                    ),
                );
            }
            SshStartupState::Running => {
                let child = Arc::new(tokio::sync::Mutex::new(child));
                self.set_running(&tunnel.id, pid);
                crate::app_log::info(
                    log_path.as_path(),
                    format!(
                        "ssh_tunnel_running {} pid={}",
                        tunnel_log_context(&tunnel),
                        pid.map(|value| value.to_string())
                            .unwrap_or_else(|| "<unknown>".to_string())
                    ),
                );
                self.spawn_monitor(tunnel.id.clone(), child, stderr_capture, log_path);
            }
            SshStartupState::CheckFailed(err) => {
                let error = format!("进程检查失败: {err}");
                self.set_error(&tunnel.id, error.clone());
                crate::app_log::error(
                    log_path.as_path(),
                    format!(
                        "ssh_tunnel_start_check_failed {} pid={} error={}",
                        tunnel_log_context(&tunnel),
                        pid.map(|value| value.to_string())
                            .unwrap_or_else(|| "<unknown>".to_string()),
                        error
                    ),
                );
            }
        }

        Ok(self.info_for(tunnel))
    }

    pub async fn stop(&self, tunnel: SshTunnel, log_path: PathBuf) -> BackendResult<SshTunnelInfo> {
        let pid = {
            let mut runtimes = self.runtimes.lock().unwrap();
            let runtime = runtimes
                .entry(tunnel.id.clone())
                .or_insert_with(stopped_runtime);
            runtime.stopping = true;
            runtime.pid
        };
        crate::app_log::info(
            log_path.as_path(),
            format!(
                "ssh_tunnel_stop_requested {} pid={}",
                tunnel_log_context(&tunnel),
                pid.map(|value| value.to_string())
                    .unwrap_or_else(|| "<none>".to_string())
            ),
        );
        if let Some(pid) = pid {
            if let Err(err) = kill_process_tree(pid).await {
                crate::app_log::error(
                    log_path.as_path(),
                    format!(
                        "ssh_tunnel_stop_failed {} pid={} error={err}",
                        tunnel_log_context(&tunnel),
                        pid
                    ),
                );
                return Err(err);
            }
        }
        {
            let mut runtimes = self.runtimes.lock().unwrap();
            runtimes.insert(tunnel.id.clone(), stopped_runtime());
        }
        crate::app_log::info(
            log_path.as_path(),
            format!("ssh_tunnel_stopped {}", tunnel_log_context(&tunnel)),
        );
        Ok(self.info_for(tunnel))
    }

    fn set_starting(&self, id: &str) {
        let mut runtimes = self.runtimes.lock().unwrap();
        runtimes.insert(
            id.to_string(),
            SshTunnelRuntime {
                status: SshTunnelStatus::Starting,
                pid: None,
                started_at: None,
                error_message: None,
                stopping: false,
            },
        );
    }

    fn set_running(&self, id: &str, pid: Option<u32>) {
        let mut runtimes = self.runtimes.lock().unwrap();
        runtimes.insert(
            id.to_string(),
            SshTunnelRuntime {
                status: SshTunnelStatus::Running,
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
        mut stderr_capture: Option<StderrCapture>,
        log_path: PathBuf,
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
                                stderr_suffix(stderr_capture.as_mut()).await
                            );
                            crate::app_log::error(
                                log_path.as_path(),
                                format!("ssh_tunnel_exited id={} error={}", id, message),
                            );
                            manager.set_error(&id, message);
                        }
                        break;
                    }
                    Ok(None) => {}
                    Err(err) => {
                        if !manager.is_stopping(&id) {
                            let message = format!("进程检查失败: {err}");
                            crate::app_log::error(
                                log_path.as_path(),
                                format!("ssh_tunnel_monitor_failed id={} error={}", id, message),
                            );
                            manager.set_error(&id, message);
                        }
                        break;
                    }
                }
            }
        });
    }

    fn is_stopping(&self, id: &str) -> bool {
        let runtimes = self.runtimes.lock().unwrap();
        runtimes
            .get(id)
            .map(|runtime| runtime.stopping)
            .unwrap_or(false)
    }
}

enum SshStartupState {
    Running,
    Exited(ExitStatus),
    CheckFailed(std::io::Error),
}

async fn wait_for_ssh_startup(child: &mut Child) -> SshStartupState {
    let deadline = Instant::now() + Duration::from_secs(SSH_STARTUP_TIMEOUT_SECS);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return SshStartupState::Exited(status),
            Ok(None) if Instant::now() >= deadline => return SshStartupState::Running,
            Ok(None) => sleep(Duration::from_millis(SSH_STARTUP_POLL_MS)).await,
            Err(err) => return SshStartupState::CheckFailed(err),
        }
    }
}

fn stopped_runtime() -> SshTunnelRuntime {
    SshTunnelRuntime {
        status: SshTunnelStatus::Stopped,
        pid: None,
        started_at: None,
        error_message: None,
        stopping: false,
    }
}

pub fn is_port_available(bind_address: &str, port: u16) -> bool {
    TcpListener::bind((bind_address, port)).is_ok()
}

fn background_ssh_command(ssh_executable_path: &Path) -> TokioCommand {
    background_process_command(ssh_executable_path)
}

fn background_process_command(program: impl AsRef<Path>) -> TokioCommand {
    #[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
    let mut command = TokioCommand::new(program.as_ref());
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(background_process_creation_flags());
    }
    command
}

#[cfg(target_os = "windows")]
fn background_process_creation_flags() -> u32 {
    0x08000000
}

async fn kill_process_tree(pid: u32) -> BackendResult<()> {
    let (program, args) = kill_process_tree_command(pid);
    let output = background_process_command(program)
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
        vec![
            "/PID".to_string(),
            pid.to_string(),
            "/T".to_string(),
            "/F".to_string(),
        ],
    )
}

#[cfg(not(target_os = "windows"))]
fn kill_process_tree_command(pid: u32) -> (String, Vec<String>) {
    (
        "kill".to_string(),
        vec!["-TERM".to_string(), pid.to_string()],
    )
}

struct StderrRingBuffer {
    bytes: VecDeque<u8>,
}

impl StderrRingBuffer {
    fn new() -> Self {
        Self {
            bytes: VecDeque::with_capacity(SSH_STDERR_BUFFER_LIMIT_BYTES),
        }
    }

    fn append(&mut self, chunk: &[u8]) {
        if chunk.len() >= SSH_STDERR_BUFFER_LIMIT_BYTES {
            self.bytes.clear();
            self.bytes.extend(
                chunk[chunk.len() - SSH_STDERR_BUFFER_LIMIT_BYTES..]
                    .iter()
                    .copied(),
            );
            return;
        }

        let overflow = self
            .bytes
            .len()
            .saturating_add(chunk.len())
            .saturating_sub(SSH_STDERR_BUFFER_LIMIT_BYTES);
        for _ in 0..overflow {
            self.bytes.pop_front();
        }
        self.bytes.extend(chunk.iter().copied());
    }

    fn snapshot(&self) -> Vec<u8> {
        self.bytes.iter().copied().collect()
    }

    fn to_lossy_string(&self) -> String {
        String::from_utf8_lossy(&self.snapshot()).into_owned()
    }
}

struct StderrCapture {
    buffer: Arc<tokio::sync::Mutex<StderrRingBuffer>>,
    reader_task: Option<tauri::async_runtime::JoinHandle<()>>,
}

fn spawn_stderr_capture<R>(mut stderr: R) -> StderrCapture
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let buffer = Arc::new(tokio::sync::Mutex::new(StderrRingBuffer::new()));
    let shared_buffer = buffer.clone();
    let reader_task = tauri::async_runtime::spawn(async move {
        let mut chunk = [0u8; SSH_STDERR_READ_CHUNK_BYTES];
        loop {
            match stderr.read(&mut chunk).await {
                Ok(0) | Err(_) => break,
                Ok(size) => {
                    let mut buffer = shared_buffer.lock().await;
                    buffer.append(&chunk[..size]);
                }
            }
        }
    });

    StderrCapture {
        buffer,
        reader_task: Some(reader_task),
    }
}

impl StderrCapture {
    async fn snapshot(&mut self) -> String {
        if let Some(mut reader_task) = self.reader_task.take() {
            if timeout(
                Duration::from_secs(SSH_STDERR_DRAIN_TIMEOUT_SECS),
                &mut reader_task,
            )
            .await
            .is_err()
            {
                reader_task.abort();
                let _ = reader_task.await;
            }
        }
        let buffer = self.buffer.lock().await;
        buffer.to_lossy_string()
    }
}

async fn stderr_suffix(stderr_capture: Option<&mut StderrCapture>) -> String {
    let Some(stderr_capture) = stderr_capture else {
        return String::new();
    };
    let stderr = stderr_capture.snapshot().await;
    if stderr.trim().is_empty() {
        String::new()
    } else {
        format!("，stderr: {}", stderr.trim())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::models::NewSshTunnel;
    use std::io::Write;
    use tokio::time::timeout;

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
                "-o",
                "ExitOnForwardFailure=yes",
                "-o",
                "ConnectTimeout=5",
                "-o",
                "ConnectionAttempts=1",
                "root@172.31.3.1",
            ]
        );
    }

    #[test]
    fn startup_timeout_covers_ssh_connect_timeout() {
        assert!(SSH_STARTUP_TIMEOUT_SECS > SSH_CONNECT_TIMEOUT_SECS);
    }

    #[test]
    fn tunnel_log_context_includes_diagnostic_fields() {
        let conn = db::test_connection();
        let tunnel = SshTunnelRepository::create(&conn, sample_input()).unwrap();

        let context = tunnel_log_context(&tunnel);

        assert!(context.contains(&format!("id={}", tunnel.id)));
        assert!(context.contains("name=QNX调试"));
        assert!(context.contains("local=127.0.0.1:8080"));
        assert!(context.contains("remote=172.31.3.1:22"));
        assert!(context.contains("username=root"));
        assert!(context.contains("key_path=C:\\keys\\8797_rsa2048"));
    }

    #[test]
    fn settings_persists_ssh_executable_path() {
        let conn = db::test_connection();

        SshTunnelSettingsRepository::save(&conn, "C:\\Windows\\System32\\OpenSSH\\ssh.exe")
            .unwrap();

        let settings = SshTunnelSettingsRepository::get(&conn).unwrap();
        assert_eq!(
            settings.ssh_executable_path,
            Some("C:\\Windows\\System32\\OpenSSH\\ssh.exe".to_string())
        );
    }

    #[test]
    fn detect_ssh_executable_finds_candidate_in_path_list() {
        let temp = tempfile::tempdir().unwrap();
        let executable = temp.path().join(if cfg!(target_os = "windows") {
            "ssh.exe"
        } else {
            "ssh"
        });
        std::fs::write(&executable, "").unwrap();

        let detected = detect_ssh_executable_in_paths(vec![temp.path().to_path_buf()]).unwrap();

        assert_eq!(detected, executable);
    }

    #[test]
    fn port_available_reports_false_for_bound_port() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        assert!(!is_port_available("127.0.0.1", port));
    }

    #[test]
    fn tunnel_info_merges_stopped_runtime_by_default() {
        let conn = db::test_connection();
        let tunnel = SshTunnelRepository::create(&conn, sample_input()).unwrap();
        let manager = SshTunnelManager::default();

        let info = manager.info_for(tunnel);

        assert_eq!(info.status, crate::models::SshTunnelStatus::Stopped);
        assert_eq!(info.pid, None);
        assert_eq!(info.error_message, None);
    }

    #[test]
    fn stderr_ring_buffer_keeps_latest_bytes() {
        let mut buffer = StderrRingBuffer::new();
        let input: Vec<u8> = (0..SSH_STDERR_BUFFER_LIMIT_BYTES + 3)
            .map(|value| (value % 251) as u8)
            .collect();

        buffer.append(&input);

        assert_eq!(buffer.snapshot(), input[3..].to_vec());
    }

    #[test]
    fn stderr_ring_buffer_decodes_utf8_only_at_snapshot_boundary() {
        let mut buffer = StderrRingBuffer::new();
        buffer.append("连接失败".as_bytes());

        assert_eq!(buffer.to_lossy_string(), "连接失败");
    }

    #[test]
    fn stderr_writer_child() {
        if std::env::var_os(STDERR_CHILD_ENV).is_none() {
            return;
        }

        let mut stderr = std::io::stderr().lock();
        stderr.write_all(b"old-prefix-marker").unwrap();
        let chunk = vec![b'x'; SSH_STDERR_READ_CHUNK_BYTES];
        for _ in 0..(SSH_STDERR_BUFFER_LIMIT_BYTES / SSH_STDERR_READ_CHUNK_BYTES + 2) {
            stderr.write_all(&chunk).unwrap();
        }
        stderr.write_all(b"tail-marker").unwrap();
        stderr.flush().unwrap();
    }

    #[tokio::test]
    async fn stderr_reader_drains_a_child_and_keeps_the_latest_limit() {
        let executable = std::env::current_exe().unwrap();
        let mut child = TokioCommand::new(executable)
            .args([
                "--exact",
                "ssh_tunnels::tests::stderr_writer_child",
                "--nocapture",
            ])
            .env(STDERR_CHILD_ENV, "1")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let stderr = child.stderr.take().unwrap();
        let mut capture = spawn_stderr_capture(stderr);

        let status = timeout(Duration::from_secs(5), child.wait())
            .await
            .expect("child blocked on stderr pipe")
            .unwrap();
        assert!(status.success());

        let output = capture.snapshot().await;
        assert_eq!(output.as_bytes().len(), SSH_STDERR_BUFFER_LIMIT_BYTES);
        assert!(output.ends_with("tail-marker"));
        assert!(!output.contains("old-prefix-marker"));
    }

    #[tokio::test]
    async fn stderr_snapshot_does_not_wait_forever_for_an_open_pipe() {
        let (_writer, reader) = tokio::io::duplex(1);
        let mut capture = spawn_stderr_capture(reader);

        let result = timeout(Duration::from_secs(2), capture.snapshot()).await;

        assert!(result.is_ok(), "snapshot waited for stderr EOF");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_kill_command_uses_taskkill_tree_force() {
        assert_eq!(
            kill_process_tree_command(1234),
            (
                "taskkill".to_string(),
                vec![
                    "/PID".to_string(),
                    "1234".to_string(),
                    "/T".to_string(),
                    "/F".to_string()
                ]
            )
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_background_commands_use_no_window_flag() {
        assert_eq!(background_process_creation_flags(), 0x08000000);
    }
}
