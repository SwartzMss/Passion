import type { Reminder } from "../types";

interface Props {
  reminders: Reminder[];
  onAdd: () => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}

export function ReminderList({ reminders, onAdd, onToggle, onDelete }: Props) {
  if (reminders.length === 0) {
    return (
      <section className="empty-state">
        <h2>还没有提醒</h2>
        <button onClick={onAdd}>新增提醒</button>
      </section>
    );
  }

  return (
    <section className="reminder-list">
      <div className="section-header">
        <h2>提醒</h2>
        <button onClick={onAdd}>新增提醒</button>
      </div>
      {reminders.map((reminder) => (
        <article className="reminder-row" key={reminder.id}>
          <div>
            <h3>{reminder.title}</h3>
            <p>{formatTime(reminder.remindAt)}</p>
            {reminder.notes ? <p className="muted">{reminder.notes}</p> : null}
          </div>
          <span className={`status status-${reminder.status}`}>
            {statusLabel(reminder.status)}
          </span>
          <button
            onClick={() => onToggle(reminder.id, !reminder.enabled)}
            disabled={reminder.status !== "pending"}
            aria-label={`${reminder.enabled ? "停用" : "启用"} ${reminder.title}`}
          >
            {reminder.enabled ? "停用" : "启用"}
          </button>
          <button
            onClick={() => onDelete(reminder.id)}
            aria-label={`删除 ${reminder.title}`}
          >
            删除
          </button>
        </article>
      ))}
    </section>
  );
}

function statusLabel(status: Reminder["status"]) {
  switch (status) {
    case "pending":
      return "待提醒";
    case "triggered":
      return "已提醒";
    case "expired":
      return "已过期";
  }
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
