import { useEffect, useMemo, useState } from "react";
import {
  createScriptTask,
  deleteScriptTask,
  listScriptTasks,
  runScriptTaskNow,
  setScriptTaskEnabled,
} from "../lib/api";
import type { ScriptTask, ScriptTaskScheduleType } from "../types";

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
      [task.name, task.scriptPath, scheduleLabel(task), scriptTaskStatusLabel(task)]
        .join(" ")
        .toLowerCase()
        .includes(trimmedQuery),
    );
  }, [activeFilter, query, tasks]);
  const selectedTask =
    visibleTasks.find((task) => task.id === selectedId) ?? visibleTasks[0] ?? null;
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

  useEffect(() => {
    setSelectedId((current) => {
      if (current && visibleTasks.some((task) => task.id === current)) {
        return current;
      }
      return visibleTasks[0]?.id ?? null;
    });
  }, [visibleTasks]);

  async function createTask() {
    const trimmedName = name.trim();
    const trimmedPath = scriptPath.trim();
    if (!trimmedName) {
      setError("任务名不能为空。");
      return;
    }
    if (!trimmedPath) {
      setError("脚本路径不能为空。");
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
        scriptPath: trimmedPath,
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
          placeholder="搜索任务名称或脚本路径"
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
          <span aria-hidden="true">＋</span>
          新增任务
        </button>
      </div>

      <div className="task-workspace">
        <div className="task-content">
          <div className="task-list" aria-label="脚本任务列表">
            {visibleTasks.length === 0 ? (
              <div className="task-list-empty">{emptyListMessage}</div>
            ) : null}
            {visibleTasks.map((task) => (
              <button
                aria-label={task.name}
                aria-pressed={selectedTask?.id === task.id}
                className={`task-row ${
                  selectedTask?.id === task.id ? "selected" : ""
                }`}
                key={task.id}
                onClick={() => setSelectedId(task.id)}
              >
                <span className={`script-task-icon ${scriptTaskStatus(task)}`} aria-hidden="true">
                  {scriptTaskIcon(task)}
                </span>
                <span>
                  <strong>{task.name}</strong>
                  <span>{task.scriptPath}</span>
                </span>
                <span className={`status status-${scriptTaskStatus(task)}`}>
                  {scriptTaskStatusLabel(task)}
                </span>
                <span>{scheduleLabel(task)}</span>
                <span>{task.enabled ? nextRunLabel(task) : "已停用"}</span>
              </button>
            ))}
            {visibleTasks.length > 0 ? (
              <p className="script-list-count">共 {visibleTasks.length} 个任务</p>
            ) : null}
          </div>

          <aside className="task-detail" aria-label="脚本任务详情">
            {selectedTask ? (
              <ScriptTaskDetail
                isBusy={isBusy}
                onDelete={remove}
                onRunNow={runNow}
                onToggle={toggle}
                task={selectedTask}
              />
            ) : (
              <div className="task-detail-empty">
                <h3>选择一个脚本任务</h3>
                <p className="muted">当前分类没有可显示的脚本任务。</p>
              </div>
            )}
          </aside>
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
        脚本路径
        <span className="script-path-input">
          <input
            aria-label="脚本路径"
            value={scriptPath}
            onChange={(event) => setScriptPath(event.target.value)}
            placeholder="请选择脚本文件"
          />
          <button type="button">选择脚本</button>
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
          <option value="interval">每隔一段时间</option>
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
        <fieldset className="weekday-picker script-weekday-picker">
          <legend>每周执行</legend>
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
        </fieldset>
      ) : null}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        创建后启用
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

function ScriptTaskDetail({
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
  return (
    <>
      <div className="task-detail-header">
        <div>
          <h2>任务详情</h2>
          <p>{task.name}</p>
        </div>
        <div className="task-detail-actions">
          <button className="primary-action" onClick={() => onRunNow(task.id)} disabled={isBusy}>
            立即运行
          </button>
          <button onClick={() => onToggle(task)} disabled={isBusy}>
            {task.enabled ? "停用" : "启用"}
          </button>
          <button className="danger-action" onClick={() => onDelete(task.id)} disabled={isBusy}>
            删除
          </button>
        </div>
      </div>
      <div className="script-status-strip">
        <span className={`status status-${scriptTaskStatus(task)}`}>
          {scriptTaskStatusLabel(task)}
        </span>
        <span className={task.enabled ? "enabled" : "disabled"}>
          {task.enabled ? "已启用" : "已停用"}
        </span>
      </div>
      <dl className="task-detail-list">
        <div>
          <dt>任务名称</dt>
          <dd>{task.name}</dd>
        </div>
        <div>
          <dt>脚本路径</dt>
          <dd>{task.scriptPath}</dd>
        </div>
        <div>
          <dt>执行方式</dt>
          <dd>{scheduleLabel(task)}</dd>
        </div>
        <div>
          <dt>创建后启用</dt>
          <dd>{task.enabled ? "是" : "否"}</dd>
        </div>
        <div>
          <dt>最近执行</dt>
          <dd>
            {formatLastRun(task)}
            {task.lastExitCode !== null && task.lastExitCode !== undefined
              ? ` · 退出码 ${task.lastExitCode}`
              : ""}
          </dd>
        </div>
        <div>
          <dt>下次执行</dt>
          <dd>{task.enabled ? "需要后端补充" : "已停用"}</dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{formatDateTime(task.createdAt)}</dd>
        </div>
      </dl>
      <div className="script-log-panel">
        <div className="script-log-header">
          <h3>执行日志</h3>
          <button type="button">清空日志</button>
        </div>
        <ScriptOutput title="错误" value={task.lastError} />
        <ScriptOutput title="stdout" value={task.lastStdout} />
        <ScriptOutput title="stderr" value={task.lastStderr} />
        {!task.lastError && !task.lastStdout && !task.lastStderr ? (
          <p className="muted">暂无最近一次输出。</p>
        ) : null}
      </div>
    </>
  );
}

function ScriptOutput({
  title,
  value,
}: {
  title: string;
  value?: string | null;
}) {
  if (!value) {
    return null;
  }
  return (
    <div className="result-box">
      <strong>{title}</strong>
      <pre>{value}</pre>
    </div>
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

function scriptTaskIcon(task: ScriptTask) {
  switch (scriptTaskStatus(task)) {
    case "running":
      return "↗";
    case "waiting":
      return "⌁";
    case "disabled":
      return "Ⅱ";
    case "failed":
      return "×";
  }
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

function formatLastRun(task: ScriptTask) {
  if (!task.lastStartedAt) {
    return "尚未执行";
  }
  return formatDateTime(task.lastStartedAt);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function nextRunLabel(task: ScriptTask) {
  if (isRunningTask(task)) {
    return "运行中";
  }
  return "下次执行：需要后端";
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "脚本任务操作失败。";
}
