use crate::models::ScriptTask;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

#[derive(Default, Clone)]
pub struct ScriptTaskScheduler {
    handles: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    running: Arc<Mutex<HashSet<String>>>,
}

impl ScriptTaskScheduler {
    pub async fn schedule<F, Fut>(&self, task: &ScriptTask, run: F)
    where
        F: Fn(String) -> Fut + Clone + Send + Sync + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let id = task.id.clone();
        self.cancel(&id).await;

        let scheduler = self.clone();
        let interval = Duration::from_secs(u64::from(task.interval_minutes) * 60);
        let id_for_task = id.clone();
        let handle = tokio::spawn(async move {
            loop {
                tokio::time::sleep(interval).await;
                let run_once = run.clone();
                let task_id = id_for_task.clone();
                scheduler
                    .run_if_idle(&id_for_task, move || run_once(task_id))
                    .await;
            }
        });

        self.handles.lock().await.insert(id, handle);
    }

    pub async fn cancel(&self, id: &str) {
        if let Some(handle) = self.handles.lock().await.remove(id) {
            handle.abort();
        }
    }

    pub async fn run_if_idle<F, Fut, T>(&self, id: &str, run: F) -> Option<T>
    where
        F: FnOnce() -> Fut + Send,
        Fut: Future<Output = T> + Send,
    {
        {
            let mut running = self.running.lock().await;
            if running.contains(id) {
                return None;
            }
            running.insert(id.to_string());
        }

        let result = run().await;
        self.running.lock().await.remove(id);
        Some(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    #[tokio::test]
    async fn run_if_idle_skips_concurrent_run_for_same_task() {
        let scheduler = ScriptTaskScheduler::default();
        let count = Arc::new(AtomicUsize::new(0));
        let first_started = Arc::new(tokio::sync::Notify::new());
        let release_first = Arc::new(tokio::sync::Notify::new());

        let first = {
            let scheduler = scheduler.clone();
            let count = Arc::clone(&count);
            let first_started = Arc::clone(&first_started);
            let release_first = Arc::clone(&release_first);
            tokio::spawn(async move {
                scheduler
                    .run_if_idle("task-1", || async move {
                        count.fetch_add(1, Ordering::SeqCst);
                        first_started.notify_one();
                        release_first.notified().await;
                    })
                    .await
            })
        };

        first_started.notified().await;
        let second = scheduler.run_if_idle("task-1", || async {}).await;
        release_first.notify_one();

        assert!(second.is_none());
        assert_eq!(first.await.unwrap(), Some(()));
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }
}
