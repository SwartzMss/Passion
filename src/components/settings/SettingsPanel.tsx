import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import {
  getAiSettings,
  getSettings,
  getSshTunnelSettings,
  testAiConnection,
  updateAiSettings,
  updateSettings,
  updateSshTunnelSettings,
} from "../../lib/api";
import type { AiSettings, Settings, SshTunnelSettings } from "../../types";

export function SettingsPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const [sshSettings, setSshSettings] = useState<SshTunnelSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiFeedback, setAiFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((err) => setError(readError(err)));
    getAiSettings()
      .then(setAiSettings)
      .catch((err) => setError(readError(err)));
    getSshTunnelSettings()
      .then(setSshSettings)
      .catch((err) => setError(readError(err)));
  }, []);

  async function patch(next: Partial<Settings>) {
    if (!settings) {
      return;
    }
    const previous = settings;
    const updated = { ...settings, ...next };
    setSettings(updated);
    setError(null);
    try {
      setSettings(await updateSettings(updated));
    } catch (err) {
      setSettings(previous);
      setError(readError(err));
    }
  }

  async function saveAiSettings() {
    if (!aiSettings) {
      return;
    }
    setError(null);
    setAiFeedback(null);
    try {
      const saved = await updateAiSettings(aiSettings);
      setAiSettings(saved);
      setAiFeedback({ type: "success", message: "AI 设置已保存。" });
    } catch (err) {
      setAiFeedback({ type: "error", message: readError(err) });
    }
  }

  async function checkAiConnection() {
    if (!aiSettings) {
      return;
    }
    setError(null);
    setAiFeedback(null);
    try {
      const saved = await updateAiSettings(aiSettings);
      setAiSettings(saved);
      await testAiConnection();
      setAiFeedback({ type: "success", message: "AI 连接正常。" });
    } catch (err) {
      setAiFeedback({ type: "error", message: readError(err) });
    }
  }

  async function chooseSshExecutable() {
    const selected = await open({ directory: false, multiple: false });
    if (typeof selected === "string") {
      setSshSettings({ sshExecutablePath: selected });
    }
  }

  async function saveSshSettings() {
    if (!sshSettings) {
      return;
    }
    setError(null);
    try {
      setSshSettings(
        await updateSshTunnelSettings({
          sshExecutablePath: sshSettings.sshExecutablePath?.trim() || null,
        }),
      );
    } catch (err) {
      setError(readError(err));
    }
  }

  if (!settings || !aiSettings || !sshSettings) {
    return <p>正在加载设置...</p>;
  }

  return (
    <section className="settings-panel">
      <div className="settings-hero">
        <h1>设置</h1>
        <p>管理应用启动、AI 翻译和 SSH 工具配置。</p>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-icon" aria-hidden="true">⚙</span>
          <h2>通用设置</h2>
        </div>
        <label className="settings-toggle-row">
          <span>开机自启动</span>
          <input
            className="settings-switch"
            type="checkbox"
            checked={settings.launchOnStartup}
            onChange={(event) => patch({ launchOnStartup: event.target.checked })}
          />
        </label>
        <label className="settings-toggle-row">
          <span>最小化到托盘</span>
          <input
            className="settings-switch"
            type="checkbox"
            checked={settings.minimizeToTray}
            onChange={(event) => patch({ minimizeToTray: event.target.checked })}
          />
        </label>
      </div>

      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-icon settings-card-icon-ai" aria-hidden="true">✦</span>
          <div>
            <h2>AI 翻译设置</h2>
            <p>配置 OpenAI 兼容接口，用于翻译功能。</p>
          </div>
        </div>

        <label className="settings-field-row">
          <span>API 地址</span>
          <input
            value={aiSettings.baseUrl}
            onChange={(event) =>
              setAiSettings({ ...aiSettings, baseUrl: event.target.value })
            }
          />
        </label>
        <label className="settings-field-row">
          <span>模型名称</span>
          <input
            value={aiSettings.model}
            onChange={(event) =>
              setAiSettings({ ...aiSettings, model: event.target.value })
            }
          />
        </label>
        <label className="settings-field-row">
          <span>API Key</span>
          <span className="settings-password-field">
            <input
              type={showApiKey ? "text" : "password"}
              value={aiSettings.apiKey}
              onChange={(event) =>
                setAiSettings({ ...aiSettings, apiKey: event.target.value })
              }
            />
            <button
              type="button"
              onClick={() => setShowApiKey((value) => !value)}
            >
              {showApiKey ? "隐藏" : "显示"}
            </button>
          </span>
        </label>

        <div className="ai-settings-actions" data-testid="ai-test-actions">
          <span className="ai-settings-status">
            <span className={`ai-settings-dot ${aiFeedback?.type ?? ""}`} aria-hidden="true" />
            连接状态：
            <span
              className={`${aiFeedback?.type ?? ""} ai-settings-message`}
              data-testid="ai-test-message"
            >
              {aiFeedback?.message ?? "未测试"}
            </span>
          </span>
          <div className="ai-settings-buttons">
            <button className="secondary-action" onClick={checkAiConnection}>
              测试 AI 连接
            </button>
            <button className="primary-action" onClick={saveAiSettings}>
              保存 AI 设置
            </button>
          </div>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-icon" aria-hidden="true">⌘</span>
          <div>
            <h2>SSH 隧道设置</h2>
            <p>配置 ssh.exe 路径，用于启动本地端口转发隧道。</p>
          </div>
        </div>

        <label className="settings-field-row">
          <span>SSH 程序路径</span>
          <span className="settings-path-field">
            <input
              aria-label="SSH 程序路径"
              placeholder="未配置时自动检测 PATH 中的 ssh.exe"
              value={sshSettings.sshExecutablePath ?? ""}
              onChange={(event) =>
                setSshSettings({
                  ...sshSettings,
                  sshExecutablePath: event.target.value,
                })
              }
            />
            <button type="button" onClick={chooseSshExecutable}>
              选择 SSH 程序
            </button>
          </span>
        </label>

        <div className="ai-settings-actions">
          <span className="settings-muted">
            留空时启动隧道会自动查找 PATH 中的 ssh.exe。
          </span>
          <div className="ai-settings-buttons">
            <button className="primary-action" onClick={saveSshSettings}>
              保存 SSH 设置
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "操作失败。";
}
