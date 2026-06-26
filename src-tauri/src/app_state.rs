use crate::scheduler::Scheduler;
use crate::script_task_scheduler::ScriptTaskScheduler;
use crate::ssh_tunnels::SshTunnelManager;
use rusqlite::Connection;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[derive(Clone)]
pub struct AppState {
    pub conn: Arc<Mutex<Connection>>,
    pub scheduler: Scheduler,
    pub script_task_scheduler: ScriptTaskScheduler,
    pub ssh_tunnel_manager: SshTunnelManager,
    pub log_path: Arc<PathBuf>,
}

impl AppState {
    #[cfg(test)]
    pub fn new(conn: Connection, scheduler: Scheduler) -> Self {
        Self::new_with_log_path(conn, scheduler, std::env::temp_dir().join("passion.log"))
    }

    pub fn new_with_log_path(conn: Connection, scheduler: Scheduler, log_path: PathBuf) -> Self {
        Self {
            conn: Arc::new(Mutex::new(conn)),
            scheduler,
            script_task_scheduler: ScriptTaskScheduler::default(),
            ssh_tunnel_manager: SshTunnelManager::default(),
            log_path: Arc::new(log_path),
        }
    }
}
