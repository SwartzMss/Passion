import type { Reminder } from "../types";
import appIcon from "../../src-tauri/icons/32x32.png";

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
        data-tauri-drag-region
      >
        <header className="reminder-toast-header" data-tauri-drag-region>
          <div className="reminder-toast-brand" data-tauri-drag-region>
            <img src={appIcon} alt="" />
            <strong data-tauri-drag-region>Passion</strong>
          </div>
        </header>
        <div className="reminder-toast-body" data-tauri-drag-region>
          <div className="reminder-toast-icon" aria-hidden="true" data-tauri-drag-region>
            <AlarmIllustration />
          </div>
          <div className="reminder-toast-content" data-tauri-drag-region>
            <h2 data-tauri-drag-region>{reminder.title}</h2>
            <p data-tauri-drag-region>{formatReminderTime(reminder.remindAt)}</p>
            {reminder.notes ? <small>{reminder.notes}</small> : null}
          </div>
          <button className="reminder-toast-complete" onClick={onClose} type="button">
            完成
          </button>
        </div>
      </section>
    </div>
  );
}

function AlarmIllustration() {
  return (
    <svg viewBox="0 0 96 96" focusable="false">
      <circle className="alarm-bg" cx="48" cy="50" r="38" />
      <path className="alarm-bell-left" d="M25 24c6-8 15-10 23-5L30 35c-5-2-7-6-5-11Z" />
      <path className="alarm-bell-right" d="M71 24c-6-8-15-10-23-5l18 16c5-2 7-6 5-11Z" />
      <circle className="alarm-face" cx="48" cy="50" r="27" />
      <path className="alarm-face-ring" d="M48 28a22 22 0 1 1 0 44 22 22 0 0 1 0-44Z" />
      <path className="alarm-hand" d="M48 36v15l10 7" />
      <circle className="alarm-center" cx="48" cy="51" r="4" />
      <path className="alarm-leg" d="m35 76-5 8M61 76l5 8" />
      <path className="alarm-small-bell" d="M65 59c10 0 18 8 18 18v5H47v-5c0-10 8-18 18-18Z" />
      <path className="alarm-small-bell-clapper" d="M58 82h14" />
      <circle className="alarm-spark one" cx="18" cy="51" r="2.5" />
      <circle className="alarm-spark two" cx="80" cy="42" r="2.5" />
      <path className="alarm-spark three" d="M22 38v-5M19.5 35.5h5" />
      <path className="alarm-spark four" d="M77 59v-5M74.5 56.5h5" />
    </svg>
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
