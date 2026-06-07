import { useEffect, useState } from "react";
import "./styles.css";
import { AddReminderDialog } from "./components/AddReminderDialog";
import { ReminderList } from "./components/ReminderList";
import { ReminderPopup } from "./components/ReminderPopup";
import { SettingsPanel } from "./components/SettingsPanel";
import { TranslationPanel } from "./components/TranslationPanel";
import { WorkbenchHome } from "./components/WorkbenchHome";
import {
  createReminder,
  deleteReminder,
  listReminders,
  toggleReminder,
} from "./lib/api";
import { onReminderTriggered } from "./lib/events";
import type { NewReminder, Reminder } from "./types";

type View = "home" | "reminders" | "translation" | "settings";

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
    <main>
      <header className="app-header">
        <h1>Passion</h1>
        <nav>
          <button
            className={view === "home" ? "active" : ""}
            onClick={() => setView("home")}
          >
            工作台
          </button>
          <button
            className={view === "reminders" ? "active" : ""}
            onClick={() => setView("reminders")}
          >
            提醒
          </button>
          <button
            className={view === "translation" ? "active" : ""}
            onClick={() => setView("translation")}
          >
            翻译
          </button>
          <button
            className={view === "settings" ? "active" : ""}
            onClick={() => setView("settings")}
          >
            设置
          </button>
        </nav>
      </header>

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
          onOpenSettings={() => setView("settings")}
        />
      ) : null}
      {view === "reminders" ? (
        <ReminderList
          reminders={reminders}
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
      {view === "settings" ? (
        <SettingsPanel
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
  );
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "操作失败。";
}
