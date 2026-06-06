import { useEffect, useState } from "react";
import { getSettings, testNotification, updateSettings } from "../lib/api";
import type { Settings } from "../types";

export function SettingsPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then(setSettings)
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

  if (!settings) {
    return <p>Loading settings...</p>;
  }

  return (
    <section className="settings-panel">
      <h2>Settings</h2>
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
        Launch on startup
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.minimizeToTray}
          onChange={(event) => patch({ minimizeToTray: event.target.checked })}
        />
        Minimize to tray
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.notificationEnabled}
          onChange={(event) =>
            patch({ notificationEnabled: event.target.checked })
          }
        />
        System notifications
      </label>
      <button onClick={() => testNotification().catch((err) => setError(readError(err)))}>
        Test notification
      </button>
    </section>
  );
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "Operation failed.";
}
