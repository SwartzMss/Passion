export type ReminderStatus = "pending" | "triggered" | "expired";

export interface Reminder {
  id: string;
  title: string;
  notes?: string | null;
  remindAt: string;
  enabled: boolean;
  status: ReminderStatus;
  createdAt: string;
  updatedAt: string;
  triggeredAt?: string | null;
}

export interface NewReminder {
  title: string;
  notes?: string | null;
  remindAt: string;
}

export interface Settings {
  launchOnStartup: boolean;
  minimizeToTray: boolean;
  notificationEnabled: boolean;
}

export interface BackendError {
  message: string;
}
