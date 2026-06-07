import { useEffect, useState } from "react";
import {
  createScriptTask,
  deleteScriptTask,
  listScriptTasks,
  runScriptTaskNow,
  setScriptTaskEnabled,
} from "../lib/api";
import type { ScriptTask } from "../types";

export function ScriptTasksPanel() {
  const [tasks, setTasks] = useState<ScriptTask[]>([]);
  const [name, setName] = useState("");
  const [scriptPath, setScriptPath] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState("15");
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function refresh() {
    setTasks(await listScriptTasks());
  }

  useEffect(() => {
    refresh().catch((err) => setError(readError(err)));
  }, []);

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
    const interval = Number(intervalMinutes);
    if (!Number.isInteger(interval) || interval <= 0) {
      setError("执行间隔必须大于 0。");
      return;
    }

    setError(null);
    setIsBusy(true);
    try {
      await createScriptTask({
        name: trimmedName,
        scriptPath: trimmedPath,
        intervalMinutes: interval,
        enabled,
      });
      setName("");
      setScriptPath("");
      setIntervalMinutes("15");
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
          间隔分钟数
          <input
            inputMode="numeric"
            value={intervalMinutes}
            onChange={(event) => setIntervalMinutes(event.target.value)}
          />
        </label>
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
      </article>

      <div className="script-task-list">
        {tasks.length === 0 ? (
          <p className="empty-state">还没有脚本任务。</p>
        ) : (
          tasks.map((task) => (
            <article className="script-task-card" key={task.id}>
              <div className="script-task-header">
                <div>
                  <h3>{task.name}</h3>
                  <p className="muted">{task.scriptPath}</p>
                </div>
                <span className="status">
                  {task.enabled ? "已启用" : "已停用"}
                </span>
              </div>
              <p className="muted">每 {task.intervalMinutes} 分钟</p>
              <p className="muted">
                最近执行：{formatLastRun(task)}
                {task.lastExitCode !== null && task.lastExitCode !== undefined
                  ? ` · 退出码 ${task.lastExitCode}`
                  : ""}
              </p>
              {task.lastError ? (
                <div className="result-box">
                  <strong>错误</strong>
                  <pre>{task.lastError}</pre>
                </div>
              ) : null}
              {task.lastStdout ? (
                <div className="result-box">
                  <strong>stdout</strong>
                  <pre>{task.lastStdout}</pre>
                </div>
              ) : null}
              {task.lastStderr ? (
                <div className="result-box">
                  <strong>stderr</strong>
                  <pre>{task.lastStderr}</pre>
                </div>
              ) : null}
              <div className="card-actions">
                <button onClick={() => runNow(task.id)} disabled={isBusy}>
                  立即运行
                </button>
                <button onClick={() => toggle(task)} disabled={isBusy}>
                  {task.enabled ? "停用" : "启用"}
                </button>
                <button onClick={() => remove(task.id)} disabled={isBusy}>
                  删除
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
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
