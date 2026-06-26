import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { listReminders } from "../../lib/api";
import type { Reminder } from "../../types";
import { ReminderPopup } from "./ReminderPopup";

interface Props {
  reminderId: string;
  onClose?: () => void;
}

export function ReminderWindow({ reminderId, onClose }: Props) {
  const [reminder, setReminder] = useState<Reminder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listReminders()
      .then((items) => {
        if (cancelled) {
          return;
        }
        setReminder(items.find((item) => item.id === reminderId) ?? null);
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(readError(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reminderId]);

  function closeWindow() {
    if (onClose) {
      onClose();
      return;
    }
    getCurrentWindow()
      .close()
      .catch((err) => console.error("failed to close reminder window", err));
  }

  return (
    <div className="reminder-window" data-testid="reminder-window">
      {error ? (
        <div className="reminder-window-message" role="alert">
          {error}
        </div>
      ) : null}
      {!error && loading ? (
        <div className="reminder-window-message">正在读取提醒...</div>
      ) : null}
      {!error && !loading && !reminder ? (
        <div className="reminder-window-message">提醒不存在或已被删除。</div>
      ) : null}
      <ReminderPopup reminder={reminder} onClose={closeWindow} />
    </div>
  );
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "读取提醒失败。";
}
