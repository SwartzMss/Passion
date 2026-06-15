use crate::error::{BackendError, BackendResult};
use crate::models::{
    PingReply, PingRequest, PingResult, PortCheckRequest, PortCheckResult, PortOccupancyEntry,
    PortOccupancyRequest, PortOccupancyResult,
};
#[cfg(target_os = "windows")]
use encoding_rs::GBK;
use std::collections::HashMap;
use std::net::{TcpStream, ToSocketAddrs};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::time::{Duration, Instant};

pub async fn ping_host(input: PingRequest) -> BackendResult<PingResult> {
    let host = input.host.trim().to_string();
    if host.is_empty() {
        return Err(BackendError::NetworkDiagnostic(
            "请输入要 Ping 的 IP 或域名。".to_string(),
        ));
    }

    tauri::async_runtime::spawn_blocking(move || {
        let output = background_command("ping")
            .args(ping_args(&host))
            .output()
            .map_err(|err| BackendError::NetworkDiagnostic(err.to_string()))?;
        let raw_output = decode_output(&output.stdout, &output.stderr);
        let reachable = output.status.success();
        let metrics = parse_ping_output(&raw_output);

        Ok(PingResult {
            host,
            reachable,
            packets_transmitted: metrics.packets_transmitted,
            packets_received: metrics.packets_received,
            loss_percent: metrics.loss_percent,
            min_time_ms: metrics.min_time_ms,
            max_time_ms: metrics.max_time_ms,
            avg_time_ms: metrics.avg_time_ms,
            ttl: metrics.ttl,
            replies: metrics.replies,
        })
    })
    .await
    .map_err(|err| BackendError::NetworkDiagnostic(err.to_string()))?
}

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

#[cfg(target_os = "windows")]
fn ping_args(host: &str) -> [&str; 3] {
    ["-n", "4", host]
}

#[cfg(not(target_os = "windows"))]
fn ping_args(host: &str) -> [&str; 3] {
    ["-c", "4", host]
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

#[derive(Debug, Default)]
struct PingMetrics {
    packets_transmitted: Option<u32>,
    packets_received: Option<u32>,
    loss_percent: Option<f32>,
    min_time_ms: Option<f32>,
    max_time_ms: Option<f32>,
    avg_time_ms: Option<f32>,
    ttl: Option<u32>,
    replies: Vec<PingReply>,
}

fn parse_ping_output(output: &str) -> PingMetrics {
    let mut metrics = PingMetrics::default();
    for line in output.lines() {
        let lower = line.to_lowercase();
        if lower.contains("ttl=") || line.contains("TTL=") {
            let reply = PingReply {
                bytes: find_number_after_any(line, &["bytes=", "字节="]).map(|value| value as u32),
                time_ms: find_number_after_any(line, &["time", "时间"]),
                ttl: find_number_after_any(line, &["ttl=", "TTL="]).map(|value| value as u32),
            };
            if metrics.ttl.is_none() {
                metrics.ttl = reply.ttl;
            }
            metrics.replies.push(reply);
        }

        if lower.contains("sent") || line.contains("已发送") {
            metrics.packets_transmitted =
                find_number_after_any(line, &["Sent =", "sent =", "已发送 ="])
                    .map(|value| value as u32);
            metrics.packets_received =
                find_number_after_any(line, &["Received =", "received =", "已接收 ="])
                    .map(|value| value as u32);
            metrics.loss_percent = find_loss_percent(line);
        }

        if lower.contains("minimum") || line.contains("最短") || line.contains("最小") {
            metrics.min_time_ms =
                find_number_after_any(line, &["Minimum =", "minimum =", "最短 =", "最小 ="]);
            metrics.max_time_ms =
                find_number_after_any(line, &["Maximum =", "maximum =", "最长 =", "最大 ="]);
            metrics.avg_time_ms =
                find_number_after_any(line, &["Average =", "average =", "平均 ="]);
        }
    }

    if metrics.avg_time_ms.is_none() && !metrics.replies.is_empty() {
        let times = metrics
            .replies
            .iter()
            .filter_map(|reply| reply.time_ms)
            .collect::<Vec<_>>();
        if !times.is_empty() {
            metrics.min_time_ms = Some(times.iter().copied().fold(f32::INFINITY, f32::min));
            metrics.max_time_ms = Some(times.iter().copied().fold(f32::NEG_INFINITY, f32::max));
            metrics.avg_time_ms = Some(times.iter().sum::<f32>() / times.len() as f32);
        }
    }

    metrics
}

fn find_loss_percent(line: &str) -> Option<f32> {
    let percent_index = line.find('%')?;
    let before = &line[..percent_index];
    parse_last_number(before)
}

fn find_number_after_any(line: &str, keys: &[&str]) -> Option<f32> {
    keys.iter().find_map(|key| {
        line.find(key)
            .and_then(|index| parse_first_number(&line[index + key.len()..]))
    })
}

fn parse_first_number(value: &str) -> Option<f32> {
    let start = value.find(|ch: char| ch.is_ascii_digit())?;
    let rest = &value[start..];
    let end = rest
        .find(|ch: char| !(ch.is_ascii_digit() || ch == '.'))
        .unwrap_or(rest.len());
    rest[..end].parse::<f32>().ok()
}

fn parse_last_number(value: &str) -> Option<f32> {
    let mut current = String::new();
    let mut last = None;
    for ch in value.chars() {
        if ch.is_ascii_digit() || ch == '.' {
            current.push(ch);
        } else if !current.is_empty() {
            last = current.parse::<f32>().ok();
            current.clear();
        }
    }
    if !current.is_empty() {
        last = current.parse::<f32>().ok();
    }
    last
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
    fn parse_ping_output_reads_windows_chinese_metrics() {
        let output = r#"
正在 Ping 192.0.2.142 具有 32 字节的数据:
来自 192.0.2.142 的回复: 字节=32 时间=57ms TTL=64
来自 192.0.2.142 的回复: 字节=32 时间=129ms TTL=64
来自 192.0.2.142 的回复: 字节=32 时间=3ms TTL=64
来自 192.0.2.142 的回复: 字节=32 时间=2ms TTL=64

192.0.2.142 的 Ping 统计信息:
    数据包: 已发送 = 4，已接收 = 4，丢失 = 0 (0% 丢失)，
往返行程的估计时间(以毫秒为单位):
    最短 = 2ms，最长 = 129ms，平均 = 47ms
"#;

        let metrics = parse_ping_output(output);

        assert_eq!(metrics.packets_transmitted, Some(4));
        assert_eq!(metrics.packets_received, Some(4));
        assert_eq!(metrics.loss_percent, Some(0.0));
        assert_eq!(metrics.min_time_ms, Some(2.0));
        assert_eq!(metrics.max_time_ms, Some(129.0));
        assert_eq!(metrics.avg_time_ms, Some(47.0));
        assert_eq!(metrics.ttl, Some(64));
        assert_eq!(metrics.replies.len(), 4);
        assert_eq!(metrics.replies[0].time_ms, Some(57.0));
        assert_eq!(metrics.replies[0].bytes, Some(32));
    }

    #[test]
    fn parse_ping_output_reads_windows_english_metrics() {
        let output = r#"
Pinging 127.0.0.1 with 32 bytes of data:
Reply from 127.0.0.1: bytes=32 time<1ms TTL=128
Reply from 127.0.0.1: bytes=32 time=2ms TTL=128

Ping statistics for 127.0.0.1:
    Packets: Sent = 2, Received = 2, Lost = 0 (0% loss),
Approximate round trip times in milli-seconds:
    Minimum = 0ms, Maximum = 2ms, Average = 1ms
"#;

        let metrics = parse_ping_output(output);

        assert_eq!(metrics.packets_transmitted, Some(2));
        assert_eq!(metrics.packets_received, Some(2));
        assert_eq!(metrics.loss_percent, Some(0.0));
        assert_eq!(metrics.min_time_ms, Some(0.0));
        assert_eq!(metrics.max_time_ms, Some(2.0));
        assert_eq!(metrics.avg_time_ms, Some(1.0));
        assert_eq!(metrics.ttl, Some(128));
        assert_eq!(metrics.replies.len(), 2);
        assert_eq!(metrics.replies[0].time_ms, Some(1.0));
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

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_background_commands_use_no_window_flag() {
        assert_eq!(background_process_creation_flags(), 0x08000000);
    }
}
