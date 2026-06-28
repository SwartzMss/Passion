export type ReminderStatus = "pending" | "triggered" | "expired";
export type ReminderPriority = "low" | "medium" | "high";
export type ReminderRepeatRule = "once" | "daily" | "cn_workday";

export interface Reminder {
  id: string;
  title: string;
  notes?: string | null;
  remindAt: string;
  enabled: boolean;
  status: ReminderStatus;
  priority: ReminderPriority;
  repeatRule: ReminderRepeatRule;
  createdAt: string;
  updatedAt: string;
  triggeredAt?: string | null;
}

export interface NewReminder {
  title: string;
  notes?: string | null;
  remindAt: string;
  priority: ReminderPriority;
  repeatRule: ReminderRepeatRule;
}

export interface Settings {
  launchOnStartup: boolean;
  minimizeToTray: boolean;
}

export interface AiSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface TranslationRequest {
  text: string;
}

export interface TranslationResult {
  translatedText: string;
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

export type HttpApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface HttpApiPair {
  key: string;
  value: string;
}

export interface HttpApiRequest {
  method: HttpApiMethod;
  url: string;
  headers: HttpApiPair[];
  query: HttpApiPair[];
  body?: string | null;
}

export interface HttpApiResponse {
  status: number;
  statusText: string;
  elapsedMs: number;
  sizeBytes: number;
  receivedAt: string;
  headers: HttpApiPair[];
  body: string;
}

export interface DownloadRequest {
  taskId?: string | null;
  url: string;
  fileName?: string | null;
  saveDir?: string | null;
}

export interface DownloadResult {
  url: string;
  fileName: string;
  savedPath: string;
  bytes: number;
  elapsedMs: number;
}

export interface DownloadProgressEvent {
  taskId: string;
  url: string;
  fileName: string;
  savedPath: string;
  totalBytes?: number | null;
  downloadedBytes: number;
  elapsedMs: number;
  bytesPerSecond: number;
  status: "running" | "completed" | "failed" | "paused";
  error?: string | null;
}

export type ScriptTaskScheduleType = "interval" | "daily" | "weekly";

export interface NewScriptTask {
  name: string;
  scriptPath: string;
  scriptArgs?: string | null;
  scheduleType: ScriptTaskScheduleType;
  intervalMinutes?: number | null;
  timeOfDay?: string | null;
  weekdays?: number[] | null;
  enabled: boolean;
}

export interface ScriptTask {
  id: string;
  name: string;
  scriptPath: string;
  scriptArgs?: string | null;
  scheduleType: ScriptTaskScheduleType;
  intervalMinutes: number;
  timeOfDay?: string | null;
  weekdays?: number[] | null;
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

export type SshTunnelStatus = "stopped" | "starting" | "running" | "error";
export type SshTunnelBindAddress = "127.0.0.1" | "0.0.0.0";

export interface NewSshTunnel {
  name: string;
  description?: string | null;
  localPort: number;
  bindAddress: SshTunnelBindAddress;
  remoteHost: string;
  remotePort: number;
  username: string;
  keyPath: string;
}

export interface SshTunnelInfo extends NewSshTunnel {
  id: string;
  authType: "private_key";
  status: SshTunnelStatus;
  pid?: number | null;
  startedAt?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SshTunnelSettings {
  sshExecutablePath?: string | null;
}

export interface BackendError {
  message: string;
}
