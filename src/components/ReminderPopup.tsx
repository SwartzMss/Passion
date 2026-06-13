import type { Reminder } from "../types";

interface Props {
  reminder: Reminder | null;
  onClose: () => void;
}

export function ReminderPopup({ reminder, onClose }: Props) {
  if (!reminder) {
    return null;
  }

  return (
    <div className="reminder-toast-layer">
      <section
        className="reminder-toast"
        role="dialog"
        aria-label="提醒"
      >
        <div className="reminder-toast-icon" aria-hidden="true">
          <span />
        </div>
        <button
          aria-label="关闭提醒"
          className="reminder-toast-close"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
        <div className="reminder-toast-content">
          <h2>{reminder.title}</h2>
          <p>{formatReminderTime(reminder.remindAt)}</p>
          {reminder.notes ? <small>{reminder.notes}</small> : null}
        </div>
        <button className="reminder-toast-complete" onClick={onClose} type="button">
          完成
        </button>
      </section>
    </div>
  );
}

function formatReminderTime(value: string) {
  const date = new Date(value);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  if (sameDay) {
    return `今天 ${time}`;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
