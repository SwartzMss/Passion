use crate::models::Reminder;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::oneshot;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

#[derive(Default, Clone)]
pub struct Scheduler {
    handles: Arc<Mutex<HashMap<String, ScheduledTask>>>,
}

struct ScheduledTask {
    generation: u64,
    handle: JoinHandle<()>,
}

impl Scheduler {
    pub async fn schedule<F>(&self, reminder: Reminder, on_fire: F)
    where
        F: FnOnce(String) + Send + 'static,
    {
        let id = reminder.id.clone();
        let delay = (reminder.remind_at - chrono::Utc::now())
            .to_std()
            .unwrap_or_else(|_| std::time::Duration::from_millis(0));

        let handles = Arc::clone(&self.handles);
        let (start_tx, start_rx) = oneshot::channel();
        let id_for_task = id.clone();
        let mut handles_guard = self.handles.lock().await;
        let generation = handles_guard
            .get(&id)
            .map_or(1, |task| task.generation.saturating_add(1));
        let handle = tokio::spawn(async move {
            if start_rx.await.is_err() {
                return;
            }
            tokio::time::sleep(delay).await;
            {
                let mut handles = handles.lock().await;
                if handles
                    .get(&id_for_task)
                    .is_some_and(|task| task.generation == generation)
                {
                    handles.remove(&id_for_task);
                }
            }
            on_fire(id_for_task);
        });

        let old = handles_guard.insert(id, ScheduledTask { generation, handle });
        if let Some(task) = old {
            task.handle.abort();
        }
        drop(handles_guard);
        let _ = start_tx.send(());
    }

    pub async fn cancel(&self, id: &str) {
        if let Some(task) = self.handles.lock().await.remove(id) {
            task.handle.abort();
        }
    }

    pub async fn clear(&self) {
        let mut handles = self.handles.lock().await;
        for (_, task) in handles.drain() {
            task.handle.abort();
        }
    }

    pub async fn is_scheduled(&self, id: &str) -> bool {
        self.handles.lock().await.contains_key(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ReminderStatus;
    use chrono::{Duration, Utc};
    use tokio::sync::mpsc;
    use tokio::sync::Barrier;

    #[tokio::test]
    async fn schedule_fires_once() {
        let scheduler = Scheduler::default();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let reminder = reminder_in(Duration::milliseconds(20));

        scheduler
            .schedule(reminder.clone(), move |id| {
                tx.send(id).unwrap();
            })
            .await;

        let fired = tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv())
            .await
            .unwrap()
            .unwrap();

        assert_eq!(fired, reminder.id);
        assert!(!scheduler.is_scheduled(&reminder.id).await);
    }

    #[tokio::test]
    async fn cancel_prevents_fire() {
        let scheduler = Scheduler::default();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let reminder = reminder_in(Duration::milliseconds(80));

        scheduler
            .schedule(reminder.clone(), move |id| {
                tx.send(id).unwrap();
            })
            .await;
        scheduler.cancel(&reminder.id).await;

        let result = tokio::time::timeout(std::time::Duration::from_millis(140), rx.recv()).await;

        assert!(matches!(result, Err(_) | Ok(None)));
        assert!(!scheduler.is_scheduled(&reminder.id).await);
    }

    #[tokio::test]
    async fn immediate_schedule_does_not_leave_stale_handle() {
        let scheduler = Scheduler::default();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let reminder = reminder_in(Duration::milliseconds(-1));

        scheduler
            .schedule(reminder.clone(), move |id| {
                tx.send(id).unwrap();
            })
            .await;

        let fired = tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv())
            .await
            .unwrap()
            .unwrap();

        assert_eq!(fired, reminder.id);
        assert!(!scheduler.is_scheduled(&reminder.id).await);
    }

    #[tokio::test]
    async fn reschedule_same_id_replaces_previous_handle() {
        let scheduler = Scheduler::default();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let reminder = reminder_in(Duration::milliseconds(120));
        let replacement = Reminder {
            remind_at: Utc::now() + Duration::milliseconds(20),
            ..reminder.clone()
        };

        scheduler
            .schedule(reminder.clone(), {
                let tx = tx.clone();
                move |id| {
                    tx.send(format!("old:{id}")).unwrap();
                }
            })
            .await;
        scheduler
            .schedule(replacement.clone(), move |id| {
                tx.send(format!("new:{id}")).unwrap();
            })
            .await;

        let fired = tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv())
            .await
            .unwrap()
            .unwrap();

        assert_eq!(fired, format!("new:{}", reminder.id));
        let old_result =
            tokio::time::timeout(std::time::Duration::from_millis(180), rx.recv()).await;

        assert!(matches!(old_result, Err(_) | Ok(None)));
        assert!(!scheduler.is_scheduled(&reminder.id).await);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_same_id_schedules_fire_once() {
        let scheduler = Scheduler::default();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let reminder = reminder_in(Duration::milliseconds(80));
        let barrier = Arc::new(Barrier::new(17));
        let mut schedule_tasks = Vec::new();

        for _ in 0..16 {
            let scheduler = scheduler.clone();
            let reminder = reminder.clone();
            let tx = tx.clone();
            let barrier = Arc::clone(&barrier);
            schedule_tasks.push(tokio::spawn(async move {
                barrier.wait().await;
                scheduler
                    .schedule(reminder, move |id| {
                        tx.send(id).unwrap();
                    })
                    .await;
            }));
        }
        drop(tx);
        barrier.wait().await;

        for task in schedule_tasks {
            task.await.unwrap();
        }

        let fired = tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv())
            .await
            .unwrap()
            .unwrap();

        assert_eq!(fired, reminder.id);

        let second = tokio::time::timeout(std::time::Duration::from_millis(120), rx.recv()).await;
        assert!(matches!(second, Err(_) | Ok(None)));
        assert!(!scheduler.is_scheduled(&reminder.id).await);
    }

    fn reminder_in(offset: Duration) -> Reminder {
        let now = Utc::now();
        Reminder {
            id: uuid::Uuid::new_v4().to_string(),
            title: "Test".to_string(),
            notes: None,
            remind_at: now + offset,
            enabled: true,
            status: ReminderStatus::Pending,
            created_at: now,
            updated_at: now,
            triggered_at: None,
        }
    }
}
