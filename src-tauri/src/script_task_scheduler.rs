use crate::models::ScriptTask;
use chrono::{DateTime, Datelike, Days, Local, NaiveTime, TimeZone};
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::Arc;
use std::time::Duration as StdDuration;
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
        let task_for_schedule = task.clone();
        let id_for_task = id.clone();
        let handle = tokio::spawn(async move {
            loop {
                tokio::time::sleep(next_delay(&task_for_schedule, Local::now())).await;
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

pub fn next_delay(task: &ScriptTask, now: DateTime<Local>) -> StdDuration {
    if task.schedule_type == "daily" {
        return next_daily_delay(task, now);
    }
    if task.schedule_type == "weekly" {
        return next_weekly_delay(task, now);
    }
    StdDuration::from_secs(u64::from(task.interval_minutes) * 60)
}

fn next_daily_delay(task: &ScriptTask, now: DateTime<Local>) -> StdDuration {
    let time = parse_time(task.time_of_day.as_deref()).unwrap_or(NaiveTime::MIN);
    let today = now.date_naive();
    let candidate = local_datetime(today, time);
    let next = if candidate > now {
        candidate
    } else {
        local_datetime(today.checked_add_days(Days::new(1)).unwrap_or(today), time)
    };
    duration_until(now, next)
}

fn next_weekly_delay(task: &ScriptTask, now: DateTime<Local>) -> StdDuration {
    let time = parse_time(task.time_of_day.as_deref()).unwrap_or(NaiveTime::MIN);
    let weekdays = task.weekdays.as_deref().unwrap_or(&[]);
    let today = now.date_naive();
    let today_weekday = now.weekday().number_from_monday();

    for offset in 0..=7 {
        let date = today.checked_add_days(Days::new(offset)).unwrap_or(today);
        let weekday = ((today_weekday + offset as u32 - 1) % 7 + 1) as u8;
        if !weekdays.contains(&weekday) {
            continue;
        }
        let candidate = local_datetime(date, time);
        if candidate > now {
            return duration_until(now, candidate);
        }
    }

    StdDuration::from_secs(7 * 24 * 60 * 60)
}

fn parse_time(value: Option<&str>) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(value?, "%H:%M").ok()
}

fn local_datetime(date: chrono::NaiveDate, time: NaiveTime) -> DateTime<Local> {
    Local
        .from_local_datetime(&date.and_time(time))
        .earliest()
        .unwrap_or_else(Local::now)
}

fn duration_until(now: DateTime<Local>, next: DateTime<Local>) -> StdDuration {
    (next - now)
        .to_std()
        .unwrap_or_else(|_| StdDuration::from_secs(0))
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

    fn script_task(schedule_type: &str) -> ScriptTask {
        ScriptTask {
            id: "task-1".to_string(),
            name: "Backup".to_string(),
            script_path: "C:\\tools\\backup.ps1".to_string(),
            schedule_type: schedule_type.to_string(),
            interval_minutes: 15,
            time_of_day: None,
            weekdays: None,
            enabled: true,
            last_started_at: None,
            last_finished_at: None,
            last_exit_code: None,
            last_stdout: None,
            last_stderr: None,
            last_error: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn next_delay_uses_daily_time() {
        let mut task = script_task("daily");
        task.time_of_day = Some("09:30".to_string());
        let now = Local.with_ymd_and_hms(2026, 6, 12, 9, 0, 0).unwrap();

        assert_eq!(next_delay(&task, now), StdDuration::from_secs(30 * 60));
    }

    #[test]
    fn next_delay_uses_weekly_day_and_time() {
        let mut task = script_task("weekly");
        task.time_of_day = Some("18:00".to_string());
        task.weekdays = Some(vec![1, 5]);
        let now = Local.with_ymd_and_hms(2026, 6, 12, 17, 0, 0).unwrap();

        assert_eq!(next_delay(&task, now), StdDuration::from_secs(60 * 60));
    }
}
