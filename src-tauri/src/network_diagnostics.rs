use crate::error::{BackendError, BackendResult};
use crate::models::{PingRequest, PingResult, PortCheckRequest, PortCheckResult};
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
}
