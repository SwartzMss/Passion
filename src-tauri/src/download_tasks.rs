use crate::error::{BackendError, BackendResult};
use crate::models::{DownloadProgressEvent, DownloadRequest, DownloadResult};
use chrono::Utc;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

pub const CHANGED_EVENT: &str = "download_task_changed";
const MAX_TASKS: usize = 500;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTask {
    pub id: String,
    pub url: String,
    pub save_dir: String,
    pub requested_file_name: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub status: String,
    pub result: Option<DownloadResult>,
    pub error: Option<String>,
    pub saved_path: String,
    pub total_bytes: Option<u64>,
    pub downloaded_bytes: u64,
    pub bytes_per_second: f64,
    pub elapsed_ms: u128,
    pub revision: u64,
}

#[derive(Clone, Default)]
pub struct DownloadTaskManager(Arc<Mutex<HashMap<String, DownloadTask>>>);

fn error(message: impl std::fmt::Display) -> BackendError {
    BackendError::Download(message.to_string())
}

impl DownloadTaskManager {
    pub fn begin(&self, input: &DownloadRequest) -> BackendResult<DownloadTask> {
        let mut tasks = self.0.lock().map_err(error)?;
        let id = input
            .task_id
            .as_deref()
            .ok_or_else(|| error("下载任务 ID 不能为空。"))?;
        let old = tasks.get(id);
        if old.is_some_and(|task| task.status == "running") {
            return Err(error("下载任务正在执行。"));
        }
        if old.is_none() && tasks.len() >= MAX_TASKS {
            return Err(error("下载记录已达 500 条，请删除不再需要的记录。"));
        }
        let task = DownloadTask {
            id: id.into(),
            url: input.url.clone(),
            save_dir: input.save_dir.clone().unwrap_or_default(),
            requested_file_name: crate::downloader::infer_http_file_name(
                &input.url,
                input.file_name.as_deref(),
            )
            .or_else(|_| {
                crate::downloader::infer_local_file_name(&input.url, input.file_name.as_deref())
            })?,
            started_at: Utc::now().to_rfc3339(),
            finished_at: None,
            status: "running".into(),
            result: None,
            error: None,
            saved_path: String::new(),
            total_bytes: None,
            downloaded_bytes: 0,
            bytes_per_second: 0.0,
            elapsed_ms: 0,
            revision: old.map_or(1, |task| task.revision + 1),
        };
        tasks.insert(id.into(), task.clone());
        Ok(task)
    }

    pub fn list(&self) -> BackendResult<Vec<DownloadTask>> {
        let mut tasks: Vec<_> = self.0.lock().map_err(error)?.values().cloned().collect();
        tasks.sort_by(|a, b| b.started_at.cmp(&a.started_at).then(a.id.cmp(&b.id)));
        Ok(tasks)
    }

    pub fn progress(&self, event: &DownloadProgressEvent) -> Option<DownloadTask> {
        let mut tasks = self.0.lock().ok()?;
        let task = tasks.get_mut(&event.task_id)?;
        if task.status != "running" {
            return None;
        }
        // Terminal state is published by finish only after file handles and target locks are released.
        task.requested_file_name.clone_from(&event.file_name);
        task.saved_path.clone_from(&event.saved_path);
        task.total_bytes = event.total_bytes;
        task.downloaded_bytes = event.downloaded_bytes;
        task.bytes_per_second = event.bytes_per_second;
        task.elapsed_ms = event.elapsed_ms;
        task.revision += 1;
        Some(task.clone())
    }

    pub fn finish(
        &self,
        id: &str,
        result: &BackendResult<DownloadResult>,
    ) -> BackendResult<DownloadTask> {
        let mut tasks = self.0.lock().map_err(error)?;
        let task = tasks.get_mut(id).ok_or_else(|| error("下载任务不存在。"))?;
        task.revision += 1;
        task.finished_at = Some(Utc::now().to_rfc3339());
        match result {
            Ok(result) => {
                task.status = "completed".into();
                task.downloaded_bytes = result.bytes;
                task.total_bytes = Some(result.bytes);
                task.saved_path.clone_from(&result.saved_path);
                task.requested_file_name.clone_from(&result.file_name);
                task.result = Some(result.clone());
            }
            Err(err) => {
                let message = err.to_string();
                task.status = if message == "下载已暂停。" {
                    "paused"
                } else {
                    "failed"
                }
                .into();
                task.error = Some(message);
            }
        }
        Ok(task.clone())
    }

    pub fn cancel_stopped(&self, id: &str) -> BackendResult<Option<DownloadTask>> {
        let mut tasks = self.0.lock().map_err(error)?;
        let Some(task) = tasks.get_mut(id) else {
            return Ok(None);
        };
        if task.status != "paused" {
            return Ok(None);
        }
        task.status = "failed".into();
        task.error = Some("下载已取消。".into());
        task.finished_at = Some(Utc::now().to_rfc3339());
        task.revision += 1;
        Ok(Some(task.clone()))
    }

    pub fn running(&self, id: &str) -> BackendResult<bool> {
        Ok(self
            .0
            .lock()
            .map_err(error)?
            .get(id)
            .is_some_and(|task| task.status == "running"))
    }

    pub fn remove(&self, id: &str) -> BackendResult<()> {
        let mut tasks = self.0.lock().map_err(error)?;
        if tasks
            .get(id)
            .is_some_and(|task| matches!(task.status.as_str(), "running" | "paused"))
        {
            return Err(error("请先取消任务。"));
        }
        tasks.remove(id);
        Ok(())
    }
}

pub fn publish_progress(app: &AppHandle, event: DownloadProgressEvent) {
    if let Some(task) = app
        .state::<crate::app_state::AppState>()
        .download_task_manager
        .progress(&event)
    {
        let _ = app.emit(CHANGED_EVENT, task);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshots_survive_clients_and_reject_duplicate_runs() {
        let manager = DownloadTaskManager::default();
        let input = DownloadRequest {
            task_id: Some("one".into()),
            url: "file".into(),
            save_dir: None,
            file_name: None,
        };
        manager.begin(&input).unwrap();
        assert!(manager.begin(&input).is_err());
        assert!(manager.remove("one").is_err());
        let task = manager.finish("one", &Err(error("下载已暂停。"))).unwrap();
        assert_eq!(manager.clone().list().unwrap()[0].status, "paused");
        assert!(manager.begin(&input).unwrap().revision > task.revision);
        manager.finish("one", &Err(error("下载已暂停。"))).unwrap();
        manager.cancel_stopped("one").unwrap();
        manager.remove("one").unwrap();
        assert!(manager.list().unwrap().is_empty());
    }
}
