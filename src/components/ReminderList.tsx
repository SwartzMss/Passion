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
        <h2>No reminders yet</h2>
        <button onClick={onAdd}>Add reminder</button>
      </section>
    );
  }

  return (
    <section className="reminder-list">
      <div className="section-header">
        <h2>Reminders</h2>
        <button onClick={onAdd}>Add reminder</button>
      </div>
      {reminders.map((reminder) => (
        <article className="reminder-row" key={reminder.id}>
          <div>
            <h3>{reminder.title}</h3>
            <p>{formatTime(reminder.remindAt)}</p>
            {reminder.notes ? <p className="muted">{reminder.notes}</p> : null}
          </div>
          <span className={`status status-${reminder.status}`}>
            {reminder.status}
          </span>
          <button
            onClick={() => onToggle(reminder.id, !reminder.enabled)}
            disabled={reminder.status !== "pending"}
            aria-label={`${reminder.enabled ? "Disable" : "Enable"} ${reminder.title}`}
          >
            {reminder.enabled ? "Disable" : "Enable"}
          </button>
          <button
            onClick={() => onDelete(reminder.id)}
            aria-label={`Delete ${reminder.title}`}
          >
            Delete
          </button>
        </article>
      ))}
    </section>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
