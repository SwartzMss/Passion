use crate::models::Reminder;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::oneshot;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

#[derive(Default, Clone)]
pub struct Scheduler {
    handles: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
}

impl Scheduler {
    pub async fn schedule<F>(&self, reminder: Reminder, on_fire: F)
    where
        F: FnOnce(String) + Send + 'static,
    {
        self.cancel(&reminder.id).await;

        let id = reminder.id.clone();
        let delay = (reminder.remind_at - chrono::Utc::now())
            .to_std()
            .unwrap_or_else(|_| std::time::Duration::from_millis(0));

        let handles = Arc::clone(&self.handles);
        let (start_tx, start_rx) = oneshot::channel();
        let id_for_task = id.clone();
        let handle = tokio::spawn(async move {
            let _ = start_rx.await;
            tokio::time::sleep(delay).await;
            {
                let mut handles = handles.lock().await;
                handles.remove(&id_for_task);
            }
            on_fire(id_for_task);
        });

        self.handles.lock().await.insert(id, handle);
        let _ = start_tx.send(());
    }

    pub async fn cancel(&self, id: &str) {
        if let Some(handle) = self.handles.lock().await.remove(id) {
            handle.abort();
        }
    }

    pub async fn clear(&self) {
        let mut handles = self.handles.lock().await;
        for (_, handle) in handles.drain() {
            handle.abort();
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

        assert!(result.is_err());
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
