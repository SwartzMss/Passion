export type ReminderStatus = "pending" | "triggered" | "expired";
export type ReminderRepeatRule =
  | "once"
  | "daily"
  | "cn_workday"
  | `weekly:${string}`;

export interface Reminder {
  id: string;
  title: string;
  notes?: string | null;
  remindAt: string;
  enabled: boolean;
  status: ReminderStatus;
  repeatRule: ReminderRepeatRule;
  createdAt: string;
  updatedAt: string;
  triggeredAt?: string | null;
}

export interface NewReminder {
  title: string;
  notes?: string | null;
  remindAt: string;
  repeatRule: ReminderRepeatRule;
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

export interface PortOccupancyRequest {
  port: number;
}

export interface PortOccupancyEntry {
  protocol: string;
  localAddress: string;
  state: string;
  pid: number;
  processName?: string | null;
}

export interface PortOccupancyResult {
  port: number;
  entries: PortOccupancyEntry[];
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

export interface SystemSnapshot {
  cpuUsagePercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  uptimeSeconds: number;
}

export interface NewScriptTask {
  name: string;
  scriptPath: string;
  intervalMinutes: number;
  enabled: boolean;
}

export interface ScriptTask {
  id: string;
  name: string;
  scriptPath: string;
  intervalMinutes: number;
  enabled: boolean;
  lastStartedAt?: string | null;
  lastFinishedAt?: string | null;
  lastExitCode?: number | null;
  lastStdout?: string | null;
  lastStderr?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackendError {
  message: string;
}
