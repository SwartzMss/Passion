import { useMemo, useState } from "react";

interface Props {
  pendingReminderCount: number;
  enabledScriptTaskCount: number;
  runningScriptTaskCount: number;
  totalScriptTaskCount: number;
  onOpenReminders: () => void;
  onAddReminder: () => void;
  onOpenTranslation: () => void;
  onOpenNetworkDiagnostics: () => void;
  onOpenDownloader: () => void;
  onOpenSystemMonitor: () => void;
  onOpenScriptTasks: () => void;
}

export function WorkbenchHome({
  pendingReminderCount,
  enabledScriptTaskCount,
  runningScriptTaskCount,
  totalScriptTaskCount,
  onOpenReminders,
  onAddReminder,
  onOpenTranslation,
  onOpenNetworkDiagnostics,
  onOpenDownloader,
  onOpenSystemMonitor,
  onOpenScriptTasks,
}: Props) {
  const [query, setQuery] = useState("");
  const tools = useMemo(
    () => [
      {
        id: "reminders",
        label: "提醒",
        description: `${pendingReminderCount} 个待提醒，支持单次和中国法定工作日提醒。`,
        keywords: "提醒 工作日 通知 日程 日历",
        actions: [
          { label: "查看提醒", onClick: onOpenReminders, primary: true },
          { label: "新增提醒", onClick: onAddReminder },
        ],
      },
      {
        id: "translation",
        label: "翻译",
        description: "使用 OpenAI 兼容接口或本地模型进行文本翻译。",
        keywords: "翻译 AI OpenAI 模型 本地模型 语言",
        actions: [{ label: "开始翻译", onClick: onOpenTranslation, primary: true }],
      },
      {
        id: "network",
        label: "网络检测",
        description: "Ping、端口连通性和端口占用进程查看。",
        keywords: "网络 ping 端口 检测 占用 pid 进程",
        actions: [
          { label: "开始检测", onClick: onOpenNetworkDiagnostics, primary: true },
        ],
      },
      {
        id: "download",
        label: "下载工具",
        description: "下载 HTTP/HTTPS 文件，保存到系统下载目录。",
        keywords: "下载 http https 文件 保存",
        actions: [{ label: "开始下载", onClick: onOpenDownloader, primary: true }],
      },
      {
        id: "system",
        label: "系统监控",
        description: "查看 CPU、内存、磁盘和系统运行时长。",
        keywords: "系统 监控 cpu 内存 磁盘 运行时长",
        actions: [{ label: "查看状态", onClick: onOpenSystemMonitor, primary: true }],
      },
      {
        id: "scripts",
        label: "脚本任务",
        description: "定期执行本机脚本，并查看最近一次输出。",
        keywords: "脚本 定时 自动化 powershell bat cmd exe",
        actions: [{ label: "管理任务", onClick: onOpenScriptTasks, primary: true }],
      },
    ],
    [
      pendingReminderCount,
      onOpenReminders,
      onAddReminder,
      onOpenTranslation,
      onOpenNetworkDiagnostics,
      onOpenDownloader,
      onOpenSystemMonitor,
      onOpenScriptTasks,
    ],
  );
  const summaries = useMemo(
    () => [
      {
        label: "待提醒",
        value: String(pendingReminderCount),
        description: "当前启用且等待触发的提醒",
        keywords: "提醒 待提醒 通知 日程",
      },
      {
        label: "启用脚本",
        value: `${enabledScriptTaskCount} / ${totalScriptTaskCount}`,
        description: "后台定期任务启用情况",
        keywords: "脚本 任务 自动化 启用",
      },
      {
        label: "运行中任务",
        value: String(runningScriptTaskCount),
        description: "已启动但尚未结束的脚本",
        keywords: "运行中 脚本 任务 后台",
      },
    ],
    [enabledScriptTaskCount, pendingReminderCount, runningScriptTaskCount, totalScriptTaskCount],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTools = normalizedQuery
    ? tools.filter((tool) =>
        `${tool.label} ${tool.description} ${tool.keywords}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : [];

  return (
    <section className="workbench">
      <div className="workbench-searchbar">
        <label className="feature-search">
          <span className="sr-only">搜索工具</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索工具，例如：端口、翻译、脚本、下载"
          />
        </label>
      </div>

      {normalizedQuery ? (
        visibleTools.length > 0 ? (
          <div className="tool-results" aria-label="工具搜索结果">
            {visibleTools.map((tool) => (
              <article className="tool-result" key={tool.id}>
                <div>
                  <h3>{tool.label}</h3>
                  <p>{tool.description}</p>
                </div>
                <div className="card-actions">
                  {tool.actions.map((action) => (
                    <button
                      className={action.primary ? "primary-action" : ""}
                      key={action.label}
                      onClick={action.onClick}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">没有找到相关工具</div>
        )
      ) : (
        <div className="workbench-summary" aria-label="工作台摘要">
          {summaries.map((item) => (
            <article className="summary-card" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
