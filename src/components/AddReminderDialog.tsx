import { type FormEvent, useState } from "react";
import type { NewReminder } from "../types";

interface Props {
  onCancel: () => void;
  onSave: (input: NewReminder) => void;
}

export function AddReminderDialog({ onCancel, onSave }: Props) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [remindAt, setRemindAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (!remindAt) {
      setError("Date and time is required.");
      return;
    }
    const date = new Date(remindAt);
    if (date.getTime() <= Date.now()) {
      setError("Reminder time must be in the future.");
      return;
    }
    onSave({
      title: title.trim(),
      notes: notes.trim() || null,
      remindAt: date.toISOString(),
    });
  }

  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <h2>Add reminder</h2>
        {error ? <p className="error">{error}</p> : null}
        <label>
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          Notes
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        <label>
          Date and time
          <input
            type="datetime-local"
            value={remindAt}
            onChange={(event) => setRemindAt(event.target.value)}
          />
        </label>
        <div className="actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit">Save</button>
        </div>
      </form>
    </div>
  );
}
