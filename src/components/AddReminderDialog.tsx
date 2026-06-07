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
  const [repeatRule, setRepeatRule] = useState("once");
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setError("请输入提醒标题。");
      return;
    }
    if (!remindAt) {
      setError("请选择提醒时间。");
      return;
    }
    const date = new Date(remindAt);
    if (date.getTime() <= Date.now()) {
      setError("提醒时间必须晚于当前时间。");
      return;
    }
    onSave({
      title: title.trim(),
      notes: notes.trim() || null,
      remindAt: date.toISOString(),
      repeatRule: repeatRule as "once" | "cn_workday",
    });
  }

  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <h2>新增提醒</h2>
        {error ? <p className="error">{error}</p> : null}
        <label>
          标题
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          备注
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        <label>
          日期和时间
          <input
            type="datetime-local"
            value={remindAt}
            onChange={(event) => setRemindAt(event.target.value)}
          />
        </label>
        <label>
          重复规则
          <select
            value={repeatRule}
            onChange={(event) => setRepeatRule(event.target.value)}
          >
            <option value="once">单次提醒</option>
            <option value="cn_workday">中国法定工作日</option>
          </select>
        </label>
        <div className="actions">
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button type="submit">保存</button>
        </div>
      </form>
    </div>
  );
}
