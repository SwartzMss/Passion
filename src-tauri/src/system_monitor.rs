use crate::models::SystemSnapshot;
use std::thread;
use std::time::Duration;
use sysinfo::{Disks, System};

pub fn get_system_snapshot() -> SystemSnapshot {
    let mut system = System::new_all();
    thread::sleep(Duration::from_millis(200));
    system.refresh_cpu_usage();
    system.refresh_memory();

    let disks = Disks::new_with_refreshed_list();
    let (disk_total_bytes, disk_available_bytes) = disks.iter().fold((0, 0), |acc, disk| {
        (acc.0 + disk.total_space(), acc.1 + disk.available_space())
    });

    build_system_snapshot(
        system.global_cpu_usage(),
        system.total_memory(),
        system.available_memory(),
        disk_total_bytes,
        disk_available_bytes,
        System::uptime(),
    )
}

pub fn build_system_snapshot(
    cpu_usage_percent: f32,
    memory_total_bytes: u64,
    memory_available_bytes: u64,
    disk_total_bytes: u64,
    disk_available_bytes: u64,
    uptime_seconds: u64,
) -> SystemSnapshot {
    SystemSnapshot {
        cpu_usage_percent,
        memory_used_bytes: memory_total_bytes.saturating_sub(memory_available_bytes),
        memory_total_bytes,
        disk_used_bytes: disk_total_bytes.saturating_sub(disk_available_bytes),
        disk_total_bytes,
        uptime_seconds,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_snapshot_calculates_used_memory_and_disk() {
        let snapshot = build_system_snapshot(35.5, 16, 6, 100, 25, 3600);

        assert_eq!(snapshot.cpu_usage_percent, 35.5);
        assert_eq!(snapshot.memory_used_bytes, 10);
        assert_eq!(snapshot.memory_total_bytes, 16);
        assert_eq!(snapshot.disk_used_bytes, 75);
        assert_eq!(snapshot.disk_total_bytes, 100);
        assert_eq!(snapshot.uptime_seconds, 3600);
    }

    #[test]
    fn build_snapshot_saturates_available_values() {
        let snapshot = build_system_snapshot(1.0, 4, 8, 10, 20, 1);

        assert_eq!(snapshot.memory_used_bytes, 0);
        assert_eq!(snapshot.disk_used_bytes, 0);
    }
}
