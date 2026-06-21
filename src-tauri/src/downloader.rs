use crate::error::{BackendError, BackendResult};
use crate::models::{DownloadProgressEvent, DownloadRequest, DownloadResult};
use reqwest::Url;
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
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
    clear_pause_request(&task_id);
    let result = if is_http_source(source) {
        let file_name = infer_http_file_name(source, input.file_name.as_deref())?;
        download_http_to_dir(source, &file_name, &save_dir, &task_id, |event| {
            let _ = app.emit(DOWNLOAD_PROGRESS_EVENT, event);
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
                    let _ = app_for_copy.emit(DOWNLOAD_PROGRESS_EVENT, event);
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

pub fn pause_download(task_id: &str) -> BackendResult<()> {
    if task_id.trim().is_empty() {
        return Err(BackendError::Download("下载任务 ID 不能为空。".to_string()));
    }
    paused_downloads()
        .lock()
        .map_err(|err| BackendError::Download(err.to_string()))?
        .insert(task_id.to_string());
    Ok(())
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
    let part_path = part_file_path(&path);
    let start = Instant::now();
    let mut existing_bytes = file_len(&part_path)?;
    let client = reqwest::Client::new();
    let mut request = client.get(url);
    if existing_bytes > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={existing_bytes}-"));
    }
    let mut response = request
        .send()
        .await
        .map_err(|err| BackendError::Download(err.to_string()))?;
    if !response.status().is_success() {
        return Err(BackendError::Download(format!(
            "下载服务返回状态码 {}。",
            response.status()
        )));
    }
    if existing_bytes > 0 && response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        existing_bytes = 0;
    }

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
    let total_bytes = response
        .content_length()
        .map(|length| length.saturating_add(existing_bytes));
    let mut bytes = existing_bytes;
    let mut progress = ProgressEmitter::new(&mut on_progress);
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
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| BackendError::Download(err.to_string()))?
    {
        file.write_all(&chunk)
            .await
            .map_err(|err| BackendError::Download(err.to_string()))?;
        bytes += chunk.len() as u64;
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
    let part_path = part_file_path(&path);
    let start = Instant::now();
    let total_bytes = source_path
        .metadata()
        .map_err(|err| BackendError::Download(err.to_string()))?
        .len();
    let mut source_file =
        File::open(&source_path).map_err(|err| BackendError::Download(err.to_string()))?;
    let mut bytes = file_len(&part_path)?.min(total_bytes);
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
    let mut progress = ProgressEmitter::new(&mut on_progress);
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
}

impl<'a, F> ProgressEmitter<'a, F>
where
    F: FnMut(DownloadProgressEvent),
{
    fn new(on_progress: &'a mut F) -> Self {
        Self {
            on_progress,
            last_emit: None,
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
            bytes_per_second: downloaded_bytes as f64 / elapsed_seconds,
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
    if final_path.exists() {
        fs::remove_file(final_path).map_err(|err| BackendError::Download(err.to_string()))?;
    }
    fs::rename(part_path, final_path).map_err(|err| BackendError::Download(err.to_string()))
}

async fn finalize_part_file_async(part_path: &Path, final_path: &Path) -> BackendResult<()> {
    if final_path.exists() {
        async_fs::remove_file(final_path)
            .await
            .map_err(|err| BackendError::Download(err.to_string()))?;
    }
    async_fs::rename(part_path, final_path)
        .await
        .map_err(|err| BackendError::Download(err.to_string()))
}

fn paused_downloads() -> &'static Mutex<HashSet<String>> {
    PAUSED_DOWNLOADS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn clear_pause_request(task_id: &str) {
    if let Ok(mut paused) = paused_downloads().lock() {
        paused.remove(task_id);
    }
}

fn is_pause_requested(task_id: &str) -> BackendResult<bool> {
    paused_downloads()
        .lock()
        .map(|paused| paused.contains(task_id))
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
        .or_else(|| {
            source_path
                .file_name()
                .and_then(|name| name.to_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "download.bin".to_string());
    let sanitized = sanitize_file_name(&candidate);
    if sanitized.is_empty() {
        return Ok("download.bin".to_string());
    }
    Ok(sanitized)
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

        let result = download_http_to_dir(&url, "sample.yaml", temp_dir.path(), "task-1", |_| {})
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
            "task-1",
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
            "task-1",
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

        let result = copy_local_file_to_dir_with_progress(
            "task-1",
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
}
