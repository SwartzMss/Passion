import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { cancelDownload, deleteDownloadTask, downloadFile, getDefaultDownloadDir, listDownloadTasks, pauseDownload } from "../../lib/api";
import { onDownloadTaskChanged } from "../../lib/events";
import type { DownloadTask } from "../../types";

type DownloadTaskStatus = "running" | "paused" | "completed" | "failed";
type DownloadTaskFilter = DownloadTaskStatus;

export function DownloadPanel() {
  const [url, setUrl] = useState("");
  const [saveDir, setSaveDir] = useState("");
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [activeFilter, setActiveFilter] = useState<DownloadTaskFilter>("running");
  const [query, setQuery] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canceledTaskIdsRef = useRef(new Set<string>());
  const deletedTaskIds = useRef(new Set<string>());
  const generations = useRef(new Map<string, number>());
  const [pendingControls, setPendingControls] = useState<Set<string>>(new Set());
  const controlLocks = useRef(new Set<string>());

  async function control(id: string, action: () => Promise<void>) {
    if (controlLocks.current.has(id)) return;
    controlLocks.current.add(id);
    setPendingControls(new Set(controlLocks.current));
    try { await action(); }
    finally {
      controlLocks.current.delete(id);
      setPendingControls(new Set(controlLocks.current));
    }
  }

  useEffect(() => {
    getDefaultDownloadDir()
      .then(setSaveDir)
      .catch((err) => setError(readError(err)));
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    function receive(incoming: DownloadTask[]) {
      if (disposed) return;
      setTasks((current) => {
        const merged = new Map(current.map((task) => [task.id, task]));
        for (const task of incoming) {
          if (deletedTaskIds.current.has(task.id) || canceledTaskIdsRef.current.has(task.id)) continue;
          const existing = merged.get(task.id);
          if (!existing || (task.revision ?? 0) >= (existing.revision ?? 0)) merged.set(task.id, task);
        }
        return [...merged.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      });
    }
    onDownloadTaskChanged((task) => receive([task]))
      .then((cleanup) => {
        if (disposed) { cleanup(); return; }
        unlisten = cleanup;
        return listDownloadTasks().then(receive);
      })
      .catch((err) => { if (!disposed) setError(readError(err)); });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  async function submit() {
    if (!url.trim()) {
      setError("请输入下载地址或本地文件路径。");
      return;
    }
    if (!saveDir.trim()) {
      setError("请选择保存位置。");
      return;
    }
    const taskId = crypto.randomUUID();
    const trimmedUrl = url.trim();
    const inferredFileName = inferDownloadFileName(trimmedUrl);
    setError(null);
    setActiveFilter("running");
    const targetDir = saveDir.trim();
    setTasks((current) => [
      {
        id: taskId,
        url: trimmedUrl,
        saveDir: targetDir,
        requestedFileName: inferredFileName,
        startedAt: new Date().toISOString(),
        status: "running",
      },
      ...current,
    ]);
    setUrl("");
    setIsCreateOpen(false);
    void runDownloadTask(taskId, trimmedUrl, targetDir);
  }

  async function runDownloadTask(taskId: string, trimmedUrl: string, targetDir: string) {
    const generation = (generations.current.get(taskId) ?? 0) + 1;
    generations.current.set(taskId, generation);
    try {
      const result = await downloadFile({
        taskId,
        url: trimmedUrl,
        saveDir: targetDir,
      });
      if (canceledTaskIdsRef.current.has(taskId) || generations.current.get(taskId) !== generation) {
        return;
      }
      setTasks((current) =>
        current.map((task) =>
          task.id === taskId && !task.revision
            ? {
                ...task,
                status: "completed",
                finishedAt: new Date().toISOString(),
                result,
                requestedFileName: result.fileName,
                savedPath: result.savedPath,
                totalBytes: result.bytes,
                downloadedBytes: result.bytes,
                elapsedMs: Number(result.elapsedMs),
                bytesPerSecond:
                  result.elapsedMs > 0
                    ? result.bytes / (Number(result.elapsedMs) / 1000)
                    : undefined,
              }
            : task,
        ),
      );
    } catch (err) {
      if (canceledTaskIdsRef.current.has(taskId) || generations.current.get(taskId) !== generation) {
        return;
      }
      const message = readError(err);
      setTasks((current) =>
        current.map((task) =>
          task.id === taskId && !task.revision && task.status !== "paused"
            ? {
                ...task,
                status: message === "下载已暂停。" ? "paused" : "failed",
                finishedAt: new Date().toISOString(),
                error: message,
              }
            : task,
        ),
      );
    }
  }

  const runningTasks = tasks.filter((task) => task.status === "running" || task.status === "paused");
  const completedTasks = tasks.filter((task) => task.status === "completed");
  const failedTasks = tasks.filter((task) => task.status === "failed");
  const filteredTasks =
    activeFilter === "running"
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
  const emptyListMessage =
    normalizedQuery
      ? "没有找到匹配的下载任务。"
      : activeFilter === "running"
      ? "当前没有正在下载的任务。"
      : activeFilter === "completed"
        ? "还没有已完成下载。"
        : "还没有失败下载。";
  const footerSummary = `总任务: ${tasks.length} | 活动: ${runningTasks.length} | 已完成: ${completedTasks.length} | 失败: ${failedTasks.length}`;

  async function removeTask(id: string) {
    try { await deleteDownloadTask(id); }
    catch (err) { setError(readError(err)); return; }
    deletedTaskIds.current.add(id);
    canceledTaskIdsRef.current.delete(id);
    setTasks((current) => current.filter((task) => task.id !== id));
  }

  async function cancelTask(id: string) {
    try { await cancelDownload(id); } catch (err) {
      setError(`取消失败：${readError(err)}`);
      return;
    }
    canceledTaskIdsRef.current.add(id);
    setTasks((current) =>
      current.map((task) =>
        task.id === id && task.status !== "completed"
          ? {
              ...task,
              status: "failed",
              finishedAt: new Date().toISOString(),
              error: "用户取消",
            }
          : task,
      ),
    );
  }

  async function pauseTask(task: DownloadTask) {
    try {
      await pauseDownload(task.id);
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id && item.status === "running" ? { ...item, status: "paused" } : item,
        ),
      );
    } catch (err) {
      setError(`暂停失败：${readError(err)}`);
    }
  }

  function resumeTask(task: DownloadTask) {
    canceledTaskIdsRef.current.delete(task.id);
    setError(null);
    setTasks((current) =>
      current.map((item) =>
        item.id === task.id ? { ...item, status: "running" } : item,
      ),
    );
    void runDownloadTask(task.id, task.url, task.saveDir);
  }

  async function openTaskFolder(task: DownloadTask) {
    const savedPath = task.result?.savedPath || task.savedPath;
    if (!savedPath) {
      return;
    }
    try {
      await revealItemInDir(savedPath);
    } catch (err) {
      setError(`打开文件夹失败：${readError(err)}`);
    }
  }

  return (
    <section className="download-panel">
      <header className="download-hero">
        <div>
          <h1>下载工具</h1>
          <p>支持 HTTP/HTTPS 地址、本地文件路径和局域网共享文件。</p>
        </div>
      </header>

      {error && !isCreateOpen ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="download-toolbar">
        <div className="download-filters" aria-label="下载任务筛选" role="group">
          <FilterButton
            active={activeFilter === "running"}
            count={runningTasks.length}
            label="当前任务"
            onClick={() => setActiveFilter("running")}
          />
          <FilterButton
            active={activeFilter === "completed"}
            count={completedTasks.length}
            label="已完成任务"
            onClick={() => setActiveFilter("completed")}
          />
          <FilterButton
            active={activeFilter === "failed"}
            count={failedTasks.length}
            label="失败任务"
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
        <button
          className="primary-action download-create-button"
          onClick={() => {
            setError(null);
            setIsCreateOpen(true);
          }}
          type="button"
        >
          新建下载
        </button>
      </div>

      <div className="download-workspace">
        <div className="download-table-card">
          <div className="download-table-title">
            <h2>下载任务列表</h2>
          </div>
          <div className="download-table-scroll">
            <table
              aria-label="下载任务列表"
              className={`download-table download-table-${activeFilter}`}
            >
              <DownloadTableHead filter={activeFilter} />
              <tbody>
                {visibleTasks.map((task) => (
                  <DownloadTaskRow
                    key={task.id}
                    onCancel={() => void control(task.id, () => cancelTask(task.id))}
                    onDelete={() => removeTask(task.id)}
                    onOpenFolder={() => void openTaskFolder(task)}
                    onPause={() => void control(task.id, () => pauseTask(task))}
                    onResume={() => resumeTask(task)}
                    filter={activeFilter}
                    task={task}
                    controlPending={pendingControls.has(task.id)}
                  />
                ))}
              </tbody>
            </table>
            {visibleTasks.length === 0 ? (
              <div className="download-empty-state">
                <DownloadEmptyIcon />
                <strong>{downloadEmptyTitle(activeFilter, Boolean(normalizedQuery))}</strong>
                <p>{emptyListMessage}</p>
              </div>
            ) : null}
          </div>
          <div className="download-status-bar">{footerSummary}</div>
        </div>
      </div>

      {isCreateOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div
            aria-labelledby="download-create-title"
            aria-modal="true"
            className="modal download-task-modal"
            role="dialog"
          >
            <div className="modal-title">
              <h2 id="download-create-title">新建下载任务</h2>
              <button
                aria-label="关闭新建下载任务"
                onClick={() => setIsCreateOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
            <DownloadTaskForm
              onCancel={() => setIsCreateOpen(false)}
              onSaveDirChange={setSaveDir}
              onSubmit={submit}
              onUrlChange={setUrl}
              saveDir={saveDir}
              url={url}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DownloadTaskForm({
  onCancel,
  onSaveDirChange,
  onSubmit,
  onUrlChange,
  saveDir,
  url,
}: {
  onCancel: () => void;
  onSaveDirChange: (value: string) => void;
  onSubmit: () => void;
  onUrlChange: (value: string) => void;
  saveDir: string;
  url: string;
}) {
  async function chooseSaveDir() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择保存位置",
    });
    if (typeof selected === "string") {
      onSaveDirChange(selected);
    }
  }

  return (
    <div className="download-modal-fields">
      <label className="field-label" htmlFor="download-url">
        下载地址或本地文件路径
        <span className="download-input-shell">
          <span aria-hidden="true">🔗</span>
          <input
            id="download-url"
            aria-label="下载地址或本地文件路径"
            value={url}
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder="例如：https://example.com/file.zip 或 \\\\server\\share\\file.yaml"
          />
        </span>
      </label>
      <div className="download-location">
        <span>保存位置</span>
        <div>
          <span aria-hidden="true">📁</span>
          <strong>{saveDir || "正在读取默认下载目录..."}</strong>
          <button onClick={chooseSaveDir} type="button">选择目录</button>
        </div>
      </div>
      <div className="modal-actions">
        <button onClick={onCancel} type="button">
          取消
        </button>
        <button
          className="primary-action download-start-button"
          onClick={onSubmit}
          type="button"
        >
          开始下载
        </button>
      </div>
    </div>
  );
}

function DownloadEmptyIcon() {
  return (
    <svg aria-hidden="true" className="table-empty-icon" viewBox="0 0 64 64">
      <path d="M32 12v26" />
      <path d="m22 29 10 10 10-10" />
      <path d="M16 46h32" />
      <path d="M20 52h24" />
    </svg>
  );
}

function downloadEmptyTitle(filter: DownloadTaskFilter, hasQuery: boolean) {
  if (hasQuery) {
    return "没有匹配的下载任务";
  }
  if (filter === "completed") {
    return "暂无已完成下载";
  }
  if (filter === "failed") {
    return "暂无失败下载";
  }
  return "暂无下载任务";
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

function DownloadTableHead({ filter }: { filter: DownloadTaskFilter }) {
  if (filter === "completed") {
    return (
      <>
        <colgroup>
          <col className="download-col-file" />
          <col className="download-col-path" />
          <col className="download-col-size" />
          <col className="download-col-time" />
          <col className="download-col-action-wide" />
        </colgroup>
        <thead>
          <tr>
            <th>文件名</th>
            <th>文件路径</th>
            <th>大小</th>
            <th>完成时间</th>
            <th>操作</th>
          </tr>
        </thead>
      </>
    );
  }

  if (filter === "failed") {
    return (
      <>
        <colgroup>
          <col className="download-col-file" />
          <col className="download-col-path" />
          <col className="download-col-error" />
          <col className="download-col-time" />
          <col className="download-col-action" />
        </colgroup>
        <thead>
          <tr>
            <th>文件名</th>
            <th>文件路径</th>
            <th>失败原因</th>
            <th>失败时间</th>
            <th>操作</th>
          </tr>
        </thead>
      </>
    );
  }

  return (
    <>
      <colgroup>
        <col className="download-col-file" />
        <col className="download-col-progress" />
        <col className="download-col-speed" />
        <col className="download-col-size" />
        <col className="download-col-remaining" />
        <col className="download-col-status" />
        <col className="download-col-action-pair" />
      </colgroup>
      <thead>
        <tr>
          <th>文件名</th>
          <th>进度</th>
          <th>速度</th>
          <th>大小</th>
          <th>剩余时间</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
    </>
  );
}

function DownloadTaskRow({
  controlPending,
  filter,
  onCancel,
  onDelete,
  onOpenFolder,
  onPause,
  onResume,
  task,
}: {
  controlPending: boolean;
  filter: DownloadTaskFilter;
  onCancel: () => void;
  onDelete: () => void;
  onOpenFolder: () => void;
  onPause: () => void;
  onResume: () => void;
  task: DownloadTask;
}) {
  const title = downloadTaskTitle(task);
  const progressValue = task.status === "completed" ? 100 : 0;
  const progressPercent = downloadProgressPercent(task);

  if (filter === "completed") {
    return (
      <tr>
        <td>
          <DownloadFileCell title={title} />
        </td>
        <td className="download-path-cell">{task.result?.savedPath || task.savedPath || task.url}</td>
        <td>{task.result ? formatBytes(task.result.bytes) : task.totalBytes ? formatBytes(task.totalBytes) : "-"}</td>
        <td>{task.finishedAt ? formatTime(task.finishedAt) : "-"}</td>
        <td>
          <div className="download-row-actions">
            <button onClick={onOpenFolder} type="button" title={task.result?.savedPath ?? task.savedPath ?? ""}>打开文件夹</button>
            <button className="danger-action" onClick={onDelete} type="button">删除</button>
          </div>
        </td>
      </tr>
    );
  }

  if (filter === "failed") {
    return (
      <tr>
        <td>
          <DownloadFileCell title={title} />
        </td>
        <td className="download-path-cell">{task.url}</td>
        <td className="download-path-cell">{task.error ?? "下载失败"}</td>
        <td>{task.finishedAt ? formatTime(task.finishedAt) : "-"}</td>
        <td>
          <div className="download-row-actions">
            <button className="danger-action" onClick={onDelete} type="button">删除</button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <DownloadFileCell title={title} />
      </td>
      <td>
        <div className="download-table-progress">
          <progress value={progressPercent ?? progressValue} max={100} />
          <span>{downloadProgressLabel(task)}</span>
        </div>
      </td>
      <td>{task.bytesPerSecond ? `${formatBytes(task.bytesPerSecond)}/s` : "-"}</td>
      <td>{task.totalBytes ? formatBytes(task.totalBytes) : task.result ? formatBytes(task.result.bytes) : "-"}</td>
      <td>{remainingTimeLabel(task)}</td>
      <td>
        <span className={`download-status download-status-${task.status}`}>
          {downloadTaskStatusLabel(task.status)}
        </span>
      </td>
      <td>
        <div className="download-row-actions">
          {task.status === "running" ? (
            <>
              <button disabled={controlPending} onClick={onPause} type="button">暂停</button>
              <button disabled={controlPending} className="danger-action" onClick={onCancel} type="button">取消</button>
            </>
          ) : null}
          {task.status === "paused" ? (
            <>
              <button disabled={controlPending} onClick={onResume} type="button">继续</button>
              <button disabled={controlPending} className="danger-action" onClick={onCancel} type="button">取消</button>
            </>
          ) : null}
          {task.status === "completed" ? (
            <button onClick={onOpenFolder} type="button" title={task.result?.savedPath ?? task.savedPath ?? ""}>打开文件夹</button>
          ) : null}
          {task.status !== "running" && task.status !== "paused" ? (
            <button className="danger-action" onClick={onDelete} type="button">删除</button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function DownloadFileCell({ title }: { title: string }) {
  return (
    <div className="download-file-cell">
      <strong>{title}</strong>
    </div>
  );
}

function downloadTaskTitle(task: DownloadTask) {
  return task.result?.fileName || task.requestedFileName || task.url;
}

function inferDownloadFileName(source: string) {
  const trimmed = source.trim();
  try {
    const parsed = new URL(trimmed);
    const pathName = decodeURIComponent(parsed.pathname);
    const candidate = pathName.split("/").filter(Boolean).pop();
    return sanitizeFileName(candidate || "download.bin");
  } catch {
    const candidate = trimmed.split(/[\\/]+/).filter(Boolean).pop();
    return sanitizeFileName(candidate || "download.bin");
  }
}

function sanitizeFileName(value: string) {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/^\.+|\.+$/g, "")
    .trim();
  return sanitized || "download.bin";
}

function downloadProgressPercent(task: DownloadTask) {
  if (!task.totalBytes || !task.downloadedBytes) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round((task.downloadedBytes / task.totalBytes) * 100)));
}

function downloadProgressLabel(task: DownloadTask) {
  const percent = downloadProgressPercent(task);
  if (typeof percent === "number") {
    return `${percent}%`;
  }
  return task.downloadedBytes ? formatBytes(task.downloadedBytes) : "等待开始";
}

function remainingTimeLabel(task: DownloadTask) {
  if (task.status === "paused") {
    return "-";
  }
  if (task.status !== "running") {
    return "-";
  }
  if (!task.totalBytes || !task.downloadedBytes || !task.bytesPerSecond) {
    return "计算中";
  }
  const remainingBytes = Math.max(task.totalBytes - task.downloadedBytes, 0);
  const seconds = remainingBytes / task.bytesPerSecond;
  if (!Number.isFinite(seconds)) {
    return "计算中";
  }
  if (seconds < 1) {
    return "即将完成";
  }
  if (seconds < 60) {
    return `${Math.ceil(seconds)} 秒`;
  }
  return `${Math.ceil(seconds / 60)} 分钟`;
}

function downloadTaskStatusLabel(status: DownloadTaskStatus) {
  switch (status) {
    case "running":
      return "下载中";
    case "paused":
      return "已暂停";
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
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "下载失败。";
}
