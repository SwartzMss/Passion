use crate::error::{BackendError, BackendResult};
use crate::models::{PortCheckResult, PortScanProgress, PortScanRequest};
use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::net::{lookup_host, TcpStream};
use tokio::sync::{mpsc, watch, Mutex, Semaphore};
use uuid::Uuid;

const MAX_SCAN_CONCURRENCY: usize = 64;
const MAX_COMPLETED_SCAN_IDS: usize = 16;
const PORT_CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ScanSummary {
    pub completed: u32,
    pub total: u32,
    pub open_ports: Vec<PortCheckResult>,
    pub stopped: bool,
}

#[derive(Debug, Clone)]
struct ScanUpdate {
    completed: u32,
    total: u32,
    result: Option<PortCheckResult>,
}

pub(crate) trait PortProbe: Clone + Send + Sync + 'static {
    fn probe(
        &self,
        host: String,
        port: u16,
    ) -> Pin<Box<dyn Future<Output = PortCheckResult> + Send>>;
}

#[derive(Clone, Copy)]
struct TcpPortProbe;

impl PortProbe for TcpPortProbe {
    fn probe(
        &self,
        host: String,
        port: u16,
    ) -> Pin<Box<dyn Future<Output = PortCheckResult> + Send>> {
        Box::pin(async move {
            let started = Instant::now();
            let result = match tokio::time::timeout(
                PORT_CONNECT_TIMEOUT,
                TcpStream::connect((host.as_str(), port)),
            )
            .await
            {
                Ok(Ok(_)) => Ok(()),
                Ok(Err(err)) => Err(err.to_string()),
                Err(_) => Err("连接超时".to_string()),
            };
            PortCheckResult {
                host,
                port,
                open: result.is_ok(),
                elapsed_ms: started.elapsed().as_millis(),
                error: result.err(),
            }
        })
    }
}

pub(crate) fn validate_request(request: &PortScanRequest) -> BackendResult<()> {
    if request.host.trim().is_empty() {
        return Err(BackendError::NetworkDiagnostic("请输入 Host。".to_string()));
    }
    if request.start_port == 0 || request.end_port == 0 || request.start_port > request.end_port {
        return Err(BackendError::NetworkDiagnostic(
            "端口范围必须在 1-65535 且起始端口不能大于结束端口。".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
pub(crate) async fn scan_ports_with_probe<P>(
    request: PortScanRequest,
    probe: P,
    cancel_rx: watch::Receiver<bool>,
) -> BackendResult<ScanSummary>
where
    P: PortProbe + Clone + Send + Sync + 'static,
{
    scan_ports_with_probe_and_updates(request, probe, cancel_rx, None).await
}

async fn scan_ports_with_probe_and_updates<P>(
    request: PortScanRequest,
    probe: P,
    cancel_rx: watch::Receiver<bool>,
    updates: Option<mpsc::Sender<ScanUpdate>>,
) -> BackendResult<ScanSummary>
where
    P: PortProbe + Clone + Send + Sync + 'static,
{
    validate_request(&request)?;
    let host = request.host.trim().to_string();
    let has_address = lookup_host((host.as_str(), request.start_port))
        .await
        .map_err(|err| BackendError::NetworkDiagnostic(format!("无法解析 Host：{err}")))?
        .next()
        .is_some();
    if !has_address {
        return Err(BackendError::NetworkDiagnostic(
            "无法解析 Host。".to_string(),
        ));
    }
    let total = u32::from(request.end_port - request.start_port) + 1;
    let next_port = Arc::new(AtomicU32::new(0));
    let completed = Arc::new(AtomicU32::new(0));
    let open_ports = Arc::new(Mutex::new(Vec::new()));
    let semaphore = Arc::new(Semaphore::new(MAX_SCAN_CONCURRENCY));
    let worker_count = (total as usize).min(MAX_SCAN_CONCURRENCY);
    let mut workers = Vec::with_capacity(worker_count);

    for _ in 0..worker_count {
        let host = host.clone();
        let probe = probe.clone();
        let next_port = Arc::clone(&next_port);
        let completed = Arc::clone(&completed);
        let open_ports = Arc::clone(&open_ports);
        let semaphore = Arc::clone(&semaphore);
        let updates = updates.clone();
        let mut worker_cancel = cancel_rx.clone();
        workers.push(tokio::spawn(async move {
            loop {
                if *worker_cancel.borrow() {
                    break;
                }
                let offset = next_port.fetch_add(1, Ordering::Relaxed);
                if offset >= total {
                    break;
                }
                let permit = tokio::select! {
                    _ = worker_cancel.changed() => {
                        if *worker_cancel.borrow() { break; }
                        continue;
                    }
                    permit = semaphore.clone().acquire_owned() => permit.expect("scan semaphore closed"),
                };
                let port = request.start_port + offset as u16;
                let result = tokio::select! {
                    _ = worker_cancel.changed() => {
                        if *worker_cancel.borrow() { drop(permit); break; }
                        continue;
                    }
                    result = probe.probe(host.clone(), port) => result,
                };
                drop(permit);
                completed.fetch_add(1, Ordering::Relaxed);
                if let Some(updates) = &updates {
                    let _ = updates
                        .send(ScanUpdate {
                        completed: completed.load(Ordering::Relaxed),
                        total,
                        result: result.open.then_some(result.clone()),
                        })
                        .await;
                }
                if result.open {
                    open_ports.lock().await.push(result);
                }
            }
        }));
    }

    for worker in workers {
        worker
            .await
            .map_err(|err| BackendError::NetworkDiagnostic(err.to_string()))?;
    }

    let stopped = *cancel_rx.borrow();
    Ok(ScanSummary {
        completed: completed.load(Ordering::Relaxed),
        total,
        open_ports: Arc::try_unwrap(open_ports)
            .map_err(|_| BackendError::NetworkDiagnostic("扫描结果回收失败。".to_string()))?
            .into_inner(),
        stopped,
    })
}

#[derive(Clone, Default)]
pub(crate) struct PortScanManager {
    active_scans: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
    completed_scans: Arc<Mutex<VecDeque<String>>>,
}

impl PortScanManager {
    pub async fn start(&self, app: AppHandle, request: PortScanRequest) -> BackendResult<String> {
        validate_request(&request)?;
        let scan_id = Uuid::new_v4().to_string();
        let (cancel_tx, cancel_rx) = watch::channel(false);
        {
            let mut active_scans = self.active_scans.lock().await;
            for sender in active_scans.values() {
                let _ = sender.send(true);
            }
            active_scans.clear();
            active_scans.insert(scan_id.clone(), cancel_tx);
        }

        let manager = self.clone();
        let scan_id_for_task = scan_id.clone();
        tokio::spawn(async move {
            let (updates, mut update_rx) = mpsc::channel(64);
            let scan = tokio::spawn(scan_ports_with_probe_and_updates(
                request,
                TcpPortProbe,
                cancel_rx,
                Some(updates),
            ));
            while let Some(update) = update_rx.recv().await {
                let progress = PortScanProgress {
                    scan_id: scan_id_for_task.clone(),
                    completed: update.completed,
                    total: update.total,
                    result: update.result,
                    done: false,
                    stopped: false,
                    error: None,
                };
                let _ = app.emit("port-scan-progress", progress);
            }
            let result = scan.await;
            match result {
                Ok(Ok(summary)) => {
                    let _ = app.emit(
                        "port-scan-progress",
                        PortScanProgress {
                            scan_id: scan_id_for_task.clone(),
                            completed: summary.completed,
                            total: summary.total,
                            result: None,
                            done: true,
                            stopped: summary.stopped,
                            error: None,
                        },
                    );
                }
                Ok(Err(err)) => {
                    let _ = app.emit(
                        "port-scan-progress",
                        PortScanProgress {
                            scan_id: scan_id_for_task.clone(),
                            completed: 0,
                            total: 0,
                            result: None,
                            done: true,
                            stopped: false,
                            error: Some(err.to_string()),
                        },
                    );
                }
                Err(err) => {
                    let _ = app.emit(
                        "port-scan-progress",
                        PortScanProgress {
                            scan_id: scan_id_for_task.clone(),
                            completed: 0,
                            total: 0,
                            result: None,
                            done: true,
                            stopped: false,
                            error: Some(err.to_string()),
                        },
                    );
                }
            }
            manager.finish(&scan_id_for_task).await;
        });

        Ok(scan_id)
    }

    pub async fn stop(&self, scan_id: &str) -> BackendResult<()> {
        let sender = self.active_scans.lock().await.get(scan_id).cloned();
        match sender {
            Some(sender) => {
                let _ = sender.send(true);
                Ok(())
            }
            None if self
                .completed_scans
                .lock()
                .await
                .iter()
                .any(|completed_id| completed_id == scan_id) =>
            {
                Ok(())
            }
            None => Err(BackendError::NetworkDiagnostic(
                "端口扫描任务不存在或已结束。".to_string(),
            )),
        }
    }

    async fn finish(&self, scan_id: &str) {
        let mut active_scans = self.active_scans.lock().await;
        active_scans.remove(scan_id);
        drop(active_scans);

        let mut completed_scans = self.completed_scans.lock().await;
        completed_scans.push_back(scan_id.to_string());
        while completed_scans.len() > MAX_COMPLETED_SCAN_IDS {
            completed_scans.pop_front();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{PortCheckResult, PortScanRequest};
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use std::time::Duration;
    use tokio::sync::{watch, Notify};

    #[derive(Clone)]
    struct TrackingProbe {
        in_flight: Arc<AtomicUsize>,
        max_in_flight: Arc<AtomicUsize>,
    }

    impl TrackingProbe {
        fn new() -> Self {
            Self {
                in_flight: Arc::new(AtomicUsize::new(0)),
                max_in_flight: Arc::new(AtomicUsize::new(0)),
            }
        }

        fn max_in_flight(&self) -> usize {
            self.max_in_flight.load(Ordering::SeqCst)
        }
    }

    impl PortProbe for TrackingProbe {
        fn probe(
            &self,
            host: String,
            port: u16,
        ) -> Pin<Box<dyn Future<Output = PortCheckResult> + Send>> {
            let in_flight = Arc::clone(&self.in_flight);
            let max_in_flight = Arc::clone(&self.max_in_flight);
            Box::pin(async move {
                let current = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
                max_in_flight.fetch_max(current, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(1)).await;
                in_flight.fetch_sub(1, Ordering::SeqCst);
                PortCheckResult {
                    host,
                    port,
                    open: false,
                    elapsed_ms: 1,
                    error: Some("closed".to_string()),
                }
            })
        }
    }

    #[derive(Clone)]
    struct BlockingProbe {
        started: Arc<Notify>,
    }

    impl BlockingProbe {
        fn new() -> Self {
            Self {
                started: Arc::new(Notify::new()),
            }
        }

        async fn started(&self) {
            self.started.notified().await;
        }
    }

    impl PortProbe for BlockingProbe {
        fn probe(
            &self,
            _host: String,
            _port: u16,
        ) -> Pin<Box<dyn Future<Output = PortCheckResult> + Send>> {
            let started = Arc::clone(&self.started);
            Box::pin(async move {
                started.notify_one();
                std::future::pending::<PortCheckResult>().await
            })
        }
    }

    fn request(start_port: u16, end_port: u16) -> PortScanRequest {
        PortScanRequest {
            host: "127.0.0.1".to_string(),
            start_port,
            end_port,
        }
    }

    fn never_cancel() -> (watch::Sender<bool>, watch::Receiver<bool>) {
        watch::channel(false)
    }

    #[tokio::test]
    async fn scan_rejects_invalid_ranges() {
        let err = validate_request(&PortScanRequest {
            host: "127.0.0.1".into(),
            start_port: 0,
            end_port: 80,
        })
        .unwrap_err();
        assert!(err.to_string().contains("端口范围"));
    }

    #[tokio::test]
    async fn scan_limits_probe_concurrency_to_sixty_four() {
        let probe = TrackingProbe::new();
        let (_cancel, cancel_rx) = never_cancel();
        scan_ports_with_probe(request(1, 256), probe.clone(), cancel_rx)
            .await
            .unwrap();
        assert!(probe.max_in_flight() <= 64);
    }

    #[tokio::test]
    async fn scan_finds_an_open_local_listener() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (_cancel, cancel_rx) = never_cancel();

        let summary = scan_ports_with_probe(request(port, port), TcpPortProbe, cancel_rx)
            .await
            .unwrap();

        assert_eq!(summary.open_ports.len(), 1);
        assert_eq!(summary.open_ports[0].port, port);
    }

    #[tokio::test]
    async fn scan_rejects_an_unresolvable_host() {
        let mut request = request(80, 80);
        request.host = "host-that-does-not-exist.invalid".to_string();
        let (_cancel, cancel_rx) = never_cancel();

        let err = scan_ports_with_probe(request, TcpPortProbe, cancel_rx)
            .await
            .unwrap_err();

        assert!(err.to_string().contains("无法解析 Host"));
    }

    #[tokio::test]
    async fn stop_is_idempotent_after_scan_finished() {
        let manager = PortScanManager::default();
        manager.finish("scan-1").await;

        manager.stop("scan-1").await.unwrap();
    }

    #[tokio::test]
    async fn scan_stops_when_cancellation_is_requested() {
        let probe = BlockingProbe::new();
        let (cancel, cancel_rx) = watch::channel(false);
        let task = tokio::spawn(scan_ports_with_probe(
            request(1, 65535),
            probe.clone(),
            cancel_rx,
        ));
        probe.started().await;
        cancel.send(true).unwrap();
        let progress = task.await.unwrap().unwrap();
        assert!(progress.stopped);
        assert!(progress.completed < progress.total);
    }
}
