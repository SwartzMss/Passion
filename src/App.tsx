import { useEffect, useState } from "react";
import "./styles.css";
import { AddReminderDialog } from "./components/AddReminderDialog";
import { DownloadPanel } from "./components/DownloadPanel";
import { NetworkDiagnosticsPanel } from "./components/NetworkDiagnosticsPanel";
import { ReminderList } from "./components/ReminderList";
import { ReminderPopup } from "./components/ReminderPopup";
import { SettingsPanel } from "./components/SettingsPanel";
import { ScriptTasksPanel } from "./components/ScriptTasksPanel";
import { SystemMonitorPanel } from "./components/SystemMonitorPanel";
import { TranslationPanel } from "./components/TranslationPanel";
import { WindowControls } from "./components/WindowControls";
import { WorkbenchHome } from "./components/WorkbenchHome";
import {
  createReminder,
  deleteReminder,
  listReminders,
  toggleReminder,
} from "./lib/api";
import { onReminderTriggered } from "./lib/events";
import type { NewReminder, Reminder } from "./types";

type View =
  | "home"
  | "reminders"
  | "translation"
  | "network"
  | "download"
  | "system"
  | "scripts"
  | "settings";

export default function App() {
  const [view, setView] = useState<View>("home");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [popup, setPopup] = useState<Reminder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [defaultTargetLanguage, setDefaultTargetLanguage] = useState("中文");

  async function refresh() {
    setReminders(await listReminders());
  }

  useEffect(() => {
    refresh().catch((err) => setError(readError(err)));
    const unlisten = onReminderTriggered((reminder) => {
      setPopup(reminder);
      refresh().catch((err) => setError(readError(err)));
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  async function saveReminder(input: NewReminder) {
    try {
      await createReminder(input);
      setShowAdd(false);
      await refresh();
    } catch (err) {
      setError(readError(err));
    }
  }

  async function changeEnabled(id: string, enabled: boolean) {
    try {
      await toggleReminder(id, enabled);
      await refresh();
    } catch (err) {
      setError(readError(err));
    }
  }

  async function remove(id: string) {
    try {
      await deleteReminder(id);
      await refresh();
    } catch (err) {
      setError(readError(err));
    }
  }

  return (
    <>
      <WindowControls />
      <main>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {view === "home" ? (
          <WorkbenchHome
            pendingReminderCount={
              reminders.filter(
                (reminder) => reminder.enabled && reminder.status === "pending",
              ).length
            }
            onOpenReminders={() => setView("reminders")}
            onAddReminder={() => {
              setView("reminders");
              setShowAdd(true);
            }}
            onOpenTranslation={() => setView("translation")}
            onOpenNetworkDiagnostics={() => setView("network")}
            onOpenDownloader={() => setView("download")}
            onOpenSystemMonitor={() => setView("system")}
            onOpenScriptTasks={() => setView("scripts")}
            onOpenSettings={() => setView("settings")}
          />
        ) : null}
        {view === "reminders" ? (
          <ReminderList
            reminders={reminders}
            onBack={() => setView("home")}
            onAdd={() => setShowAdd(true)}
            onToggle={changeEnabled}
            onDelete={remove}
          />
        ) : null}
        {view === "translation" ? (
          <TranslationPanel
            defaultTargetLanguage={defaultTargetLanguage}
            onBack={() => setView("home")}
            onOpenSettings={() => setView("settings")}
          />
        ) : null}
        {view === "network" ? (
          <NetworkDiagnosticsPanel onBack={() => setView("home")} />
        ) : null}
        {view === "download" ? (
          <DownloadPanel onBack={() => setView("home")} />
        ) : null}
        {view === "system" ? (
          <SystemMonitorPanel onBack={() => setView("home")} />
        ) : null}
        {view === "scripts" ? (
          <ScriptTasksPanel onBack={() => setView("home")} />
        ) : null}
        {view === "settings" ? (
          <SettingsPanel
            onBack={() => setView("home")}
            onAiSettingsLoaded={(settings) =>
              setDefaultTargetLanguage(settings.defaultTargetLanguage)
            }
          />
        ) : null}
        {showAdd ? (
          <AddReminderDialog
            onCancel={() => setShowAdd(false)}
            onSave={saveReminder}
          />
        ) : null}
        <ReminderPopup reminder={popup} onClose={() => setPopup(null)} />
      </main>
    </>
  );
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "操作失败。";
}
