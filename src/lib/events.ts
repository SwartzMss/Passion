import { listen } from "@tauri-apps/api/event";
import type { Reminder } from "../types";

export function onReminderTriggered(handler: (reminder: Reminder) => void) {
  return listen<Reminder>("reminder_triggered", (event) => {
    handler(event.payload);
  });
}
