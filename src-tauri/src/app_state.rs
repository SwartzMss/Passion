use crate::scheduler::Scheduler;
use crate::script_task_scheduler::ScriptTaskScheduler;
use rusqlite::Connection;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct AppState {
    pub conn: Arc<Mutex<Connection>>,
    pub scheduler: Scheduler,
    pub script_task_scheduler: ScriptTaskScheduler,
}

impl AppState {
    pub fn new(conn: Connection, scheduler: Scheduler) -> Self {
        Self {
            conn: Arc::new(Mutex::new(conn)),
            scheduler,
            script_task_scheduler: ScriptTaskScheduler::default(),
        }
    }
}
