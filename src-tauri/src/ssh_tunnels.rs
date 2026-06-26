use crate::error::{BackendError, BackendResult};
use crate::models::{NewSshTunnel, SshTunnel, SshTunnelSettings};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::path::PathBuf;
use uuid::Uuid;

pub struct SshTunnelRepository;
pub struct SshTunnelSettingsRepository;

const AUTH_TYPE_PRIVATE_KEY: &str = "private_key";
const SSH_EXECUTABLE_PATH_KEY: &str = "ssh_executable_path";
const CREATED_AT_COLUMN_INDEX: usize = 10;
const UPDATED_AT_COLUMN_INDEX: usize = 11;

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
        format!("{}@{}", tunnel.username, tunnel.remote_host),
    ]
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
}
