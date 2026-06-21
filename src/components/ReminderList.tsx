import { useMemo, useState } from "react";
import type { Reminder } from "../types";

interface Props {
  reminders: Reminder[];
  onAdd: () => void;
  onEdit: (reminder: Reminder) => void;
  onDelete: (id: string) => void;
}

export function ReminderList({
  reminders,
  onAdd,
  onEdit,
  onDelete,
}: Props) {
  const [activeFilter, setActiveFilter] = useState<
    "all" | "pending" | "completed"
  >(
    "pending",
  );
  const [query, setQuery] = useState("");
  const pendingReminders = useMemo(
    () => reminders.filter((reminder) => reminder.status === "pending"),
    [reminders],
  );
  const completedReminders = useMemo(
    () => reminders.filter((reminder) => reminder.status !== "pending"),
    [reminders],
  );
  const visibleReminders = useMemo(() => {
    const source =
      activeFilter === "all"
        ? reminders
        : activeFilter === "pending"
          ? pendingReminders
          : completedReminders;
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return source;
    }
    return source.filter((reminder) =>
      [
        reminder.title,
        repeatRuleLabel(reminder.repeatRule),
        statusLabel(reminder.status),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [activeFilter, completedReminders, pendingReminders, query, reminders]);
  const emptyListMessage = query.trim()
    ? "没有找到匹配的提醒。"
    : activeFilter === "completed"
      ? "还没有已完成提醒。"
      : "暂无提醒";

  return (
    <section className="reminder-panel">
      <header className="reminder-hero">
        <h1>提醒</h1>
        <p>管理一次性提醒、周期提醒和任务通知。</p>
      </header>

      <div className="reminder-filters" aria-label="提醒筛选" role="group">
        <FilterButton
          active={activeFilter === "all"}
          count={reminders.length}
          label="全部"
          onClick={() => setActiveFilter("all")}
        />
        <FilterButton
          active={activeFilter === "pending"}
          count={pendingReminders.length}
          label="待提醒"
          onClick={() => setActiveFilter("pending")}
        />
        <FilterButton
          active={activeFilter === "completed"}
          count={completedReminders.length}
          label="已完成"
          onClick={() => setActiveFilter("completed")}
        />
      </div>

      <div className="reminder-toolbar">
        <div className="reminder-search">
          <span aria-hidden="true" className="reminder-search-icon">
            <svg viewBox="0 0 24 24">
              <path d="M10.5 5a5.5 5.5 0 0 1 4.4 8.8l3.6 3.6-1.1 1.1-3.6-3.6A5.5 5.5 0 1 1 10.5 5Zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
            </svg>
          </span>
          <label className="sr-only" htmlFor="reminder-search">
            搜索提醒
          </label>
          <input
            id="reminder-search"
            placeholder="搜索提醒名称或重复规则"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <button className="primary-action reminder-add-action" onClick={onAdd}>
          <span aria-hidden="true">+</span>
          新增提醒
        </button>
      </div>

      <div className="reminder-content reminder-content-single">
        <section className="reminder-card" aria-label="提醒列表">
          <div className="reminder-list" aria-label="提醒条目列表">
            {visibleReminders.length === 0 ? (
              <div className="reminder-list-empty">
                <div className="reminder-empty-illustration reminder-empty-bell">
                  <svg aria-hidden="true" viewBox="0 0 64 64">
                    <path d="M18 44h28l-3-5V28c0-7-4-12-10-13V12a3 3 0 0 0-6 0v3c-6 1-10 6-10 13v11l-3 5Z" />
                    <path d="M27 48a5 5 0 0 0 10 0" />
                  </svg>
                </div>
                <h3>{emptyListMessage}</h3>
              </div>
            ) : null}
            {visibleReminders.length > 0 ? (
              <>
                <div className="reminder-table-scroll">
                  <table className="reminder-table">
                    <thead>
                      <tr>
                        <th scope="col">名称</th>
                        <th scope="col">类型</th>
                        <th scope="col">优先级</th>
                        <th scope="col">下次触发时间</th>
                        <th scope="col">状态</th>
                        <th scope="col">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleReminders.map((reminder) => (
                        <tr key={reminder.id}>
                          <td>
                            <div className="reminder-name-cell">
                              <strong>{reminder.title}</strong>
                            </div>
                          </td>
                          <td>
                            <span className={`repeat-badge repeat-${repeatKind(reminder.repeatRule)}`}>
                              {repeatRuleLabel(reminder.repeatRule)}
                            </span>
                          </td>
                          <td>
                            <span className={`priority-badge priority-${reminder.priority}`}>
                              {priorityLabel(reminder.priority)}
                            </span>
                          </td>
                          <td>{formatTime(reminder.remindAt)}</td>
                          <td>
                            <span className={`status status-${reminder.status}`}>
                              {statusLabel(reminder.status)}
                            </span>
                          </td>
                          <td>
                            <div className="reminder-table-actions">
                              <button
                                onClick={() => onEdit(reminder)}
                                aria-label={`编辑 ${reminder.title}`}
                              >
                                编辑
                              </button>
                              <button
                                className="danger-action"
                                onClick={() => onDelete(reminder.id)}
                                aria-label={`删除 ${reminder.title}`}
                              >
                                删除
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="reminder-table-footer">
                  <span>共 {visibleReminders.length} 条</span>
                  <div className="reminder-table-pager" aria-label="分页">
                    <button aria-label="上一页" disabled>
                      ‹
                    </button>
                    <strong>1</strong>
                    <button aria-label="下一页" disabled>
                      ›
                    </button>
                    <span>20条/页</span>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}

function FilterButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={`${label} ${count}`}
      className={active ? "active" : ""}
      onClick={onClick}
    >
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
  );
}

function repeatRuleLabel(rule: Reminder["repeatRule"]) {
  switch (rule) {
    case "once":
      return "一次性";
    case "daily":
      return "每天";
    case "cn_workday":
      return "法定工作日";
  }
}

function repeatKind(rule: Reminder["repeatRule"]) {
  return rule;
}

function priorityLabel(priority: Reminder["priority"]) {
  switch (priority) {
    case "low":
      return "低";
    case "medium":
      return "中";
    case "high":
      return "高";
  }
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
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
