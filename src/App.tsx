import { useEffect, useState } from "react";
import "./styles.css";
import { AddReminderDialog } from "./components/AddReminderDialog";
import { ReminderList } from "./components/ReminderList";
import { ReminderPopup } from "./components/ReminderPopup";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  createReminder,
  deleteReminder,
  listReminders,
  toggleReminder,
} from "./lib/api";
import { onReminderTriggered } from "./lib/events";
import type { NewReminder, Reminder } from "./types";

type Tab = "reminders" | "settings";

export default function App() {
  const [tab, setTab] = useState<Tab>("reminders");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [popup, setPopup] = useState<Reminder | null>(null);
  const [error, setError] = useState<string | null>(null);

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
            className={tab === "reminders" ? "active" : ""}
            onClick={() => setTab("reminders")}
          >
            提醒
          </button>
          <button
            className={tab === "settings" ? "active" : ""}
            onClick={() => setTab("settings")}
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
      {tab === "reminders" ? (
        <ReminderList
          reminders={reminders}
          onAdd={() => setShowAdd(true)}
          onToggle={changeEnabled}
          onDelete={remove}
        />
      ) : (
        <SettingsPanel />
      )}
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
