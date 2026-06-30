use crate::error::{BackendError, BackendResult};
use crate::models::{
    PortCheckRequest, PortCheckResult, PortOccupancyEntry, PortOccupancyRequest,
    PortOccupancyResult, ProcessPortsRequest, ProcessPortsResult,
};
#[cfg(target_os = "windows")]
use encoding_rs::GBK;
use std::collections::HashMap;
use std::net::{TcpStream, ToSocketAddrs};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::time::{Duration, Instant};

pub async fn check_port(input: PortCheckRequest) -> BackendResult<PortCheckResult> {
    let host = input.host.trim().to_string();
    if host.is_empty() {
        return Err(BackendError::NetworkDiagnostic("请输入 Host。".to_string()));
    }
    let port = input.port;

    tauri::async_runtime::spawn_blocking(move || {
        let timeout = Duration::from_secs(3);
        let start = Instant::now();
        let mut addrs = (host.as_str(), port)
            .to_socket_addrs()
            .map_err(|err| BackendError::NetworkDiagnostic(err.to_string()))?;
        let Some(addr) = addrs.next() else {
            return Err(BackendError::NetworkDiagnostic(
                "无法解析 Host。".to_string(),
            ));
        };
        let result = TcpStream::connect_timeout(&addr, timeout);
        let elapsed_ms = start.elapsed().as_millis();

        Ok(PortCheckResult {
            host,
            port,
            open: result.is_ok(),
            elapsed_ms,
            error: result.err().map(|err| err.to_string()),
        })
    })
    .await
    .map_err(|err| BackendError::NetworkDiagnostic(err.to_string()))?
}

pub async fn inspect_port_occupancy(
    input: PortOccupancyRequest,
) -> BackendResult<PortOccupancyResult> {
    let port = input.port;
    tauri::async_runtime::spawn_blocking(move || {
        let output = background_command("netstat")
            .args(["-ano", "-p", "tcp"])
            .output()
            .map_err(|err| BackendError::NetworkDiagnostic(err.to_string()))?;
        let raw_output = decode_output(&output.stdout, &output.stderr);
        let mut entries = parse_netstat_listening_ports(&raw_output, port);
        let process_names = lookup_process_names(entries.iter().map(|entry| entry.pid).collect());
        for entry in &mut entries {
            entry.process_name = process_names.get(&entry.pid).cloned();
        }

        Ok(PortOccupancyResult { port, entries })
    })
    .await
    .map_err(|err| BackendError::NetworkDiagnostic(err.to_string()))?
}

pub async fn inspect_process_ports(
    input: ProcessPortsRequest,
) -> BackendResult<ProcessPortsResult> {
    let query = input.query.trim().to_string();
    if query.is_empty() {
        return Err(BackendError::NetworkDiagnostic(
            "请输入进程名称或 PID。".to_string(),
        ));
    }

    tauri::async_runtime::spawn_blocking(move || {
        let output = background_command("netstat")
            .args(["-ano", "-p", "tcp"])
            .output()
            .map_err(|err| BackendError::NetworkDiagnostic(err.to_string()))?;
        let raw_output = decode_output(&output.stdout, &output.stderr);
        let pids = parse_netstat_tcp_entries(&raw_output)
            .into_iter()
            .map(|entry| entry.pid)
            .collect();
        let process_names = lookup_process_names(pids);
        let entries = parse_netstat_ports_by_process_query(&raw_output, &query, &process_names);

        Ok(ProcessPortsResult { query, entries })
    })
    .await
    .map_err(|err| BackendError::NetworkDiagnostic(err.to_string()))?
}

fn decode_output(stdout: &[u8], stderr: &[u8]) -> String {
    #[cfg(target_os = "windows")]
    {
        let mut output = decode_windows_console_bytes(stdout);
        let err = decode_windows_console_bytes(stderr);
        if !err.trim().is_empty() {
            if !output.is_empty() {
                output.push('\n');
            }
            output.push_str(&err);
        }
        return output;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut output = String::from_utf8_lossy(stdout).to_string();
        let err = String::from_utf8_lossy(stderr);
        if !err.trim().is_empty() {
            if !output.is_empty() {
                output.push('\n');
            }
            output.push_str(&err);
        }
        output
    }
}

#[cfg(target_os = "windows")]
fn decode_windows_console_bytes(bytes: &[u8]) -> String {
    let utf8 = String::from_utf8_lossy(bytes);
    if !utf8.contains('�') {
        return utf8.to_string();
    }
    let (decoded, _, _) = GBK.decode(bytes);
    decoded.to_string()
}

fn parse_netstat_listening_ports(output: &str, port: u16) -> Vec<PortOccupancyEntry> {
    output
        .lines()
        .filter_map(|line| parse_netstat_line(line, port))
        .collect()
}

fn parse_netstat_line(line: &str, port: u16) -> Option<PortOccupancyEntry> {
    let entry = parse_netstat_tcp_line(line)?;
    if !entry.state.eq_ignore_ascii_case("LISTENING") {
        return None;
    }
    if !address_has_port(&entry.local_address, port) {
        return None;
    }
    Some(entry)
}

fn parse_netstat_tcp_entries(output: &str) -> Vec<PortOccupancyEntry> {
    output.lines().filter_map(parse_netstat_tcp_line).collect()
}

fn parse_netstat_tcp_line(line: &str) -> Option<PortOccupancyEntry> {
    let parts = line.split_whitespace().collect::<Vec<_>>();
    if parts.len() < 5 || !parts[0].eq_ignore_ascii_case("TCP") {
        return None;
    }
    let state = parts[3];
    let pid = parts[4].parse::<u32>().ok()?;
    Some(PortOccupancyEntry {
        protocol: parts[0].to_string(),
        local_address: parts[1].to_string(),
        state: state.to_string(),
        pid,
        process_name: None,
    })
}

fn parse_netstat_ports_by_process_query(
    output: &str,
    query: &str,
    process_names: &HashMap<u32, String>,
) -> Vec<PortOccupancyEntry> {
    let normalized_query = query.trim().to_lowercase();
    let query_pid = normalized_query.parse::<u32>().ok();
    parse_netstat_tcp_entries(output)
        .into_iter()
        .filter_map(|mut entry| {
            let process_name = process_names.get(&entry.pid).cloned();
            let pid_matches = query_pid == Some(entry.pid);
            let name_matches = process_name
                .as_deref()
                .map(|name| name.to_lowercase().contains(&normalized_query))
                .unwrap_or(false);
            if pid_matches || name_matches {
                entry.process_name = process_name;
                Some(entry)
            } else {
                None
            }
        })
        .collect()
}

fn address_has_port(address: &str, port: u16) -> bool {
    address
        .rsplit_once(':')
        .and_then(|(_, value)| value.parse::<u16>().ok())
        == Some(port)
}

fn lookup_process_names(pids: Vec<u32>) -> HashMap<u32, String> {
    let mut names = HashMap::new();
    for pid in pids {
        if names.contains_key(&pid) {
            continue;
        }
        if let Some(name) = lookup_process_name(pid) {
            names.insert(pid, name);
        }
    }
    names
}

fn lookup_process_name(pid: u32) -> Option<String> {
    let filter = format!("PID eq {pid}");
    let output = background_command("tasklist")
        .args(["/FI", &filter, "/FO", "CSV", "/NH"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = decode_output(&output.stdout, &output.stderr);
    parse_tasklist_process_name(&raw)
}

fn parse_tasklist_process_name(output: &str) -> Option<String> {
    output
        .lines()
        .find_map(|line| parse_csv_first_field(line).filter(|value| !value.eq("INFO:")))
}

fn parse_csv_first_field(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(rest) = trimmed.strip_prefix('"') {
        return rest.split('"').next().map(str::to_string);
    }
    trimmed.split(',').next().map(str::to_string)
}

fn background_command(program: &str) -> Command {
    #[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
    let mut command = Command::new(program);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[tokio::test]
    async fn check_port_reports_open_local_listener() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let result = check_port(PortCheckRequest {
            host: "127.0.0.1".to_string(),
            port,
        })
        .await
        .unwrap();

        assert!(result.open);
        assert_eq!(result.host, "127.0.0.1");
        assert_eq!(result.port, port);
    }

    #[tokio::test]
    async fn check_port_rejects_empty_host() {
        let err = check_port(PortCheckRequest {
            host: " ".to_string(),
            port: 80,
        })
        .await
        .unwrap_err();

        assert!(err.to_string().contains("请输入 Host"));
    }

    #[test]
    fn parse_netstat_finds_listening_port_occupants() {
        let output = r#"
  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:1420           0.0.0.0:0              LISTENING       1234
  TCP    [::]:1420              [::]:0                 LISTENING       5678
  TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       9999
"#;

        let entries = parse_netstat_listening_ports(output, 1420);

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].local_address, "0.0.0.0:1420");
        assert_eq!(entries[0].pid, 1234);
        assert_eq!(entries[1].local_address, "[::]:1420");
        assert_eq!(entries[1].pid, 5678);
    }

    #[test]
    fn parse_netstat_finds_ports_by_process_query() {
        let output = r#"
  Proto  Local Address          Foreign Address        State           PID
  TCP    127.0.0.1:8085         0.0.0.0:0              LISTENING       9184
  TCP    127.0.0.1:2222         192.168.3.196:22       ESTABLISHED     9184
  TCP    127.0.0.1:1420         0.0.0.0:0              LISTENING       1234
"#;
        let mut names = HashMap::new();
        names.insert(9184, "ssh.exe".to_string());
        names.insert(1234, "node.exe".to_string());

        let entries = parse_netstat_ports_by_process_query(output, "ssh", &names);

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].local_address, "127.0.0.1:8085");
        assert_eq!(entries[0].state, "LISTENING");
        assert_eq!(entries[0].pid, 9184);
        assert_eq!(entries[0].process_name, Some("ssh.exe".to_string()));
        assert_eq!(entries[1].local_address, "127.0.0.1:2222");
        assert_eq!(entries[1].state, "ESTABLISHED");

        let by_pid = parse_netstat_ports_by_process_query(output, "1234", &names);
        assert_eq!(by_pid.len(), 1);
        assert_eq!(by_pid[0].process_name, Some("node.exe".to_string()));
    }

    #[test]
    fn parse_tasklist_reads_process_name_from_csv() {
        let output = "\"node.exe\",\"1234\",\"Console\",\"1\",\"50,000 K\"";

        assert_eq!(
            parse_tasklist_process_name(output),
            Some("node.exe".to_string())
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_background_commands_use_no_window_flag() {
        assert_eq!(background_process_creation_flags(), 0x08000000);
    }
}
