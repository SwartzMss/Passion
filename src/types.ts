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

export interface AiSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
  defaultTargetLanguage: string;
}

export interface TranslationRequest {
  text: string;
  targetLanguage: string;
}

export interface TranslationResult {
  translatedText: string;
}

export interface PingRequest {
  host: string;
}

export interface PingResult {
  host: string;
  reachable: boolean;
  summary: string;
  rawOutput: string;
}

export interface PortCheckRequest {
  host: string;
  port: number;
}

export interface PortCheckResult {
  host: string;
  port: number;
  open: boolean;
  elapsedMs: number;
  error?: string | null;
}

export interface DownloadRequest {
  url: string;
  fileName?: string | null;
}

export interface DownloadResult {
  url: string;
  fileName: string;
  savedPath: string;
  bytes: number;
  elapsedMs: number;
}

export interface BackendError {
  message: string;
}
