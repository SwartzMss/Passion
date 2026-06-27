import { invoke } from "@tauri-apps/api/core";
import type {
  AiSettings,
  DownloadRequest,
  DownloadResult,
  NewReminder,
  NewScriptTask,
  NewSshTunnel,
  PortCheckRequest,
  PortCheckResult,
  PortOccupancyRequest,
  PortOccupancyResult,
  Reminder,
  Settings,
  ScriptTask,
  SshTunnelInfo,
  SshTunnelSettings,
  TranslationRequest,
  TranslationResult,
} from "../types";

export async function listReminders(): Promise<Reminder[]> {
  return invoke<Reminder[]>("list_reminders");
}

export async function createReminder(input: NewReminder): Promise<Reminder> {
  return invoke<Reminder>("create_reminder", { input });
}

export async function updateReminder(
  id: string,
  input: NewReminder,
): Promise<Reminder> {
  return invoke<Reminder>("update_reminder", { id, input });
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

export async function getAiSettings(): Promise<AiSettings> {
  return invoke<AiSettings>("get_ai_settings");
}

export async function updateAiSettings(settings: AiSettings): Promise<AiSettings> {
  return invoke<AiSettings>("update_ai_settings", { settings });
}

export async function testAiConnection(): Promise<void> {
  return invoke<void>("test_ai_connection");
}

export async function translateText(
  input: TranslationRequest,
): Promise<TranslationResult> {
  return invoke<TranslationResult>("translate_text", { input });
}

export async function checkPort(
  input: PortCheckRequest,
): Promise<PortCheckResult> {
  return invoke<PortCheckResult>("check_port", { input });
}

export async function inspectPortOccupancy(
  input: PortOccupancyRequest,
): Promise<PortOccupancyResult> {
  return invoke<PortOccupancyResult>("inspect_port_occupancy", { input });
}

export async function getSshTunnelSettings(): Promise<SshTunnelSettings> {
  return invoke<SshTunnelSettings>("get_ssh_tunnel_settings");
}

export async function updateSshTunnelSettings(
  input: SshTunnelSettings,
): Promise<SshTunnelSettings> {
  return invoke<SshTunnelSettings>("update_ssh_tunnel_settings", { input });
}

export async function listSshTunnels(): Promise<SshTunnelInfo[]> {
  return invoke<SshTunnelInfo[]>("list_ssh_tunnels");
}

export async function createSshTunnel(
  input: NewSshTunnel,
): Promise<SshTunnelInfo> {
  return invoke<SshTunnelInfo>("create_ssh_tunnel", { input });
}

export async function updateSshTunnel(
  id: string,
  input: NewSshTunnel,
): Promise<SshTunnelInfo> {
  return invoke<SshTunnelInfo>("update_ssh_tunnel", { id, input });
}

export async function deleteSshTunnel(id: string): Promise<void> {
  return invoke<void>("delete_ssh_tunnel", { id });
}

export async function startSshTunnel(id: string): Promise<SshTunnelInfo> {
  return invoke<SshTunnelInfo>("start_ssh_tunnel", { id });
}

export async function stopSshTunnel(id: string): Promise<SshTunnelInfo> {
  return invoke<SshTunnelInfo>("stop_ssh_tunnel", { id });
}

export async function downloadFile(
  input: DownloadRequest,
): Promise<DownloadResult> {
  return invoke<DownloadResult>("download_file", { input });
}

export async function pauseDownload(taskId: string): Promise<void> {
  return invoke<void>("pause_download", { taskId });
}

export async function cancelDownload(taskId: string): Promise<void> {
  return invoke<void>("cancel_download", { taskId });
}

export async function getDefaultDownloadDir(): Promise<string> {
  return invoke<string>("get_default_download_dir");
}

export async function listScriptTasks(): Promise<ScriptTask[]> {
  return invoke<ScriptTask[]>("list_script_tasks");
}

export async function createScriptTask(
  input: NewScriptTask,
): Promise<ScriptTask> {
  return invoke<ScriptTask>("create_script_task", { input });
}

export async function setScriptTaskEnabled(
  id: string,
  enabled: boolean,
): Promise<ScriptTask> {
  return invoke<ScriptTask>("set_script_task_enabled", { id, enabled });
}

export async function deleteScriptTask(id: string): Promise<void> {
  return invoke<void>("delete_script_task", { id });
}

export async function runScriptTaskNow(id: string): Promise<ScriptTask> {
  return invoke<ScriptTask>("run_script_task_now", { id });
}
