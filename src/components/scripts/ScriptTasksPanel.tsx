import { useEffect, useMemo, useRef, useState } from "react";
import {
  createScriptTask,
  deleteScriptTask,
  listScriptTasks,
  runScriptTaskNow,
  setScriptTaskEnabled,
} from "../../lib/api";
import type { ScriptTask, ScriptTaskScheduleType } from "../../types";

const WEEKDAYS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 7, label: "周日" },
];

type ScriptFilter = "all" | "running" | "waiting" | "disabled" | "failed";

export function ScriptTasksPanel() {
  const [tasks, setTasks] = useState<ScriptTask[]>([]);
  const [activeFilter, setActiveFilter] = useState<ScriptFilter>("all");
  const [query, setQuery] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [scriptPath, setScriptPath] = useState("");
  const [scheduleType, setScheduleType] =
    useState<ScriptTaskScheduleType>("interval");
  const [intervalMinutes, setIntervalMinutes] = useState("15");
  const [timeOfDay, setTimeOfDay] = useState("09:00");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function refresh() {
    setTasks(await listScriptTasks());
  }

  useEffect(() => {
    refresh().catch((err) => setError(readError(err)));
  }, []);

  const runningTasks = useMemo(() => tasks.filter(isRunningTask), [tasks]);
  const waitingTasks = useMemo(() => tasks.filter(isWaitingTask), [tasks]);
  const disabledTasks = useMemo(() => tasks.filter((task) => !task.enabled), [tasks]);
  const failedTasks = useMemo(() => tasks.filter(isFailedTask), [tasks]);
  const visibleTasks = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase();
    const filteredByStatus = tasks.filter((task) => {
      switch (activeFilter) {
        case "running":
          return isRunningTask(task);
        case "waiting":
          return isWaitingTask(task);
        case "disabled":
          return !task.enabled;
        case "failed":
          return isFailedTask(task);
        case "all":
          return true;
      }
    });
    if (!trimmedQuery) {
      return filteredByStatus;
    }
    return filteredByStatus.filter((task) =>
      [
        task.name,
        task.scriptPath,
        task.scriptArgs ?? "",
        scheduleLabel(task),
        scriptTaskStatusLabel(task),
      ]
        .join(" ")
        .toLowerCase()
        .includes(trimmedQuery),
    );
  }, [activeFilter, query, tasks]);
  const emptyListMessage = query.trim()
    ? "没有找到匹配的脚本任务。"
    : (() => {
    switch (activeFilter) {
      case "all":
        return "还没有脚本任务。";
      case "running":
        return "当前没有正在执行的脚本。";
      case "waiting":
        return "当前没有等待执行的脚本。";
      case "disabled":
        return "当前没有已停用的脚本。";
      case "failed":
        return "当前没有失败的脚本。";
    }
  })();

  const footerSummary = `总任务: ${tasks.length} | 运行中: ${runningTasks.length} | 等待执行: ${waitingTasks.length} | 已停用: ${disabledTasks.length} | 失败: ${failedTasks.length}`;

  async function createTask() {
    const trimmedName = name.trim();
    const trimmedCommand = scriptPath.trim();
    if (!trimmedName) {
      setError("任务名不能为空。");
      return;
    }
    if (!trimmedCommand) {
      setError("执行命令不能为空。");
      return;
    }
    const command = splitCommandLine(trimmedCommand);
    if (!command) {
      setError("执行命令中的引号未闭合。");
      return;
    }
    const interval =
      scheduleType === "interval" ? Number(intervalMinutes) : null;
    if (
      scheduleType === "interval" &&
      (!Number.isInteger(interval) || Number(interval) <= 0)
    ) {
        setError("执行间隔必须大于 0。");
        return;
    }
    if (scheduleType !== "interval" && !/^\d{2}:\d{2}$/.test(timeOfDay)) {
      setError("执行时间格式必须是 HH:mm。");
      return;
    }
    if (scheduleType === "weekly" && weekdays.length === 0) {
      setError("每周执行至少选择一天。");
      return;
    }

    setError(null);
    setIsBusy(true);
    try {
      await createScriptTask({
        name: trimmedName,
        scriptPath: command.program,
        scriptArgs: command.args.length > 0 ? command.args.join(" ") : null,
        scheduleType,
        intervalMinutes: scheduleType === "interval" ? Number(interval) : null,
        timeOfDay: scheduleType === "interval" ? null : timeOfDay,
        weekdays: scheduleType === "weekly" ? weekdays : null,
        enabled,
      });
      setName("");
      setScriptPath("");
      setScheduleType("interval");
      setIntervalMinutes("15");
      setTimeOfDay("09:00");
      setWeekdays([]);
      setEnabled(true);
      await refresh();
      setIsCreateOpen(false);
    } catch (err) {
      setError(readError(err));
    } finally {
      setIsBusy(false);
    }
  }

  async function runNow(id: string) {
    await mutate(async () => {
      await runScriptTaskNow(id);
    });
  }

  async function toggle(task: ScriptTask) {
    await mutate(async () => {
      await setScriptTaskEnabled(task.id, !task.enabled);
    });
  }

  async function remove(id: string) {
    await mutate(async () => {
      await deleteScriptTask(id);
    });
  }

  async function mutate(action: () => Promise<void>) {
    setError(null);
    setIsBusy(true);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(readError(err));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="script-panel">
      <div className="script-hero">
        <div>
          <h1>脚本任务</h1>
          <p className="muted">按固定间隔执行本机脚本，应用运行时生效。</p>
        </div>
      </div>

      {error && !isCreateOpen ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="script-list-toolbar script-toolbar-card">
        <div className="script-filters" aria-label="脚本任务筛选">
          <FilterButton
            active={activeFilter === "all"}
            count={tasks.length}
            label="全部"
            onClick={() => setActiveFilter("all")}
          />
          <FilterButton
            active={activeFilter === "running"}
            count={runningTasks.length}
            label="运行中"
            onClick={() => setActiveFilter("running")}
          />
          <FilterButton
            active={activeFilter === "waiting"}
            count={waitingTasks.length}
            label="等待执行"
            onClick={() => setActiveFilter("waiting")}
          />
          <FilterButton
            active={activeFilter === "disabled"}
            count={disabledTasks.length}
            label="已停用"
            onClick={() => setActiveFilter("disabled")}
          />
          <FilterButton
            active={activeFilter === "failed"}
            count={failedTasks.length}
            label="失败"
            onClick={() => setActiveFilter("failed")}
          />
        </div>
        <input
          aria-label="搜索脚本任务"
          placeholder="搜索任务名称或执行命令"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          className="primary-action script-open-create-button"
          onClick={() => {
            setError(null);
            setIsCreateOpen(true);
          }}
          type="button"
        >
          新增任务
        </button>
      </div>

      <div className="task-workspace">
        <div className="script-table-card">
          <div className="script-table-title">
            <h2>脚本任务列表</h2>
          </div>
          <div className="script-table-scroll">
            <table aria-label="脚本任务列表" className="script-table">
              <thead>
                <tr>
                  <th>任务名</th>
                  <th>执行方式</th>
                  <th>执行命令</th>
                  <th>下次执行</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleTasks.length === 0 ? (
                  <tr>
                    <td className="script-table-empty" colSpan={6}>
                      {emptyListMessage}
                    </td>
                  </tr>
                ) : null}
                {visibleTasks.map((task) => (
                  <ScriptTaskRow
                    isBusy={isBusy}
                    key={task.id}
                    onDelete={remove}
                    onRunNow={runNow}
                    onToggle={toggle}
                    task={task}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="script-status-bar">{footerSummary}</div>
        </div>
      </div>
      {isCreateOpen ? (
        <div className="modal-backdrop">
          <form
            aria-labelledby="script-create-title"
            className="modal script-task-modal"
            role="dialog"
            onSubmit={(event) => {
              event.preventDefault();
              void createTask();
            }}
          >
            <div className="modal-title">
              <span className="script-modal-title-icon" aria-hidden="true">
                &lt;/&gt;
              </span>
              <h2 id="script-create-title">新增脚本任务</h2>
              <button
                aria-label="关闭新增脚本任务"
                onClick={() => setIsCreateOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            {error ? <p className="error">{error}</p> : null}
            <ScriptTaskFormFields
              enabled={enabled}
              intervalMinutes={intervalMinutes}
              name={name}
              scheduleType={scheduleType}
              scriptPath={scriptPath}
              setEnabled={setEnabled}
              setIntervalMinutes={setIntervalMinutes}
              setName={setName}
              setScheduleType={setScheduleType}
              setScriptPath={setScriptPath}
              setTimeOfDay={setTimeOfDay}
              setWeekdays={setWeekdays}
              timeOfDay={timeOfDay}
              weekdays={weekdays}
            />
            <div className="modal-actions">
              <button onClick={() => setIsCreateOpen(false)} type="button">
                取消
              </button>
              <button className="primary-action" disabled={isBusy} type="submit">
                创建任务
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function ScriptTaskFormFields({
  enabled,
  intervalMinutes,
  name,
  scheduleType,
  scriptPath,
  setEnabled,
  setIntervalMinutes,
  setName,
  setScheduleType,
  setScriptPath,
  setTimeOfDay,
  setWeekdays,
  timeOfDay,
  weekdays,
}: {
  enabled: boolean;
  intervalMinutes: string;
  name: string;
  scheduleType: ScriptTaskScheduleType;
  scriptPath: string;
  setEnabled: (enabled: boolean) => void;
  setIntervalMinutes: (value: string) => void;
  setName: (value: string) => void;
  setScheduleType: (value: ScriptTaskScheduleType) => void;
  setScriptPath: (value: string) => void;
  setTimeOfDay: (value: string) => void;
  setWeekdays: (value: (current: number[]) => number[]) => void;
  timeOfDay: string;
  weekdays: number[];
}) {
  return (
    <div className="script-modal-fields">
      <label className="field-label">
        任务名称
        <input
          aria-label="任务名"
          placeholder="输入任务名称"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="field-label script-path-field">
        执行命令
        <span className="script-path-input">
          <textarea
            aria-label="执行命令"
            value={scriptPath}
            onChange={(event) => setScriptPath(event.target.value)}
            placeholder='例如："C:\Python\python.exe" "C:\tasks\backup.py"'
          />
        </span>
      </label>
      <label className="field-label">
        执行方式
        <select
          value={scheduleType}
          onChange={(event) =>
            setScheduleType(event.target.value as ScriptTaskScheduleType)
          }
        >
          <option value="interval">周期</option>
          <option value="daily">每天</option>
          <option value="weekly">每周</option>
        </select>
      </label>
      {scheduleType === "interval" ? (
        <label className="field-label compact-field">
          间隔时间
          <span className="script-interval-inputs">
            <input
              aria-label="间隔分钟数"
              inputMode="numeric"
              type="number"
              value={intervalMinutes}
              onChange={(event) => setIntervalMinutes(event.target.value)}
            />
            <select aria-label="间隔单位" value="minutes" onChange={() => {}}>
              <option value="minutes">分钟</option>
            </select>
          </span>
        </label>
      ) : (
        <label className="field-label compact-field">
          执行时间
          <input
            type="time"
            value={timeOfDay}
            onChange={(event) => setTimeOfDay(event.target.value)}
          />
        </label>
      )}
      {scheduleType === "weekly" ? (
        <div
          className="script-weekday-picker"
          role="group"
          aria-label="每周执行日期"
        >
          <span className="script-weekday-title">每周执行日期</span>
          <div className="script-weekday-options">
            {WEEKDAYS.map((day) => (
              <label
                className={weekdays.includes(day.value) ? "selected" : ""}
                key={day.value}
              >
                <input
                  type="checkbox"
                  checked={weekdays.includes(day.value)}
                  onChange={(event) => {
                    setWeekdays((current) =>
                      event.target.checked
                        ? [...current, day.value].sort()
                        : current.filter((value) => value !== day.value),
                    );
                  }}
                />
                {day.label}
              </label>
            ))}
          </div>
        </div>
      ) : null}
      <label className="checkbox-label script-enabled-row">
        <span>创建后启用</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span>创建任务后自动启用</span>
      </label>
    </div>
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
      type="button"
      title={label}
    >
      <span className={`script-filter-icon ${labelToFilterIcon(label)}`} aria-hidden="true" />
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
  );
}

function labelToFilterIcon(label: string) {
  switch (label) {
    case "运行中":
      return "running";
    case "等待执行":
      return "waiting";
    case "已停用":
      return "disabled";
    case "失败":
      return "failed";
    default:
      return "all";
  }
}

function ScriptTaskRow({
  isBusy,
  onDelete,
  onRunNow,
  onToggle,
  task,
}: {
  isBusy: boolean;
  onDelete: (id: string) => void;
  onRunNow: (id: string) => void;
  onToggle: (task: ScriptTask) => void;
  task: ScriptTask;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [isMenuOpen]);

  return (
    <tr>
      <td>
        <div className="script-task-name-cell">
          <strong>{task.name}</strong>
        </div>
      </td>
      <td>{scheduleLabel(task)}</td>
      <td className="script-path-cell">
        {scriptCommandLabel(task)}
      </td>
      <td>{task.enabled ? nextRunLabel(task) : "已停用"}</td>
      <td>
        <span className={`status status-${scriptTaskStatus(task)}`}>
          {scriptTaskStatusLabel(task)}
        </span>
        {task.lastError ? <small className="script-error-text">{task.lastError}</small> : null}
      </td>
      <td>
        <div className="script-row-actions">
          <button className="primary-action" onClick={() => onRunNow(task.id)} disabled={isBusy}>
            立即运行
          </button>
          <div className="script-actions-menu" ref={menuRef}>
            <button
              aria-expanded={isMenuOpen}
              aria-label="更多操作"
              className="script-actions-menu-trigger"
              onClick={() => setIsMenuOpen((value) => !value)}
              title="更多操作"
              type="button"
            >
              ⋮
            </button>
            {isMenuOpen ? (
              <div className="script-actions-menu-panel">
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  onToggle(task);
                }}
                disabled={isBusy}
                type="button"
              >
                {task.enabled ? "停用任务" : "启用任务"}
              </button>
              <button
                className="danger-action"
                onClick={() => {
                  setIsMenuOpen(false);
                  onDelete(task.id);
                }}
                disabled={isBusy}
                type="button"
              >
                删除任务
              </button>
            </div>
            ) : null}
          </div>
        </div>
      </td>
    </tr>
  );
}

function scriptTaskStatus(task: ScriptTask) {
  if (!task.enabled) {
    return "disabled";
  }
  if (task.lastStartedAt && !task.lastFinishedAt) {
    return "running";
  }
  if (isFailedTask(task)) {
    return "failed";
  }
  return "waiting";
}

function scriptTaskStatusLabel(task: ScriptTask) {
  switch (scriptTaskStatus(task)) {
    case "running":
      return "运行中";
    case "waiting":
      return "等待执行";
    case "disabled":
      return "已停用";
    case "failed":
      return "失败";
  }
}

function isRunningTask(task: ScriptTask) {
  return Boolean(task.enabled && task.lastStartedAt && !task.lastFinishedAt);
}

function isFailedTask(task: ScriptTask) {
  return Boolean(
    task.enabled &&
      !isRunningTask(task) &&
      (task.lastError ||
        (task.lastExitCode !== null &&
          task.lastExitCode !== undefined &&
          task.lastExitCode !== 0)),
  );
}

function isWaitingTask(task: ScriptTask) {
  return Boolean(task.enabled && !isRunningTask(task) && !isFailedTask(task));
}

function scheduleLabel(task: ScriptTask) {
  if (task.scheduleType === "daily") {
    return `每天 ${task.timeOfDay ?? "--:--"}`;
  }
  if (task.scheduleType === "weekly") {
    const days = (task.weekdays ?? [])
      .map((value) => WEEKDAYS.find((day) => day.value === value)?.label)
      .filter(Boolean)
      .join("、");
    return `每周 ${days || "未选择"} ${task.timeOfDay ?? "--:--"}`;
  }
  return `每 ${task.intervalMinutes} 分钟`;
}

function scriptCommandLabel(task: ScriptTask) {
  return [quoteCommandPart(task.scriptPath), task.scriptArgs?.trim()]
    .filter(Boolean)
    .join(" ");
}

function nextRunLabel(task: ScriptTask) {
  if (isRunningTask(task)) {
    return "运行中";
  }
  const next = nextRunDate(task, new Date());
  return next ? formatDateTime(next) : "--";
}

function nextRunDate(task: ScriptTask, now: Date) {
  if (task.scheduleType === "daily") {
    return nextDailyRun(task, now);
  }
  if (task.scheduleType === "weekly") {
    return nextWeeklyRun(task, now);
  }
  const minutes = Number(task.intervalMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }
  return new Date(now.getTime() + minutes * 60_000);
}

function nextDailyRun(task: ScriptTask, now: Date) {
  const time = parseTimeOfDay(task.timeOfDay);
  if (!time) {
    return null;
  }
  const candidate = withLocalTime(now, time.hour, time.minute);
  if (candidate.getTime() > now.getTime()) {
    return candidate;
  }
  candidate.setDate(candidate.getDate() + 1);
  return candidate;
}

function nextWeeklyRun(task: ScriptTask, now: Date) {
  const time = parseTimeOfDay(task.timeOfDay);
  const weekdays = task.weekdays ?? [];
  if (!time || weekdays.length === 0) {
    return null;
  }
  const today = startOfLocalDay(now);
  const todayWeekday = localWeekdayNumber(now);
  for (let offset = 0; offset <= 7; offset += 1) {
    const weekday = ((todayWeekday + offset - 1) % 7) + 1;
    if (!weekdays.includes(weekday)) {
      continue;
    }
    const candidate = new Date(today);
    candidate.setDate(today.getDate() + offset);
    candidate.setHours(time.hour, time.minute, 0, 0);
    if (candidate.getTime() > now.getTime()) {
      return candidate;
    }
  }
  return null;
}

function parseTimeOfDay(value?: string | null) {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    return null;
  }
  return { hour, minute };
}

function withLocalTime(date: Date, hour: number, minute: number) {
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function startOfLocalDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function localWeekdayNumber(date: Date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function formatDateTime(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function splitCommandLine(value: string): { program: string; args: string[] } | null {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && quote === null) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (char === "\\" && (value[index + 1] === '"' || value[index + 1] === "'")) {
      index += 1;
      current += value[index];
      continue;
    }
    if (/\s/.test(char) && quote === null) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote !== null) {
    return null;
  }
  if (current) {
    parts.push(current);
  }
  const [program, ...args] = parts;
  return program ? { program, args: args.map(quoteCommandPart) } : null;
}

function quoteCommandPart(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/^["'].*["']$/.test(trimmed) || !/\s/.test(trimmed)) {
    return trimmed;
  }
  return `"${trimmed.replace(/"/g, '\\"')}"`;
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "脚本任务操作失败。";
}
