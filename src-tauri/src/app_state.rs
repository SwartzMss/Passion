use crate::scheduler::Scheduler;
use rusqlite::Connection;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct AppState {
    pub conn: Arc<Mutex<Connection>>,
    pub scheduler: Scheduler,
}

impl AppState {
    pub fn new(conn: Connection, scheduler: Scheduler) -> Self {
        Self {
            conn: Arc::new(Mutex::new(conn)),
            scheduler,
        }
    }
}
