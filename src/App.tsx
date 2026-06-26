import { useEffect, useState } from "react";
import "./styles.css";
import { AddReminderDialog } from "./components/AddReminderDialog";
import { DownloadPanel } from "./components/DownloadPanel";
import { NetworkDiagnosticsPanel } from "./components/NetworkDiagnosticsPanel";
import { ReminderList } from "./components/ReminderList";
import { ReminderWindow } from "./components/ReminderWindow";
import { SettingsPanel } from "./components/SettingsPanel";
import { ScriptTasksPanel } from "./components/ScriptTasksPanel";
import { SshTunnelsPanel } from "./components/SshTunnelsPanel";
import { SystemMonitorPanel } from "./components/SystemMonitorPanel";
import { TranslationPanel } from "./components/TranslationPanel";
import { UtilitiesPanel } from "./components/UtilitiesPanel";
import { WindowControls } from "./components/WindowControls";
import { WorkbenchHome } from "./components/WorkbenchHome";
import {
  createReminder,
  deleteReminder,
  listScriptTasks,
  listReminders,
  updateReminder,
} from "./lib/api";
import { onReminderTriggered } from "./lib/events";
import type { NewReminder, Reminder, ScriptTask } from "./types";
import { APP_VERSION } from "./version";

type View =
  | "home"
  | "reminders"
  | "translation"
  | "network"
  | "ssh"
  | "download"
  | "system"
  | "scripts"
  | "utilities"
  | "settings";

type NavIcon =
  | "grid"
  | "bell"
  | "language"
  | "globe"
  | "terminal"
  | "download"
  | "activity"
  | "code"
  | "toolbox"
  | "settings";

const NAV_ITEMS: Array<{ view: View; label: string; icon: NavIcon }> = [
  { view: "home", label: "工作台", icon: "grid" },
  { view: "reminders", label: "提醒", icon: "bell" },
  { view: "translation", label: "翻译", icon: "language" },
  { view: "network", label: "网络检测", icon: "globe" },
  { view: "ssh", label: "SSH 隧道", icon: "terminal" },
  { view: "download", label: "下载工具", icon: "download" },
  { view: "system", label: "系统监控", icon: "activity" },
  { view: "scripts", label: "脚本任务", icon: "code" },
  { view: "utilities", label: "实用工具", icon: "toolbox" },
  { view: "settings", label: "设置", icon: "settings" },
];

export default function App() {
  const reminderWindowId = getReminderWindowId();
  if (reminderWindowId) {
    return <ReminderWindow reminderId={reminderWindowId} />;
  }
  return <MainApp />;
}

function MainApp() {
  const [view, setView] = useState<View>("home");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [scriptTasks, setScriptTasks] = useState<ScriptTask[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setReminders(await listReminders());
  }

  async function refreshScriptTasks() {
    setScriptTasks(await listScriptTasks());
  }

  useEffect(() => {
    refresh().catch((err) => setError(readError(err)));
    refreshScriptTasks().catch((err) => setError(readError(err)));
    const unlisten = onReminderTriggered(() => {
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

  async function saveEditedReminder(input: NewReminder) {
    if (!editingReminder) {
      return;
    }
    try {
      await updateReminder(editingReminder.id, input);
      setEditingReminder(null);
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
      <div className="app-shell">
        <aside className="app-sidebar">
          <nav aria-label="功能导航">
            {NAV_ITEMS.map((item) => (
              <button
                aria-current={view === item.view ? "page" : undefined}
                className={view === item.view ? "active" : ""}
                key={item.view}
                onClick={() => setView(item.view)}
              >
                <NavIcon name={item.icon} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="app-sidebar-footer" aria-label="应用版本">
            <span>v{APP_VERSION}</span>
          </div>
        </aside>
        <main className={`app-main app-main-${view}`}>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          {view === "home" ? (
            <WorkbenchHome
              pendingReminderCount={
                reminders.filter(
                  (reminder) =>
                    reminder.enabled && reminder.status === "pending",
                ).length
              }
              enabledScriptTaskCount={
                scriptTasks.filter((task) => task.enabled).length
              }
              runningScriptTaskCount={
                scriptTasks.filter(
                  (task) => task.lastStartedAt && !task.lastFinishedAt,
                ).length
              }
              totalScriptTaskCount={scriptTasks.length}
              onOpenReminders={() => setView("reminders")}
              onAddReminder={() => {
                setView("reminders");
                setShowAdd(true);
              }}
              onOpenTranslation={() => setView("translation")}
              onOpenNetworkDiagnostics={() => setView("network")}
              onOpenSshTunnels={() => setView("ssh")}
              onOpenDownloader={() => setView("download")}
              onOpenSystemMonitor={() => setView("system")}
              onOpenScriptTasks={() => setView("scripts")}
              onOpenUtilities={() => setView("utilities")}
            />
          ) : null}
          {view === "reminders" ? (
            <ReminderList
              reminders={reminders}
              onAdd={() => setShowAdd(true)}
              onEdit={setEditingReminder}
              onDelete={remove}
            />
          ) : null}
          {view === "translation" ? (
            <TranslationPanel onOpenSettings={() => setView("settings")} />
          ) : null}
          {view === "network" ? (
            <NetworkDiagnosticsPanel />
          ) : null}
          {view === "ssh" ? (
            <SshTunnelsPanel />
          ) : null}
          {view === "download" ? (
            <DownloadPanel />
          ) : null}
          {view === "system" ? (
            <SystemMonitorPanel />
          ) : null}
          {view === "scripts" ? (
            <ScriptTasksPanel />
          ) : null}
          {view === "utilities" ? (
            <UtilitiesPanel />
          ) : null}
          {view === "settings" ? (
            <SettingsPanel />
          ) : null}
          {showAdd ? (
            <AddReminderDialog
              onCancel={() => setShowAdd(false)}
              onSave={saveReminder}
            />
          ) : null}
          {editingReminder ? (
            <AddReminderDialog
              reminder={editingReminder}
              onCancel={() => setEditingReminder(null)}
              onSave={saveEditedReminder}
            />
          ) : null}
        </main>
      </div>
    </>
  );
}

function getReminderWindowId() {
  return new URLSearchParams(window.location.search).get("reminderId");
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "操作失败。";
}

function NavIcon({ name }: { name: NavIcon }) {
  const paths: Record<NavIcon, string[]> = {
    grid: [
      "M4 5.5A1.5 1.5 0 0 1 5.5 4h3A1.5 1.5 0 0 1 10 5.5v3A1.5 1.5 0 0 1 8.5 10h-3A1.5 1.5 0 0 1 4 8.5v-3Z",
      "M14 5.5A1.5 1.5 0 0 1 15.5 4h3A1.5 1.5 0 0 1 20 5.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 14 8.5v-3Z",
      "M4 15.5A1.5 1.5 0 0 1 5.5 14h3a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3Z",
      "M14 15.5a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3a1.5 1.5 0 0 1-1.5-1.5v-3Z",
    ],
    bell: [
      "M6 17h12l-1.6-2.4V10a4.4 4.4 0 0 0-3.4-4.3V5a1 1 0 1 0-2 0v.7A4.4 4.4 0 0 0 7.6 10v4.6L6 17Z",
      "M10 19a2 2 0 0 0 4 0",
    ],
    language: [
      "M5 6h8",
      "M9 4v2",
      "M7 6c.7 2.9 2.5 5.2 5 6.8",
      "M12 6c-.7 2.8-2.6 5.1-6 7",
      "M13 20l4-9 4 9",
      "M14.5 17h5",
    ],
    globe: [
      "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
      "M3.6 9h16.8",
      "M3.6 15h16.8",
      "M12 3c2.2 2.4 3.2 5.4 3.2 9S14.2 18.6 12 21",
      "M12 3C9.8 5.4 8.8 8.4 8.8 12s1 6.6 3.2 9",
    ],
    terminal: ["m5 7 5 5-5 5", "M12 17h7"],
    download: [
      "M12 4v10",
      "m8 10 4 4 4-4",
      "M5 18h14",
      "M6 14v4",
      "M18 14v4",
    ],
    activity: [
      "M4 13h4l2-7 4 12 2-5h4",
      "M5 20h14",
    ],
    code: [
      "m9 7-5 5 5 5",
      "m15 7 5 5-5 5",
      "M13 5l-2 14",
    ],
    toolbox: [
      "M9 6V4.8A1.8 1.8 0 0 1 10.8 3h2.4A1.8 1.8 0 0 1 15 4.8V6",
      "M4 8.5A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z",
      "M4 11h16",
      "M10 11v2h4v-2",
    ],
    settings: [
      "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
      "M19 13.5v-3l-2-.4a6.8 6.8 0 0 0-.7-1.7l1.1-1.7-2.1-2.1-1.7 1.1c-.5-.3-1.1-.5-1.7-.7L10.5 2h-3l-.4 2c-.6.2-1.2.4-1.7.7L3.7 3.6 1.6 5.7l1.1 1.7c-.3.5-.5 1.1-.7 1.7l-2 .4v3l2 .4c.2.6.4 1.2.7 1.7l-1.1 1.7 2.1 2.1 1.7-1.1c.5.3 1.1.5 1.7.7l.4 2h3l.4-2c.6-.2 1.2-.4 1.7-.7l1.7 1.1 2.1-2.1-1.1-1.7c.3-.5.5-1.1.7-1.7l2-.4Z",
    ],
  };

  return (
    <svg
      aria-hidden="true"
      className="nav-icon"
      viewBox="0 0 24 24"
    >
      {paths[name].map((path) => (
        <path d={path} key={path} />
      ))}
    </svg>
  );
}
