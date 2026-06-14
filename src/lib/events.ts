import { listen } from "@tauri-apps/api/event";
import type { DownloadProgressEvent, Reminder } from "../types";

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
