import { invoke } from "@tauri-apps/api/core";
import type { NewReminder, Reminder, Settings } from "../types";

export async function listReminders(): Promise<Reminder[]> {
  return invoke<Reminder[]>("list_reminders");
}

export async function createReminder(input: NewReminder): Promise<Reminder> {
  return invoke<Reminder>("create_reminder", { input });
}

export async function toggleReminder(
  id: string,
  enabled: boolean,
): Promise<Reminder> {
  return invoke<Reminder>("toggle_reminder", { id, enabled });
}

export async function deleteReminder(id: string): Promise<void> {
  return invoke<void>("delete_reminder", { id });
}

export async function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export async function updateSettings(settings: Settings): Promise<Settings> {
  return invoke<Settings>("update_settings", { settings });
}

export async function testNotification(): Promise<void> {
  return invoke<void>("test_notification");
}
