import { useState } from "react";
import { downloadFile } from "../lib/api";
import type { DownloadResult } from "../types";

type DownloadTaskStatus = "running" | "completed" | "failed";

interface DownloadTask {
  id: string;
  url: string;
  requestedFileName: string;
  startedAt: string;
  finishedAt?: string | null;
  status: DownloadTaskStatus;
  result?: DownloadResult | null;
  error?: string | null;
}

export function DownloadPanel() {
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [activeFilter, setActiveFilter] =
    useState<DownloadTaskStatus>("running");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  async function submit() {
    if (!url.trim()) {
      setError("请输入 HTTP/HTTPS 下载地址。");
      return;
    }
    const taskId = crypto.randomUUID();
    const trimmedUrl = url.trim();
    const trimmedFileName = fileName.trim();
    setError(null);
    setActiveFilter("running");
    setSelectedId(taskId);
    setTasks((current) => [
      {
        id: taskId,
        url: trimmedUrl,
        requestedFileName: trimmedFileName,
        startedAt: new Date().toISOString(),
        status: "running",
      },
      ...current,
    ]);
    setIsDownloading(true);
    try {
      const result = await downloadFile({
        url: trimmedUrl,
        fileName: trimmedFileName,
      });
      setTasks((current) =>
        current.map((task) =>
          task.id === taskId
            ? {
                ...task,
                status: "completed",
                finishedAt: new Date().toISOString(),
                result,
              }
            : task,
        ),
      );
      setActiveFilter("completed");
    } catch (err) {
      const message = readError(err);
      setError(message);
      setTasks((current) =>
        current.map((task) =>
          task.id === taskId
            ? {
                ...task,
                status: "failed",
                finishedAt: new Date().toISOString(),
                error: message,
              }
            : task,
        ),
      );
      setActiveFilter("failed");
    } finally {
      setIsDownloading(false);
    }
  }

  const runningTasks = tasks.filter((task) => task.status === "running");
  const completedTasks = tasks.filter((task) => task.status === "completed");
  const failedTasks = tasks.filter((task) => task.status === "failed");
  const visibleTasks =
    activeFilter === "running"
      ? runningTasks
      : activeFilter === "completed"
        ? completedTasks
        : failedTasks;
  const selectedTask =
    visibleTasks.find((task) => task.id === selectedId) ?? visibleTasks[0] ?? null;
  const emptyListMessage =
    activeFilter === "running"
      ? "当前没有正在下载的任务。"
      : activeFilter === "completed"
        ? "还没有已完成下载。"
        : "还没有失败下载。";

  return (
    <section className="download-panel">
      <div className="section-header">
        <div>
          <h2>下载工具</h2>
          <p className="muted">输入 HTTP/HTTPS 地址，文件会保存到系统下载目录。</p>
        </div>
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="download-card">
        <label className="field-label">
          下载地址
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/file.zip"
          />
        </label>
        <label className="field-label">
          文件名（可选）
          <input
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
            placeholder="留空则自动从 URL 获取"
          />
        </label>
        <button onClick={submit} disabled={isDownloading}>
          {isDownloading ? "下载中..." : "开始下载"}
        </button>
      </div>

      <div className="task-workspace">
        <aside className="task-filters" aria-label="下载任务筛选">
          <button
            aria-label={`下载中 ${runningTasks.length}`}
            className={activeFilter === "running" ? "active" : ""}
            onClick={() => setActiveFilter("running")}
          >
            <span>下载中</span>
            <strong>{runningTasks.length}</strong>
          </button>
          <button
            aria-label={`已完成 ${completedTasks.length}`}
            className={activeFilter === "completed" ? "active" : ""}
            onClick={() => setActiveFilter("completed")}
          >
            <span>已完成</span>
            <strong>{completedTasks.length}</strong>
          </button>
          <button
            aria-label={`失败 ${failedTasks.length}`}
            className={activeFilter === "failed" ? "active" : ""}
            onClick={() => setActiveFilter("failed")}
          >
            <span>失败</span>
            <strong>{failedTasks.length}</strong>
          </button>
        </aside>

        <div className="task-content">
          <div className="task-list" aria-label="下载任务列表">
            {visibleTasks.length === 0 ? (
              <div className="task-list-empty">{emptyListMessage}</div>
            ) : null}
            {visibleTasks.map((task) => (
              <button
                aria-label={downloadTaskTitle(task)}
                aria-pressed={selectedTask?.id === task.id}
                className={`task-row ${
                  selectedTask?.id === task.id ? "selected" : ""
                }`}
                key={task.id}
                onClick={() => setSelectedId(task.id)}
              >
                <span>
                  <strong>{downloadTaskTitle(task)}</strong>
                  <span>{downloadTaskStatusLabel(task.status)} · {formatTime(task.startedAt)}</span>
                </span>
              </button>
            ))}
          </div>

          <aside className="task-detail" aria-label="下载任务详情">
            {selectedTask ? (
              <DownloadTaskDetail task={selectedTask} />
            ) : (
              <div className="task-detail-empty">
                <h3>选择一个下载任务</h3>
                <p className="muted">当前分类没有可显示的下载任务。</p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}

function DownloadTaskDetail({ task }: { task: DownloadTask }) {
  return (
    <>
      <div className="task-detail-header">
        <span className={`status status-${task.status}`}>
          {downloadTaskStatusLabel(task.status)}
        </span>
      </div>
      <h3>{downloadTaskTitle(task)}</h3>
      <dl className="task-detail-list">
        <div>
          <dt>下载地址</dt>
          <dd>{task.url}</dd>
        </div>
        <div>
          <dt>开始时间</dt>
          <dd>{formatTime(task.startedAt)}</dd>
        </div>
        {task.finishedAt ? (
          <div>
            <dt>结束时间</dt>
            <dd>{formatTime(task.finishedAt)}</dd>
          </div>
        ) : null}
        {task.result ? (
          <>
            <div>
              <dt>保存路径</dt>
              <dd>{task.result.savedPath}</dd>
            </div>
            <div>
              <dt>大小与耗时</dt>
              <dd>
                {formatBytes(task.result.bytes)} · {task.result.elapsedMs}ms
              </dd>
            </div>
          </>
        ) : null}
        {task.error ? (
          <div>
            <dt>失败原因</dt>
            <dd>{task.error}</dd>
          </div>
        ) : null}
      </dl>
    </>
  );
}

function downloadTaskTitle(task: DownloadTask) {
  return task.result?.fileName || task.requestedFileName || task.url;
}

function downloadTaskStatusLabel(status: DownloadTaskStatus) {
  switch (status) {
    case "running":
      return "下载中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
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

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "下载失败。";
}
