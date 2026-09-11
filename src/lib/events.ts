import { listen } from "@tauri-apps/api/event";
import type { DownloadTask, DownloadProgressEvent, PortScanProgress, Reminder } from "../types";

export function onDownloadTaskChanged(handler: (task: DownloadTask) => void) {
  return listen<DownloadTask>("download_task_changed", (event) => handler(event.payload));
}

export function onReminderTriggered(handler: (reminder: Reminder) => void) {
  return listen<Reminder>("reminder_triggered", (event) => {
    handler(event.payload);
  });
}

export function onDownloadProgress(handler: (progress: DownloadProgressEvent) => void) {
  return listen<DownloadProgressEvent>("download_progress", (event) => {
    handler(event.payload);
  });
}

export function onPortScanProgress(
  handler: (progress: PortScanProgress) => void,
) {
  return listen<PortScanProgress>("port-scan-progress", (event) => {
    handler(event.payload);
  });
}
