import { useEffect, useState } from "react";
import {
  getAiSettings,
  getSettings,
  testAiConnection,
  testNotification,
  updateAiSettings,
  updateSettings,
} from "../lib/api";
import type { AiSettings, Settings } from "../types";

interface Props {
  onAiSettingsLoaded?: (settings: AiSettings) => void;
}

export function SettingsPanel({ onAiSettingsLoaded }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiMessage, setAiMessage] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((err) => setError(readError(err)));
    getAiSettings()
      .then((settings) => {
        setAiSettings(settings);
        onAiSettingsLoaded?.(settings);
      })
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
    setAiMessage(null);
    try {
      const saved = await updateAiSettings(aiSettings);
      setAiSettings(saved);
      onAiSettingsLoaded?.(saved);
      setAiMessage("AI 设置已保存。");
    } catch (err) {
      setError(readError(err));
    }
  }

  async function checkAiConnection() {
    setError(null);
    setAiMessage(null);
    try {
      await testAiConnection();
      setAiMessage("AI 连接正常。");
    } catch (err) {
      setError(readError(err));
    }
  }

  if (!settings || !aiSettings) {
    return <p>正在加载设置...</p>;
  }

  return (
    <section className="settings-panel">
      <h2>设置</h2>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <label>
        <input
          type="checkbox"
          checked={settings.launchOnStartup}
          onChange={(event) => patch({ launchOnStartup: event.target.checked })}
        />
        开机自启动
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.minimizeToTray}
          onChange={(event) => patch({ minimizeToTray: event.target.checked })}
        />
        最小化到托盘
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.notificationEnabled}
          onChange={(event) =>
            patch({ notificationEnabled: event.target.checked })
          }
        />
        系统通知
      </label>
      <button onClick={() => testNotification().catch((err) => setError(readError(err)))}>
        测试通知
      </button>
      <div className="settings-divider" />
      <h3>AI 翻译设置</h3>
      {aiMessage ? <p className="success">{aiMessage}</p> : null}
      <label className="field-label">
        API 地址
        <input
          value={aiSettings.baseUrl}
          onChange={(event) =>
            setAiSettings({ ...aiSettings, baseUrl: event.target.value })
          }
        />
      </label>
      <label className="field-label">
        模型名称
        <input
          value={aiSettings.model}
          onChange={(event) =>
            setAiSettings({ ...aiSettings, model: event.target.value })
          }
        />
      </label>
      <label className="field-label">
        API Key
        <input
          type="password"
          value={aiSettings.apiKey}
          onChange={(event) =>
            setAiSettings({ ...aiSettings, apiKey: event.target.value })
          }
        />
      </label>
      <label className="field-label">
        默认目标语言
        <select
          value={aiSettings.defaultTargetLanguage}
          onChange={(event) =>
            setAiSettings({
              ...aiSettings,
              defaultTargetLanguage: event.target.value,
            })
          }
        >
          <option value="中文">中文</option>
          <option value="English">English</option>
          <option value="日本語">日本語</option>
          <option value="한국어">한국어</option>
          <option value="Français">Français</option>
          <option value="Deutsch">Deutsch</option>
        </select>
      </label>
      <div className="actions">
        <button onClick={checkAiConnection}>测试 AI 连接</button>
        <button onClick={saveAiSettings}>保存 AI 设置</button>
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
