use crate::error::{BackendError, BackendResult};
use crate::models::{
    PingRequest, PingResult, PortCheckRequest, PortCheckResult, PortOccupancyEntry,
    PortOccupancyRequest, PortOccupancyResult,
};
use std::collections::HashMap;
use std::net::{TcpStream, ToSocketAddrs};
use std::process::Command;
use std::time::{Duration, Instant};

pub async fn ping_host(input: PingRequest) -> BackendResult<PingResult> {
    let host = input.host.trim();
    if host.is_empty() {
        return Err(BackendError::NetworkDiagnostic(
            "请输入要 Ping 的 IP 或域名。".to_string(),
        ));
    }

    let output = Command::new("ping")
        .args(ping_args(host))
        .output()
        .map_err(|err| BackendError::NetworkDiagnostic(err.to_string()))?;
    let raw_output = decode_output(&output.stdout, &output.stderr);
    let reachable = output.status.success();
    let summary = if reachable {
        format!("{host} 可达")
    } else {
        format!("{host} 不可达")
    };

    Ok(PingResult {
        host: host.to_string(),
        reachable,
        summary,
        raw_output,
    })
}

pub async fn check_port(input: PortCheckRequest) -> BackendResult<PortCheckResult> {
    let host = input.host.trim();
    if host.is_empty() {
        return Err(BackendError::NetworkDiagnostic("请输入 Host。".to_string()));
    }

    let timeout = Duration::from_secs(3);
    let start = Instant::now();
    let mut addrs = (host, input.port)
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
        host: host.to_string(),
        port: input.port,
        open: result.is_ok(),
        elapsed_ms,
        error: result.err().map(|err| err.to_string()),
    })
}

pub async fn inspect_port_occupancy(
    input: PortOccupancyRequest,
) -> BackendResult<PortOccupancyResult> {
    let output = Command::new("netstat")
        .args(["-ano", "-p", "tcp"])
        .output()
        .map_err(|err| BackendError::NetworkDiagnostic(err.to_string()))?;
    let raw_output = decode_output(&output.stdout, &output.stderr);
    let mut entries = parse_netstat_listening_ports(&raw_output, input.port);
    let process_names = lookup_process_names(entries.iter().map(|entry| entry.pid).collect());
    for entry in &mut entries {
        entry.process_name = process_names.get(&entry.pid).cloned();
    }

    Ok(PortOccupancyResult {
        port: input.port,
        entries,
    })
}

#[cfg(target_os = "windows")]
fn ping_args(host: &str) -> [&str; 3] {
    ["-n", "4", host]
}

#[cfg(not(target_os = "windows"))]
fn ping_args(host: &str) -> [&str; 3] {
    ["-c", "4", host]
}

fn decode_output(stdout: &[u8], stderr: &[u8]) -> String {
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

fn parse_netstat_listening_ports(output: &str, port: u16) -> Vec<PortOccupancyEntry> {
    output
        .lines()
        .filter_map(|line| parse_netstat_line(line, port))
        .collect()
}

fn parse_netstat_line(line: &str, port: u16) -> Option<PortOccupancyEntry> {
    let parts = line.split_whitespace().collect::<Vec<_>>();
    if parts.len() < 5 || !parts[0].eq_ignore_ascii_case("TCP") {
        return None;
    }
    let state = parts[3];
    if !state.eq_ignore_ascii_case("LISTENING") {
        return None;
    }
    if !address_has_port(parts[1], port) {
        return None;
    }
    let pid = parts[4].parse::<u32>().ok()?;
    Some(PortOccupancyEntry {
        protocol: parts[0].to_string(),
        local_address: parts[1].to_string(),
        state: state.to_string(),
        pid,
        process_name: None,
    })
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
    let output = Command::new("tasklist")
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

    #[tokio::test]
    async fn ping_rejects_empty_host() {
        let err = ping_host(PingRequest {
            host: " ".to_string(),
        })
        .await
        .unwrap_err();

        assert!(err.to_string().contains("请输入要 Ping"));
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
    fn parse_tasklist_reads_process_name_from_csv() {
        let output = "\"node.exe\",\"1234\",\"Console\",\"1\",\"50,000 K\"";

        assert_eq!(
            parse_tasklist_process_name(output),
            Some("node.exe".to_string())
        );
    }
}
