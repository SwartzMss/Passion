import { useState } from "react";
import { downloadFile } from "../lib/api";
import type { DownloadResult } from "../types";

type DownloadTaskStatus = "running" | "completed" | "failed";
type DownloadTaskFilter = "all" | DownloadTaskStatus;

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

const DEFAULT_DOWNLOAD_DIR = "系统下载目录";

export function DownloadPanel() {
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [activeFilter, setActiveFilter] = useState<DownloadTaskFilter>("all");
  const [query, setQuery] = useState("");
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
    setActiveFilter("all");
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
    } finally {
      setIsDownloading(false);
    }
  }

  const runningTasks = tasks.filter((task) => task.status === "running");
  const completedTasks = tasks.filter((task) => task.status === "completed");
  const failedTasks = tasks.filter((task) => task.status === "failed");
  const filteredTasks =
    activeFilter === "all"
      ? tasks
      : activeFilter === "running"
      ? runningTasks
      : activeFilter === "completed"
        ? completedTasks
        : failedTasks;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTasks = normalizedQuery
    ? filteredTasks.filter((task) =>
        [downloadTaskTitle(task), task.url, task.requestedFileName]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : filteredTasks;
  const selectedTask =
    visibleTasks.find((task) => task.id === selectedId) ?? visibleTasks[0] ?? null;
  const emptyListMessage =
    normalizedQuery
      ? "没有找到匹配的下载任务。"
      : activeFilter === "all"
        ? "还没有下载任务。"
        : activeFilter === "running"
      ? "当前没有正在下载的任务。"
      : activeFilter === "completed"
        ? "还没有已完成下载。"
        : "还没有失败下载。";

  return (
    <section className="download-panel">
      <header className="download-hero">
        <h1>下载工具</h1>
        <p>输入 HTTP/HTTPS 地址，文件会保存到系统下载目录。</p>
      </header>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="download-card">
        <h2>新建下载任务</h2>
        <label className="field-label" htmlFor="download-url">
          下载地址
          <span className="download-input-shell">
            <span aria-hidden="true">🔗</span>
            <input
              id="download-url"
              aria-label="下载地址"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="请输入 HTTP/HTTPS 地址，例如：https://example.com/file.zip"
            />
          </span>
        </label>
        <label className="field-label" htmlFor="download-file-name">
          文件名（可选）
          <input
            id="download-file-name"
            aria-label="文件名（可选）"
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
            placeholder="留空则自动从 URL 获取"
          />
        </label>
        <div className="download-form-footer">
          <div className="download-location">
            <span>保存位置</span>
            <div>
              <span aria-hidden="true">📁</span>
              <strong>{DEFAULT_DOWNLOAD_DIR}</strong>
              <button disabled type="button">更改目录</button>
            </div>
          </div>
          <button className="primary-action download-start-button" onClick={submit} disabled={isDownloading}>
            <span aria-hidden="true">+</span>
            {isDownloading ? "下载中..." : "开始下载"}
          </button>
        </div>
      </div>

      <div className="download-toolbar">
        <div className="download-filters" aria-label="下载任务筛选" role="group">
          <FilterButton
            active={activeFilter === "all"}
            count={tasks.length}
            label="全部"
            onClick={() => setActiveFilter("all")}
          />
          <FilterButton
            active={activeFilter === "running"}
            count={runningTasks.length}
            label="下载中"
            onClick={() => setActiveFilter("running")}
          />
          <FilterButton
            active={activeFilter === "completed"}
            count={completedTasks.length}
            label="已完成"
            onClick={() => setActiveFilter("completed")}
          />
          <FilterButton
            active={activeFilter === "failed"}
            count={failedTasks.length}
            label="失败"
            onClick={() => setActiveFilter("failed")}
          />
        </div>
        <div className="download-search">
          <label className="sr-only" htmlFor="download-search">
            搜索下载任务
          </label>
          <input
            id="download-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索文件名或地址"
          />
          <span aria-hidden="true">⌕</span>
        </div>
      </div>

      <div className="download-workspace">
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
                <span className="download-file-icon" aria-hidden="true">⇩</span>
                <span>
                  <strong>{downloadTaskTitle(task)}</strong>
                  <span>{task.url}</span>
                  <span>
                    <span className={`download-status download-status-${task.status}`}>
                      {downloadTaskStatusLabel(task.status)}
                    </span>
                    {task.status === "completed" && task.result
                      ? ` · ${formatBytes(task.result.bytes)}`
                      : task.status === "failed"
                        ? ` · ${task.error ?? "下载失败"}`
                        : " · 等待下载完成"}
                  </span>
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
                <p className="muted">从左侧列表选择任务后，可以查看保存位置和下载状态。</p>
              </div>
            )}
          </aside>
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
      type="button"
    >
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
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
      <div className="download-progress-row">
        <span>进度</span>
        <progress value={task.status === "completed" ? 100 : 0} max={100} />
        <strong>{task.status === "completed" ? "100%" : task.status === "running" ? "下载中" : "失败"}</strong>
      </div>
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
