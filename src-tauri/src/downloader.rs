use crate::error::{BackendError, BackendResult};
use crate::models::{DownloadRequest, DownloadResult};
use reqwest::Url;
use std::fs::File;
use std::io::Write;
use std::time::Instant;
use tauri::{AppHandle, Manager};

pub async fn download_file(
    app: &AppHandle,
    input: DownloadRequest,
) -> BackendResult<DownloadResult> {
    let url = input.url.trim();
    if url.is_empty() {
        return Err(BackendError::Download(
            "请输入 HTTP/HTTPS 下载地址。".to_string(),
        ));
    }

    let file_name = infer_file_name(url, input.file_name.as_deref())?;
    let download_dir = app
        .path()
        .download_dir()
        .map_err(|err| BackendError::Download(err.to_string()))?;
    let path = download_dir.join(&file_name);
    let start = Instant::now();
    let mut response = reqwest::get(url)
        .await
        .map_err(|err| BackendError::Download(err.to_string()))?;
    if !response.status().is_success() {
        return Err(BackendError::Download(format!(
            "下载服务返回状态码 {}。",
            response.status()
        )));
    }

    let mut file = File::create(&path).map_err(|err| BackendError::Download(err.to_string()))?;
    let mut bytes = 0_u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| BackendError::Download(err.to_string()))?
    {
        file.write_all(&chunk)
            .map_err(|err| BackendError::Download(err.to_string()))?;
        bytes += chunk.len() as u64;
    }

    Ok(DownloadResult {
        url: url.to_string(),
        file_name,
        saved_path: path.to_string_lossy().to_string(),
        bytes,
        elapsed_ms: start.elapsed().as_millis(),
    })
}

pub fn infer_file_name(url: &str, override_name: Option<&str>) -> BackendResult<String> {
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

    #[test]
    fn infer_file_name_uses_last_url_segment() {
        let file_name = infer_file_name("https://example.com/files/model.gguf", None).unwrap();

        assert_eq!(file_name, "model.gguf");
    }

    #[test]
    fn infer_file_name_sanitizes_override_name() {
        let file_name = infer_file_name("https://example.com/file.zip", Some("a:b?.zip")).unwrap();

        assert_eq!(file_name, "a_b_.zip");
    }

    #[test]
    fn infer_file_name_rejects_non_http_url() {
        let err = infer_file_name("ftp://example.com/file.zip", None).unwrap_err();

        assert!(err.to_string().contains("仅支持 HTTP/HTTPS"));
    }
}
