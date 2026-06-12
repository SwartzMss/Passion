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

export function ScriptTasksPanel() {
  const [tasks, setTasks] = useState<ScriptTask[]>([]);
  const [activeFilter, setActiveFilter] = useState<
    "running" | "finished" | "notStarted"
  >("running");
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const runningTasks = useMemo(
    () =>
      tasks.filter((task) => task.lastStartedAt && !task.lastFinishedAt),
    [tasks],
  );
  const finishedTasks = useMemo(
    () => tasks.filter((task) => task.lastFinishedAt),
    [tasks],
  );
  const notStartedTasks = useMemo(
    () => tasks.filter((task) => !task.lastStartedAt),
    [tasks],
  );
  const visibleTasks = useMemo(() => {
    switch (activeFilter) {
      case "finished":
        return finishedTasks;
      case "notStarted":
        return notStartedTasks;
      case "running":
        return runningTasks;
    }
  }, [activeFilter, finishedTasks, notStartedTasks, runningTasks]);
  const selectedTask =
    visibleTasks.find((task) => task.id === selectedId) ?? visibleTasks[0] ?? null;
  const emptyListMessage =
    activeFilter === "running"
      ? "当前没有正在执行的脚本。"
      : activeFilter === "finished"
        ? "还没有已结束的脚本执行。"
        : "还没有未执行的脚本任务。";

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
      <div className="section-header">
        <div>
          <h2>脚本任务</h2>
          <p className="muted">按固定间隔执行本机脚本，应用运行时生效。</p>
        </div>
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <article className="script-form">
        <h3>新增任务</h3>
        <div className="inline-form-grid">
          <label className="field-label">
            任务名
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="field-label">
            脚本路径
            <input
              value={scriptPath}
              onChange={(event) => setScriptPath(event.target.value)}
              placeholder="例如 C:\\tasks\\backup.ps1"
            />
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
              间隔分钟数
              <input
                inputMode="numeric"
                value={intervalMinutes}
                onChange={(event) => setIntervalMinutes(event.target.value)}
              />
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
          <button onClick={createTask} disabled={isBusy}>
            新增任务
          </button>
        </div>
      </article>

      <div className="task-workspace">
        <aside className="task-filters" aria-label="脚本任务筛选">
          <button
            aria-label={`运行中 ${runningTasks.length}`}
            className={activeFilter === "running" ? "active" : ""}
            onClick={() => setActiveFilter("running")}
          >
            <span>运行中</span>
            <strong>{runningTasks.length}</strong>
          </button>
          <button
            aria-label={`已结束 ${finishedTasks.length}`}
            className={activeFilter === "finished" ? "active" : ""}
            onClick={() => setActiveFilter("finished")}
          >
            <span>已结束</span>
            <strong>{finishedTasks.length}</strong>
          </button>
          <button
            aria-label={`未执行 ${notStartedTasks.length}`}
            className={activeFilter === "notStarted" ? "active" : ""}
            onClick={() => setActiveFilter("notStarted")}
          >
            <span>未执行</span>
            <strong>{notStartedTasks.length}</strong>
          </button>
        </aside>

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
                <span>
                  <strong>{task.name}</strong>
                  <span>{scriptTaskStatusLabel(task)} · {scheduleLabel(task)}</span>
                </span>
              </button>
            ))}
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
    </section>
  );
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
        <span className={`status status-${scriptTaskStatus(task)}`}>
          {scriptTaskStatusLabel(task)}
        </span>
        <span className={task.enabled ? "enabled" : "disabled"}>
          {task.enabled ? "已启用" : "已停用"}
        </span>
      </div>
      <h3>{task.name}</h3>
      <dl className="task-detail-list">
        <div>
          <dt>脚本路径</dt>
          <dd>{task.scriptPath}</dd>
        </div>
        <div>
          <dt>执行计划</dt>
          <dd>{scheduleLabel(task)}</dd>
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
      </dl>
      <ScriptOutput title="错误" value={task.lastError} />
      <ScriptOutput title="stdout" value={task.lastStdout} />
      <ScriptOutput title="stderr" value={task.lastStderr} />
      <div className="card-actions">
        <button onClick={() => onRunNow(task.id)} disabled={isBusy}>
          立即运行
        </button>
        <button onClick={() => onToggle(task)} disabled={isBusy}>
          {task.enabled ? "停用" : "启用"}
        </button>
        <button onClick={() => onDelete(task.id)} disabled={isBusy}>
          删除
        </button>
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
  if (task.lastStartedAt && !task.lastFinishedAt) {
    return "running";
  }
  if (task.lastFinishedAt) {
    return "finished";
  }
  return "not-started";
}

function scriptTaskStatusLabel(task: ScriptTask) {
  switch (scriptTaskStatus(task)) {
    case "running":
      return "运行中";
    case "finished":
      return "已结束";
    case "not-started":
      return "未执行";
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
  return new Date(task.lastStartedAt).toLocaleString();
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "脚本任务操作失败。";
}
