import { useEffect, useMemo, useState } from "react";
import type { Reminder } from "../types";

interface Props {
  reminders: Reminder[];
  onAdd: () => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}

export function ReminderList({
  reminders,
  onAdd,
  onToggle,
  onDelete,
}: Props) {
  const [activeFilter, setActiveFilter] = useState<"current" | "completed">(
    "current",
  );
  const [query, setQuery] = useState("");
  const currentReminders = useMemo(
    () => reminders.filter((reminder) => reminder.status === "pending"),
    [reminders],
  );
  const completedReminders = useMemo(
    () => reminders.filter((reminder) => reminder.status !== "pending"),
    [reminders],
  );
  const visibleReminders = useMemo(() => {
    const source =
      activeFilter === "current" ? currentReminders : completedReminders;
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return source;
    }
    return source.filter((reminder) =>
      [
        reminder.title,
        reminder.notes ?? "",
        repeatRuleLabel(reminder.repeatRule),
        statusLabel(reminder.status),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [activeFilter, completedReminders, currentReminders, query]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedReminder =
    visibleReminders.find((reminder) => reminder.id === selectedId) ??
    visibleReminders[0] ??
    null;
  const emptyListMessage = query.trim()
    ? "没有找到匹配的提醒。"
    : activeFilter === "current"
      ? "当前没有提醒。"
      : "还没有已完成提醒。";

  useEffect(() => {
    setSelectedId((current) => {
      if (current && visibleReminders.some((reminder) => reminder.id === current)) {
        return current;
      }
      return visibleReminders[0]?.id ?? null;
    });
  }, [visibleReminders]);

  return (
    <section className="reminder-panel">
      <aside className="reminder-filters" aria-label="提醒筛选">
        <button
          aria-label={`当前提醒 ${currentReminders.length}`}
          className={activeFilter === "current" ? "active" : ""}
          onClick={() => setActiveFilter("current")}
        >
          <span>当前提醒</span>
          <strong>{currentReminders.length}</strong>
        </button>
        <button
          aria-label={`已完成提醒 ${completedReminders.length}`}
          className={activeFilter === "completed" ? "active" : ""}
          onClick={() => setActiveFilter("completed")}
        >
          <span>已完成提醒</span>
          <strong>{completedReminders.length}</strong>
        </button>
      </aside>

      <div className="reminder-workspace">
        <div className="reminder-toolbar">
          <label className="sr-only" htmlFor="reminder-search">
            搜索提醒
          </label>
          <input
            id="reminder-search"
            placeholder="搜索提醒名称、备注或规则"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="primary-action" onClick={onAdd}>
            新增提醒
          </button>
        </div>

        <div className="reminder-content">
          <div className="reminder-list" aria-label="提醒列表">
            {visibleReminders.length === 0 ? (
              <div className="reminder-list-empty">
                {emptyListMessage}
              </div>
            ) : null}
            {visibleReminders.map((reminder) => (
              <button
                aria-label={reminder.title}
                aria-pressed={selectedReminder?.id === reminder.id}
                className={`reminder-row ${
                  selectedReminder?.id === reminder.id ? "selected" : ""
                }`}
                key={reminder.id}
                onClick={() => setSelectedId(reminder.id)}
              >
                <span>
                  <strong>{reminder.title}</strong>
                  <span>
                    {formatTime(reminder.remindAt)} ·{" "}
                    {repeatRuleLabel(reminder.repeatRule)}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <aside className="reminder-detail" aria-label="提醒详情">
            {selectedReminder ? (
              <ReminderDetail
                reminder={selectedReminder}
                onDelete={onDelete}
                onToggle={onToggle}
              />
            ) : (
              <div className="reminder-detail-empty">
                <h3>选择一个提醒</h3>
                <p className="muted">左侧列表没有可显示的提醒。</p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}

function ReminderDetail({
  reminder,
  onToggle,
  onDelete,
}: {
  reminder: Reminder;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <>
      <div className="reminder-detail-header">
        <span className={`status status-${reminder.status}`}>
          {statusLabel(reminder.status)}
        </span>
        <span className={reminder.enabled ? "enabled" : "disabled"}>
          {reminder.enabled ? "已启用" : "已停用"}
        </span>
      </div>
      <h2>{reminder.title}</h2>
      <dl className="reminder-detail-list">
        <div>
          <dt>下次触发</dt>
          <dd>{formatTime(reminder.remindAt)}</dd>
        </div>
        <div>
          <dt>重复规则</dt>
          <dd>{repeatRuleLabel(reminder.repeatRule)}</dd>
        </div>
        {reminder.triggeredAt ? (
          <div>
            <dt>完成时间</dt>
            <dd>{formatTime(reminder.triggeredAt)}</dd>
          </div>
        ) : null}
      </dl>
      <div className="reminder-notes">
        <h3>备注</h3>
        <p>{reminder.notes || "没有备注。"}</p>
      </div>
      <div className="reminder-detail-actions">
        <button
          onClick={() => onToggle(reminder.id, !reminder.enabled)}
          disabled={reminder.status !== "pending"}
          aria-label={`${reminder.enabled ? "停用" : "启用"} ${reminder.title}`}
        >
          {reminder.enabled ? "停用" : "启用"}
        </button>
        <button
          className="danger-action"
          onClick={() => onDelete(reminder.id)}
          aria-label={`删除 ${reminder.title}`}
        >
          删除
        </button>
      </div>
    </>
  );
}

function repeatRuleLabel(rule: Reminder["repeatRule"]) {
  switch (rule) {
    case "once":
      return "单次提醒";
    case "daily":
      return "每天";
    case "cn_workday":
      return "中国法定工作日";
    default:
      if (rule.startsWith("weekly:")) {
        const days = rule
          .replace("weekly:", "")
          .split(",")
          .map((day) => WEEKDAY_LABELS[day])
          .filter(Boolean)
          .join("、");
        return days ? `每周 ${days}` : "每周";
      }
      return "重复提醒";
  }
}

const WEEKDAY_LABELS: Record<string, string> = {
  "1": "周一",
  "2": "周二",
  "3": "周三",
  "4": "周四",
  "5": "周五",
  "6": "周六",
  "7": "周日",
};

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
