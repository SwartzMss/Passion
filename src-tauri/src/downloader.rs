use crate::error::{BackendError, BackendResult};
use crate::models::{DownloadProgressEvent, DownloadRequest, DownloadResult};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::future::Future;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::fs as async_fs;
use tokio::io::AsyncWriteExt;

const COPY_BUFFER_SIZE: usize = 64 * 1024;
const DOWNLOAD_PROGRESS_EVENT: &str = "download_progress";
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_secs(5);

static PAUSED_DOWNLOADS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static CANCELED_DOWNLOADS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static ACTIVE_DOWNLOADS: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();
const READ_TIMEOUT: Duration = Duration::from_secs(30);

fn download_error(error: impl std::fmt::Display) -> BackendError {
    BackendError::Download(error.to_string())
}

fn active_downloads() -> &'static Mutex<HashMap<String, PathBuf>> {
    ACTIVE_DOWNLOADS.get_or_init(|| Mutex::new(HashMap::new()))
}

struct TransferGuard(String);

impl TransferGuard {
    fn acquire(task_id: &str, path: &Path) -> BackendResult<Self> {
        let parent = path
            .parent()
            .ok_or_else(|| download_error("无效保存路径。"))?;
        let path = parent
            .canonicalize()
            .map_err(download_error)?
            .join(path.file_name().unwrap());
        #[cfg(windows)]
        let path = PathBuf::from(path.to_string_lossy().to_lowercase());
        let mut active = active_downloads().lock().map_err(download_error)?;
        if active.contains_key(task_id) || active.values().any(|target| target == &path) {
            return Err(download_error(
                "此任务或目标文件正在下载，请等待当前操作结束。",
            ));
        }
        clear_pause_request(task_id);
        clear_cancel_request(task_id);
        active.insert(task_id.to_string(), path);
        Ok(Self(task_id.to_string()))
    }
}

impl Drop for TransferGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = active_downloads().lock() {
            clear_pause_request(&self.0);
            clear_cancel_request(&self.0);
            active.remove(&self.0);
        }
    }
}

fn check_control(task_id: &str) -> BackendResult<()> {
    if is_cancel_requested(task_id)? {
        return Err(download_error("下载已取消。"));
    }
    if is_pause_requested(task_id)? {
        return Err(download_error("下载已暂停。"));
    }
    Ok(())
}

async fn interruptible<T>(
    task_id: &str,
    operation: impl Future<Output = Result<T, reqwest::Error>>,
) -> BackendResult<T> {
    let stop = async {
        loop {
            check_control(task_id)?;
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        #[allow(unreachable_code)]
        Ok::<(), BackendError>(())
    };
    tokio::select! {
        biased;
        result = stop => { result?; Err(download_error("下载已停止。")) },
        result = tokio::time::timeout(READ_TIMEOUT, operation) => {
            result.map_err(|_| download_error("下载读取超时，请稍后重试。"))?.map_err(download_error)
        }
    }
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct ResumeMetadata {
    source: String,
    validator: Option<String>,
    total: Option<u64>,
}

fn metadata_path(part: &Path) -> PathBuf {
    let mut path = part.as_os_str().to_os_string();
    path.push(".json");
    PathBuf::from(path)
}

fn read_resume(part: &Path) -> Option<ResumeMetadata> {
    let path = metadata_path(part);
    if path.metadata().ok()?.len() > 64 * 1024 {
        return None;
    }
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

fn write_resume(part: &Path, metadata: &ResumeMetadata) -> BackendResult<()> {
    fs::write(
        metadata_path(part),
        serde_json::to_vec(metadata).map_err(download_error)?,
    )
    .map_err(download_error)
}

fn local_metadata(source: &Path) -> BackendResult<ResumeMetadata> {
    let meta = source.metadata().map_err(download_error)?;
    Ok(ResumeMetadata {
        source: source
            .canonicalize()
            .map_err(download_error)?
            .to_string_lossy()
            .into_owned(),
        validator: Some(format!("{:?}", meta.modified().map_err(download_error)?)),
        total: Some(meta.len()),
    })
}

fn response_validator(response: &reqwest::Response) -> Option<String> {
    response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.starts_with("W/"))
        .or_else(|| {
            response
                .headers()
                .get(reqwest::header::LAST_MODIFIED)
                .and_then(|value| value.to_str().ok())
        })
        .map(str::to_string)
}

fn range_total(value: &str, expected_start: u64) -> BackendResult<u64> {
    let parsed = (|| {
        let (range, total) = value.strip_prefix("bytes ")?.split_once('/')?;
        let (start, end) = range.split_once('-')?;
        Some((
            start.parse::<u64>().ok()?,
            end.parse::<u64>().ok()?,
            total.parse::<u64>().ok()?,
        ))
    })();
    match parsed {
        Some((start, end, total))
            if start == expected_start && end >= start && end.checked_add(1) == Some(total) =>
        {
            Ok(total)
        }
        _ => Err(download_error("续传响应范围不匹配，已保留临时文件。")),
    }
}

pub async fn download_file(
    app: &AppHandle,
    input: DownloadRequest,
) -> BackendResult<DownloadResult> {
    let task_id = input
        .task_id
        .as_deref()
        .unwrap_or("download-task")
        .to_string();
    let source = input.url.trim();
    if source.is_empty() {
        return Err(BackendError::Download(
            "请输入下载地址或本地文件路径。".to_string(),
        ));
    }

    let save_dir = resolve_save_dir(app, input.save_dir.as_deref())?;
    let result = if is_http_source(source) {
        let file_name = infer_http_file_name(source, input.file_name.as_deref())?;
        download_http_to_dir(source, &file_name, &save_dir, &task_id, |event| {
            crate::download_tasks::publish_progress(app, event);
        })
        .await
    } else {
        let file_name = infer_local_file_name(source, input.file_name.as_deref())?;
        let task_id_for_copy = task_id.clone();
        let source_for_copy = source.to_string();
        let save_dir_for_copy = save_dir.clone();
        let app_for_copy = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            copy_local_file_to_dir_with_progress(
                &task_id_for_copy,
                &source_for_copy,
                &file_name,
                &save_dir_for_copy,
                COPY_BUFFER_SIZE,
                |event| {
                    crate::download_tasks::publish_progress(&app_for_copy, event);
                },
            )
        })
        .await
        .map_err(|err| BackendError::Download(err.to_string()))?
    };

    if let Err(err) = &result {
        if is_pause_error(err) {
            return result;
        }
        if is_cancel_error(err) {
            clear_cancel_request(&task_id);
        }
        let _ = app.emit(
            DOWNLOAD_PROGRESS_EVENT,
            DownloadProgressEvent {
                task_id,
                url: source.to_string(),
                file_name: String::new(),
                saved_path: String::new(),
                total_bytes: None,
                downloaded_bytes: 0,
                elapsed_ms: 0,
                bytes_per_second: 0.0,
                status: "failed".to_string(),
                error: Some(err.to_string()),
            },
        );
    }
    result
}

fn is_pause_error(err: &BackendError) -> bool {
    matches!(err, BackendError::Download(message) if message == "下载已暂停。")
}

fn is_cancel_error(err: &BackendError) -> bool {
    matches!(err, BackendError::Download(message) if message == "下载已取消。")
}

pub async fn pause_download(task_id: &str) -> BackendResult<()> {
    if task_id.trim().is_empty() {
        return Err(BackendError::Download("下载任务 ID 不能为空。".to_string()));
    }
    {
        let active = active_downloads().lock().map_err(download_error)?;
        if !active.contains_key(task_id) {
            return Ok(());
        }
        paused_downloads()
            .lock()
            .map_err(|err| BackendError::Download(err.to_string()))?
            .insert(task_id.to_string());
    }
    wait_for_stop(task_id).await?;
    Ok(())
}

pub async fn cancel_download(task_id: &str) -> BackendResult<()> {
    if task_id.trim().is_empty() {
        return Err(BackendError::Download("下载任务 ID 不能为空。".to_string()));
    }
    {
        let active = active_downloads().lock().map_err(download_error)?;
        if !active.contains_key(task_id) {
            return Ok(());
        }
        canceled_downloads()
            .lock()
            .map_err(|err| BackendError::Download(err.to_string()))?
            .insert(task_id.to_string());
    }
    wait_for_stop(task_id).await?;
    Ok(())
}

async fn wait_for_stop(task_id: &str) -> BackendResult<()> {
    tokio::time::timeout(READ_TIMEOUT, async {
        loop {
            if !active_downloads()
                .lock()
                .map_err(download_error)?
                .contains_key(task_id)
            {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .map_err(|_| download_error("等待下载停止超时。"))?
}

pub fn default_download_dir(app: &AppHandle) -> BackendResult<String> {
    app.path()
        .download_dir()
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|err| BackendError::Download(err.to_string()))
}

fn resolve_save_dir(app: &AppHandle, override_dir: Option<&str>) -> BackendResult<PathBuf> {
    let dir = match override_dir
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => PathBuf::from(value),
        None => app
            .path()
            .download_dir()
            .map_err(|err| BackendError::Download(err.to_string()))?,
    };
    if !dir.is_dir() {
        return Err(BackendError::Download(format!(
            "保存位置不是有效目录：{}",
            dir.display()
        )));
    }
    Ok(dir)
}

async fn download_http_to_dir(
    url: &str,
    file_name: &str,
    download_dir: &Path,
    task_id: &str,
    mut on_progress: impl FnMut(DownloadProgressEvent),
) -> BackendResult<DownloadResult> {
    let path = download_dir.join(file_name);
    let _guard = TransferGuard::acquire(task_id, &path)?;
    let part_path = part_file_path(&path);
    let start = Instant::now();
    let mut existing_bytes = file_len(&part_path)?;
    let previous = read_resume(&part_path);
    if !previous.as_ref().is_some_and(|meta| {
        meta.source == url
            && meta.validator.is_some()
            && meta.total.is_none_or(|total| existing_bytes <= total)
    }) {
        existing_bytes = 0;
    }
    let client = reqwest::Client::new();
    let mut request = client.get(url);
    if existing_bytes > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={existing_bytes}-"));
        request = request.header(
            reqwest::header::IF_RANGE,
            previous.as_ref().unwrap().validator.as_deref().unwrap(),
        );
    }
    let mut response = interruptible(
        task_id,
        request
            .header(reqwest::header::ACCEPT_ENCODING, "identity")
            .send(),
    )
    .await?;
    if !response.status().is_success() {
        return Err(BackendError::Download(format!(
            "下载服务返回状态码 {}。",
            response.status()
        )));
    }
    if existing_bytes > 0 && response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        existing_bytes = 0;
    }

    let validator = response_validator(&response);
    let total_bytes = if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
        let range = response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        let total = range_total(range, existing_bytes)?;
        if existing_bytes > 0
            && previous.as_ref().is_none_or(|meta| {
                meta.validator != validator || meta.total.is_some_and(|size| size != total)
            })
        {
            return Err(download_error("续传资源已变化，请重新下载。"));
        }
        Some(total)
    } else {
        response.content_length()
    };

    let mut file = if existing_bytes > 0 {
        async_fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&part_path)
            .await
            .map_err(|err| BackendError::Download(err.to_string()))?
    } else {
        async_fs::File::create(&part_path)
            .await
            .map_err(|err| BackendError::Download(err.to_string()))?
    };
    write_resume(
        &part_path,
        &ResumeMetadata {
            source: url.to_string(),
            validator,
            total: total_bytes,
        },
    )?;
    let mut bytes = existing_bytes;
    let mut progress = ProgressEmitter::new(&mut on_progress);
    progress.initial_bytes = existing_bytes;
    progress.emit(
        task_id,
        url,
        file_name,
        &path,
        total_bytes,
        bytes,
        start,
        "running",
        None,
        true,
    );
    while let Some(chunk) = interruptible(task_id, response.chunk()).await? {
        if is_cancel_requested(task_id)? {
            return Err(BackendError::Download("下载已取消。".to_string()));
        }
        file.write_all(&chunk)
            .await
            .map_err(|err| BackendError::Download(err.to_string()))?;
        bytes += chunk.len() as u64;
        if total_bytes.is_some_and(|total| bytes > total) {
            return Err(download_error("下载数据超出声明长度。"));
        }
        if is_cancel_requested(task_id)? {
            return Err(BackendError::Download("下载已取消。".to_string()));
        }
        if is_pause_requested(task_id)? {
            progress.emit(
                task_id,
                url,
                file_name,
                &path,
                total_bytes,
                bytes,
                start,
                "paused",
                None,
                true,
            );
            return Err(BackendError::Download("下载已暂停。".to_string()));
        }
        progress.emit(
            task_id,
            url,
            file_name,
            &path,
            total_bytes,
            bytes,
            start,
            "running",
            None,
            false,
        );
    }
    file.flush()
        .await
        .map_err(|err| BackendError::Download(err.to_string()))?;
    check_control(task_id)?;
    if total_bytes.is_some_and(|total| bytes != total) {
        return Err(download_error("下载长度不完整。"));
    }
    drop(file);
    finalize_part_file_async(&part_path, &path).await?;
    progress.emit(
        task_id,
        url,
        file_name,
        &path,
        total_bytes.or(Some(bytes)),
        bytes,
        start,
        "completed",
        None,
        true,
    );

    Ok(DownloadResult {
        url: url.to_string(),
        file_name: file_name.to_string(),
        saved_path: path.to_string_lossy().to_string(),
        bytes,
        elapsed_ms: start.elapsed().as_millis(),
    })
}

fn copy_local_file_to_dir_with_progress(
    task_id: &str,
    source: &str,
    file_name: &str,
    download_dir: &Path,
    buffer_size: usize,
    mut on_progress: impl FnMut(DownloadProgressEvent),
) -> BackendResult<DownloadResult> {
    let source_path = normalize_local_source(source);
    if !source_path.is_file() {
        return Err(BackendError::Download(format!(
            "本地文件不存在或不可读取：{}",
            source_path.display()
        )));
    }

    let path = download_dir.join(file_name);
    let _guard = TransferGuard::acquire(task_id, &path)?;
    let part_path = part_file_path(&path);
    let metadata = local_metadata(&source_path)?;
    let start = Instant::now();
    let total_bytes = source_path
        .metadata()
        .map_err(|err| BackendError::Download(err.to_string()))?
        .len();
    let mut source_file =
        File::open(&source_path).map_err(|err| BackendError::Download(err.to_string()))?;
    let part_bytes = file_len(&part_path)?;
    let mut bytes =
        if read_resume(&part_path).as_ref() == Some(&metadata) && part_bytes <= total_bytes {
            part_bytes
        } else {
            0
        };
    if bytes > 0 {
        source_file
            .seek(SeekFrom::Start(bytes))
            .map_err(|err| BackendError::Download(err.to_string()))?;
    }
    let mut target_file = if bytes > 0 {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&part_path)
            .map_err(|err| BackendError::Download(err.to_string()))?
    } else {
        File::create(&part_path).map_err(|err| BackendError::Download(err.to_string()))?
    };
    let mut buffer = vec![0_u8; buffer_size.max(1)];
    write_resume(&part_path, &metadata)?;
    let mut progress = ProgressEmitter::new(&mut on_progress);
    progress.initial_bytes = bytes;
    progress.emit(
        task_id,
        source,
        file_name,
        &path,
        Some(total_bytes),
        bytes,
        start,
        "running",
        None,
        true,
    );
    loop {
        if is_cancel_requested(task_id)? {
            return Err(BackendError::Download("下载已取消。".to_string()));
        }
        let read = source_file
            .read(&mut buffer)
            .map_err(|err| BackendError::Download(err.to_string()))?;
        if read == 0 {
            break;
        }
        target_file
            .write_all(&buffer[..read])
            .map_err(|err| BackendError::Download(err.to_string()))?;
        bytes += read as u64;
        if is_cancel_requested(task_id)? {
            return Err(BackendError::Download("下载已取消。".to_string()));
        }
        if is_pause_requested(task_id)? {
            progress.emit(
                task_id,
                source,
                file_name,
                &path,
                Some(total_bytes),
                bytes,
                start,
                "paused",
                None,
                true,
            );
            return Err(BackendError::Download("下载已暂停。".to_string()));
        }
        progress.emit(
            task_id,
            source,
            file_name,
            &path,
            Some(total_bytes),
            bytes,
            start,
            "running",
            None,
            false,
        );
    }
    check_control(task_id)?;
    if bytes != total_bytes || local_metadata(&source_path)? != metadata {
        return Err(download_error("源文件在复制期间发生变化。"));
    }
    target_file.flush().map_err(download_error)?;
    drop(target_file);
    drop(source_file);
    finalize_part_file(&part_path, &path)?;
    progress.emit(
        task_id,
        source,
        file_name,
        &path,
        Some(total_bytes),
        bytes,
        start,
        "completed",
        None,
        true,
    );
    Ok(DownloadResult {
        url: source.to_string(),
        file_name: file_name.to_string(),
        saved_path: path.to_string_lossy().to_string(),
        bytes,
        elapsed_ms: start.elapsed().as_millis(),
    })
}

struct ProgressEmitter<'a, F>
where
    F: FnMut(DownloadProgressEvent),
{
    on_progress: &'a mut F,
    last_emit: Option<Instant>,
    initial_bytes: u64,
}

impl<'a, F> ProgressEmitter<'a, F>
where
    F: FnMut(DownloadProgressEvent),
{
    fn new(on_progress: &'a mut F) -> Self {
        Self {
            on_progress,
            last_emit: None,
            initial_bytes: 0,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn emit(
        &mut self,
        task_id: &str,
        url: &str,
        file_name: &str,
        saved_path: &Path,
        total_bytes: Option<u64>,
        downloaded_bytes: u64,
        start: Instant,
        status: &str,
        error: Option<String>,
        force: bool,
    ) {
        let now = Instant::now();
        if !force
            && self
                .last_emit
                .is_some_and(|last| now.duration_since(last) < PROGRESS_EMIT_INTERVAL)
        {
            return;
        }
        self.last_emit = Some(now);
        let elapsed_ms = start.elapsed().as_millis();
        let elapsed_seconds = (elapsed_ms as f64 / 1000.0).max(0.001);
        (self.on_progress)(DownloadProgressEvent {
            task_id: task_id.to_string(),
            url: url.to_string(),
            file_name: file_name.to_string(),
            saved_path: saved_path.to_string_lossy().to_string(),
            total_bytes,
            downloaded_bytes,
            elapsed_ms,
            bytes_per_second: downloaded_bytes.saturating_sub(self.initial_bytes) as f64
                / elapsed_seconds,
            status: status.to_string(),
            error,
        });
    }
}

fn normalize_local_source(source: &str) -> PathBuf {
    if let Some(path) = source.strip_prefix("file://") {
        PathBuf::from(path)
    } else {
        PathBuf::from(source)
    }
}

fn part_file_path(path: &Path) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(".part");
    PathBuf::from(value)
}

fn file_len(path: &Path) -> BackendResult<u64> {
    match path.metadata() {
        Ok(metadata) => Ok(metadata.len()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(err) => Err(BackendError::Download(err.to_string())),
    }
}

fn finalize_part_file(part_path: &Path, final_path: &Path) -> BackendResult<()> {
    fs::rename(part_path, final_path).map_err(download_error)?;
    let _ = fs::remove_file(metadata_path(part_path));
    Ok(())
}

async fn finalize_part_file_async(part_path: &Path, final_path: &Path) -> BackendResult<()> {
    async_fs::rename(part_path, final_path)
        .await
        .map_err(download_error)?;
    let _ = async_fs::remove_file(metadata_path(part_path)).await;
    Ok(())
}

fn paused_downloads() -> &'static Mutex<HashSet<String>> {
    PAUSED_DOWNLOADS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn canceled_downloads() -> &'static Mutex<HashSet<String>> {
    CANCELED_DOWNLOADS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn clear_pause_request(task_id: &str) {
    if let Ok(mut paused) = paused_downloads().lock() {
        paused.remove(task_id);
    }
}

fn clear_cancel_request(task_id: &str) {
    if let Ok(mut canceled) = canceled_downloads().lock() {
        canceled.remove(task_id);
    }
}

fn is_pause_requested(task_id: &str) -> BackendResult<bool> {
    paused_downloads()
        .lock()
        .map(|paused| paused.contains(task_id))
        .map_err(|err| BackendError::Download(err.to_string()))
}

fn is_cancel_requested(task_id: &str) -> BackendResult<bool> {
    canceled_downloads()
        .lock()
        .map(|canceled| canceled.contains(task_id))
        .map_err(|err| BackendError::Download(err.to_string()))
}

fn is_http_source(source: &str) -> bool {
    Url::parse(source)
        .map(|parsed| matches!(parsed.scheme(), "http" | "https"))
        .unwrap_or(false)
}

pub fn infer_http_file_name(url: &str, override_name: Option<&str>) -> BackendResult<String> {
    let parsed = Url::parse(url.trim()).map_err(|err| BackendError::Download(err.to_string()))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(BackendError::Download(
            "仅支持 HTTP/HTTPS 下载地址。".to_string(),
        ));
    }

    let candidate = override_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            parsed
                .path_segments()
                .and_then(|mut segments| segments.next_back())
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "download.bin".to_string());
    let sanitized = sanitize_file_name(&candidate);
    if sanitized.is_empty() {
        return Ok("download.bin".to_string());
    }
    Ok(sanitized)
}

pub fn infer_local_file_name(source: &str, override_name: Option<&str>) -> BackendResult<String> {
    let source_path = normalize_local_source(source.trim());
    let candidate = override_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| local_source_file_name(source.trim(), &source_path))
        .unwrap_or_else(|| "download.bin".to_string());
    let sanitized = sanitize_file_name(&candidate);
    if sanitized.is_empty() {
        return Ok("download.bin".to_string());
    }
    Ok(sanitized)
}

fn local_source_file_name(source: &str, source_path: &Path) -> Option<String> {
    source_path
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.rsplit(['/', '\\']).next())
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .or_else(|| {
            source
                .rsplit(['/', '\\'])
                .next()
                .filter(|name| !name.is_empty())
                .map(str::to_string)
        })
}

fn sanitize_file_name(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>()
        .trim_matches('.')
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn infer_file_name_uses_last_url_segment() {
        let file_name = infer_http_file_name("https://example.com/files/model.gguf", None).unwrap();

        assert_eq!(file_name, "model.gguf");
    }

    #[test]
    fn infer_file_name_sanitizes_override_name() {
        let file_name =
            infer_http_file_name("https://example.com/file.zip", Some("a:b?.zip")).unwrap();

        assert_eq!(file_name, "a_b_.zip");
    }

    #[test]
    fn infer_file_name_rejects_non_http_url() {
        let err = infer_http_file_name("ftp://example.com/file.zip", None).unwrap_err();

        assert!(err.to_string().contains("仅支持 HTTP/HTTPS"));
    }

    #[test]
    fn infer_local_file_name_reads_unc_file_name() {
        let file_name = infer_local_file_name(r"\\server\share\file.yaml", None).unwrap();

        assert_eq!(file_name, "file.yaml");
    }

    #[tokio::test]
    async fn download_file_to_dir_saves_http_response() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0_u8; 1024];
            let _ = stream.read(&mut buffer).unwrap();
            let body = b"download works";
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .unwrap();
            stream.write_all(body).unwrap();
        });
        let temp_dir = tempfile::tempdir().unwrap();
        let url = format!("http://{address}/sample.yaml");

        let result =
            download_http_to_dir(&url, "sample.yaml", temp_dir.path(), "http-save", |_| {})
                .await
                .unwrap();

        assert_eq!(result.file_name, "sample.yaml");
        assert_eq!(result.bytes, 14);
        assert_eq!(
            std::fs::read_to_string(temp_dir.path().join("sample.yaml")).unwrap(),
            "download works"
        );
        server.join().unwrap();
    }

    #[test]
    fn copy_local_file_to_dir_saves_file() {
        let source_dir = tempfile::tempdir().unwrap();
        let target_dir = tempfile::tempdir().unwrap();
        let source_path = source_dir.path().join("sample.yaml");
        fs::write(&source_path, "mixed-port: 7890").unwrap();

        let result = copy_local_file_to_dir_with_progress(
            "local-save",
            &source_path.to_string_lossy(),
            "sample.yaml",
            target_dir.path(),
            COPY_BUFFER_SIZE,
            |_| {},
        )
        .unwrap();

        assert_eq!(result.file_name, "sample.yaml");
        assert_eq!(result.bytes, 16);
        assert_eq!(
            fs::read_to_string(target_dir.path().join("sample.yaml")).unwrap(),
            "mixed-port: 7890"
        );
    }

    #[test]
    fn copy_local_file_reports_throttled_progress_with_total_size() {
        let source_dir = tempfile::tempdir().unwrap();
        let target_dir = tempfile::tempdir().unwrap();
        let source_path = source_dir.path().join("movie.mkv");
        fs::write(&source_path, vec![7_u8; 10 * 1024]).unwrap();
        let mut events = Vec::new();

        let result = copy_local_file_to_dir_with_progress(
            "local-progress",
            &source_path.to_string_lossy(),
            "movie.mkv",
            target_dir.path(),
            4096,
            |event| events.push(event),
        )
        .unwrap();

        assert_eq!(result.file_name, "movie.mkv");
        assert_eq!(result.bytes, 10 * 1024);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].file_name, "movie.mkv");
        assert_eq!(events[0].total_bytes, Some(10 * 1024));
        assert_eq!(events.last().unwrap().downloaded_bytes, 10 * 1024);
    }

    #[test]
    fn copy_local_file_resumes_from_part_file() {
        let source_dir = tempfile::tempdir().unwrap();
        let target_dir = tempfile::tempdir().unwrap();
        let source_path = source_dir.path().join("movie.mkv");
        let bytes = (0..10 * 1024)
            .map(|value| (value % 255) as u8)
            .collect::<Vec<_>>();
        fs::write(&source_path, &bytes).unwrap();
        fs::write(target_dir.path().join("movie.mkv.part"), &bytes[..4096]).unwrap();
        write_resume(
            &target_dir.path().join("movie.mkv.part"),
            &local_metadata(&source_path).unwrap(),
        )
        .unwrap();

        let result = copy_local_file_to_dir_with_progress(
            "local-resume",
            &source_path.to_string_lossy(),
            "movie.mkv",
            target_dir.path(),
            4096,
            |_| {},
        )
        .unwrap();

        assert_eq!(result.bytes, 10 * 1024);
        assert_eq!(
            fs::read(target_dir.path().join("movie.mkv")).unwrap(),
            bytes
        );
        assert!(!target_dir.path().join("movie.mkv.part").exists());
    }

    #[test]
    fn rejects_overlapping_targets_and_releases_on_drop() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("same.zip");
        let guard = TransferGuard::acquire("owner", &path).unwrap();
        assert!(TransferGuard::acquire("other", &path).is_err());
        assert!(TransferGuard::acquire("owner", &dir.path().join("different.zip")).is_err());
        drop(guard);
        assert!(TransferGuard::acquire("other", &path).is_ok());
    }

    #[test]
    fn unrelated_or_oversized_partial_file_is_restarted() {
        for oversized in [false, true] {
            let source = tempfile::tempdir().unwrap();
            let dest = tempfile::tempdir().unwrap();
            let input = source.path().join("file.bin");
            fs::write(&input, b"correct").unwrap();
            let part = dest.path().join("file.bin.part");
            fs::write(
                &part,
                if oversized {
                    b"wrong long content".as_slice()
                } else {
                    b"bad".as_slice()
                },
            )
            .unwrap();
            if oversized {
                write_resume(&part, &local_metadata(&input).unwrap()).unwrap();
            }
            copy_local_file_to_dir_with_progress(
                "restart",
                &input.to_string_lossy(),
                "file.bin",
                dest.path(),
                2,
                |_| {},
            )
            .unwrap();
            assert_eq!(fs::read(dest.path().join("file.bin")).unwrap(), b"correct");
        }
    }

    #[test]
    fn validates_entire_remaining_content_range() {
        assert_eq!(range_total("bytes 3-9/10", 3).unwrap(), 10);
        for value in ["bytes 0-9/10", "bytes 3-8/10", "bytes 3-9/*", "garbage"] {
            assert!(range_total(value, 3).is_err());
        }
    }

    #[tokio::test]
    async fn pause_interrupts_a_server_that_never_sends_headers() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/file.bin", listener.local_addr().unwrap());
        let dir = tempfile::tempdir().unwrap();
        let download = download_http_to_dir(&url, "file.bin", dir.path(), "stall", |_| {});
        let pause = async {
            let (_stream, _) = listener.accept().await.unwrap();
            pause_download("stall").await.unwrap();
        };
        let (result, ()) = tokio::time::timeout(Duration::from_secs(2), async {
            tokio::join!(download, pause)
        })
        .await
        .unwrap();
        assert!(is_pause_error(&result.unwrap_err()));
        assert!(!active_downloads().lock().unwrap().contains_key("stall"));
    }

    #[tokio::test]
    async fn http_resume_validates_range_and_restarts_when_range_is_ignored() {
        for partial in [true, false] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/file.bin", listener.local_addr().unwrap());
            let server = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0; 4096];
                let size = stream.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..size]).to_lowercase();
                assert!(request.contains("range: bytes=3-"));
                assert!(request.contains("if-range: \"v1\""));
                if partial {
                    stream.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 4\r\nContent-Range: bytes 3-6/7\r\nETag: \"v1\"\r\nConnection: close\r\n\r\nrect").unwrap();
                } else {
                    stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\nETag: \"v2\"\r\nConnection: close\r\n\r\ncorrect").unwrap();
                }
            });
            let dir = tempfile::tempdir().unwrap();
            let part = dir.path().join("file.bin.part");
            fs::write(&part, b"cor").unwrap();
            write_resume(
                &part,
                &ResumeMetadata {
                    source: url.clone(),
                    validator: Some("\"v1\"".into()),
                    total: Some(7),
                },
            )
            .unwrap();
            download_http_to_dir(&url, "file.bin", dir.path(), "http-resume", |_| {})
                .await
                .unwrap();
            assert_eq!(fs::read(dir.path().join("file.bin")).unwrap(), b"correct");
            server.join().unwrap();
        }
    }
}
