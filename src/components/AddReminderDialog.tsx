import { type FormEvent, useState } from "react";
import type { NewReminder, ReminderRepeatRule } from "../types";

interface Props {
  onCancel: () => void;
  onSave: (input: NewReminder) => void;
}

export function AddReminderDialog({ onCancel, onSave }: Props) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [remindAt, setRemindAt] = useState("");
  const [repeatTime, setRepeatTime] = useState("");
  const [repeatRule, setRepeatRule] = useState("once");
  const [weeklyDays, setWeeklyDays] = useState<number[]>([]);
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
    if (repeatRule === "weekly" && weeklyDays.length === 0) {
      setError("请选择至少一个星期几。");
      return;
    }
    const resolvedRepeatRule: ReminderRepeatRule =
      repeatRule === "weekly"
        ? `weekly:${[...weeklyDays].sort((a, b) => a - b).join(",")}`
        : (repeatRule as ReminderRepeatRule);
    onSave({
      title: title.trim(),
      notes: notes.trim() || null,
      remindAt: date.toISOString(),
      repeatRule: resolvedRepeatRule,
    });
  }

  function toggleWeeklyDay(day: number) {
    setWeeklyDays((current) =>
      current.includes(day)
        ? current.filter((value) => value !== day)
        : [...current, day],
    );
  }

  return (
    <div className="modal-backdrop">
      <form className="modal reminder-modal" onSubmit={submit}>
        <div className="modal-title">
          <p className="eyebrow">提醒信息</p>
          <h2>新增提醒</h2>
        </div>
        {error ? <p className="error">{error}</p> : null}
        <div className="modal-field-grid">
          <label className="wide-field">
            标题
            <input
              placeholder="例如：每周例会提醒"
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
              <option value="weekly">每周</option>
              <option value="cn_workday">中国法定工作日</option>
            </select>
          </label>
          <label className="wide-field">
            备注
            <textarea
              placeholder="可选，写一点上下文"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </div>
        {repeatRule === "weekly" ? (
          <fieldset className="weekday-picker">
            <legend>选择周几</legend>
            {WEEKDAYS.map((day) => (
              <label
                className={weeklyDays.includes(day.value) ? "selected" : ""}
                key={day.value}
              >
                <input
                  type="checkbox"
                  checked={weeklyDays.includes(day.value)}
                  onChange={() => toggleWeeklyDay(day.value)}
                />
                {day.label}
              </label>
            ))}
          </fieldset>
        ) : null}
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

const WEEKDAYS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 7, label: "周日" },
];

function nextDateFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  if (date.getTime() <= Date.now()) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}
