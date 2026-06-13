import { type FormEvent, useState } from "react";
import type { NewReminder, Reminder, ReminderRepeatRule } from "../types";

interface Props {
  reminder?: Reminder | null;
  onCancel: () => void;
  onSave: (input: NewReminder) => void;
}

export function AddReminderDialog({ reminder, onCancel, onSave }: Props) {
  const initialRepeatRule = parseRepeatRule(reminder?.repeatRule);
  const [title, setTitle] = useState(reminder?.title ?? "");
  const [remindAt, setRemindAt] = useState(
    reminder ? toDatetimeLocalValue(reminder.remindAt) : "",
  );
  const [repeatTime, setRepeatTime] = useState(
    reminder ? toTimeValue(reminder.remindAt) : "",
  );
  const [priority, setPriority] = useState(reminder?.priority ?? "medium");
  const [repeatRule, setRepeatRule] = useState(initialRepeatRule.kind);
  const [error, setError] = useState<string | null>(null);
  const isRepeating = repeatRule !== "once";

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setError("请输入提醒标题。");
      return;
    }
    const timeValue = isRepeating ? repeatTime : remindAt;
    if (!timeValue) {
      setError("请选择提醒时间。");
      return;
    }
    const date = isRepeating
      ? nextDateFromTime(repeatTime)
      : new Date(remindAt);
    if (date.getTime() <= Date.now()) {
      setError("提醒时间必须晚于当前时间。");
      return;
    }
    onSave({
      title: title.trim(),
      notes: null,
      remindAt: date.toISOString(),
      priority,
      repeatRule: repeatRule as ReminderRepeatRule,
    });
  }

  return (
    <div className="modal-backdrop">
      <form className="modal reminder-modal" onSubmit={submit}>
        <div className="modal-title">
          <p className="eyebrow">提醒信息</p>
          <h2>{reminder ? "编辑提醒" : "新增提醒"}</h2>
        </div>
        {error ? <p className="error">{error}</p> : null}
        <div className="modal-field-grid">
          <label className="wide-field">
            标题
            <input
              placeholder="例如：喝水提醒"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {isRepeating ? (
            <label>
              提醒时间
              <input
                type="time"
                value={repeatTime}
                onChange={(event) => setRepeatTime(event.target.value)}
              />
            </label>
          ) : (
            <label>
              日期和时间
              <input
                type="datetime-local"
                value={remindAt}
                onChange={(event) => setRemindAt(event.target.value)}
              />
            </label>
          )}
          <label>
            重复规则
            <select
              value={repeatRule}
              onChange={(event) => setRepeatRule(event.target.value)}
            >
              <option value="once">单次提醒</option>
              <option value="daily">每天</option>
              <option value="cn_workday">中国法定工作日</option>
            </select>
          </label>
          <label>
            优先级
            <select
              value={priority}
              onChange={(event) =>
                setPriority(event.target.value as "low" | "medium" | "high")
              }
            >
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button className="primary-action" type="submit">
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

function nextDateFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  if (date.getTime() <= Date.now()) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

function parseRepeatRule(rule?: ReminderRepeatRule) {
  if (!rule) {
    return { kind: "once" };
  }
  if (rule.startsWith("weekly:")) {
    return { kind: "daily" };
  }
  return { kind: rule };
}

function toDatetimeLocalValue(value: string) {
  const date = new Date(value);
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

function toTimeValue(value: string) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}
