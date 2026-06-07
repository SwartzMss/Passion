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
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="提醒已触发"
      >
        <h2>{reminder.title}</h2>
        {reminder.notes ? <p>{reminder.notes}</p> : null}
        <p className="muted">
          {new Date(reminder.remindAt).toLocaleString("zh-CN")}
        </p>
        <button onClick={onClose}>知道了</button>
      </section>
    </div>
  );
}
