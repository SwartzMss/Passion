import { useMemo, useState } from "react";

interface Props {
  pendingReminderCount: number;
  enabledScriptTaskCount: number;
  runningScriptTaskCount: number;
  runningSshTunnelCount: number;
  totalScriptTaskCount: number;
  onOpenReminders: () => void;
  onAddReminder: () => void;
  onOpenTranslation: () => void;
  onOpenNetworkDiagnostics: () => void;
  onOpenSshTunnels: () => void;
  onOpenDownloader: () => void;
  onOpenScriptTasks: () => void;
  onOpenUtilities: () => void;
}

export function WorkbenchHome({
  pendingReminderCount,
  runningScriptTaskCount,
  runningSshTunnelCount,
  onOpenReminders,
  onAddReminder,
  onOpenTranslation,
  onOpenNetworkDiagnostics,
  onOpenSshTunnels,
  onOpenDownloader,
  onOpenScriptTasks,
  onOpenUtilities,
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
        description: "端口连通性和端口占用进程查看。",
        keywords: "网络 端口 检测 占用 pid 进程",
        actions: [
          { label: "开始检测", onClick: onOpenNetworkDiagnostics, primary: true },
        ],
      },
      {
        id: "ssh",
        label: "SSH 隧道",
        description: "管理本地端口转发隧道，支持 QNX、Linux 和内网服务访问。",
        keywords: "ssh 隧道 端口转发 qnx linux 内网",
        actions: [{ label: "管理隧道", onClick: onOpenSshTunnels, primary: true }],
      },
      {
        id: "download",
        label: "下载工具",
        description: "下载 HTTP/HTTPS 文件，保存到系统下载目录。",
        keywords: "下载 http https 文件 保存",
        actions: [{ label: "开始下载", onClick: onOpenDownloader, primary: true }],
      },
      {
        id: "scripts",
        label: "脚本任务",
        description: "定期执行本机脚本，并查看最近一次输出。",
        keywords: "脚本 定时 自动化 powershell bat cmd exe",
        actions: [{ label: "管理任务", onClick: onOpenScriptTasks, primary: true }],
      },
      {
        id: "utilities",
        label: "实用工具",
        description: "Base64、Hex 和时间戳转换。",
        keywords: "实用 工具 base64 hex 十六进制 时间戳 编码 解码",
        actions: [{ label: "打开工具", onClick: onOpenUtilities, primary: true }],
      },
    ],
    [
      pendingReminderCount,
      onOpenReminders,
      onAddReminder,
      onOpenTranslation,
      onOpenNetworkDiagnostics,
      onOpenSshTunnels,
      onOpenDownloader,
      onOpenScriptTasks,
      onOpenUtilities,
    ],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTools = normalizedQuery
    ? tools.filter((tool) =>
        `${tool.label} ${tool.description} ${tool.keywords}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : [];
  const statusCards = [
    {
      id: "reminders",
      icon: "alarm",
      label: "待提醒",
      value: String(pendingReminderCount),
      description: "今日待触发提醒",
      meta: "查看提醒",
      tone: "blue",
      onClick: onOpenReminders,
    },
    {
      id: "downloads",
      icon: "download",
      label: "下载中",
      value: "0",
      description: "正在进行的下载任务",
      meta: "查看下载",
      tone: "green",
      onClick: onOpenDownloader,
    },
    {
      id: "scripts",
      icon: "code",
      label: "运行中脚本",
      value: String(runningScriptTaskCount),
      description: "正在执行的脚本任务",
      meta: "查看脚本任务",
      tone: "purple",
      onClick: onOpenScriptTasks,
    },
    {
      id: "ssh",
      icon: "network",
      label: "SSH 隧道",
      value: String(runningSshTunnelCount),
      description: "运行中隧道",
      meta: "查看 SSH 隧道",
      tone: "orange",
      onClick: onOpenSshTunnels,
    },
  ];
  return (
    <section className="workbench">
      <div className="workbench-hero">
        <div>
          <h1>工作台</h1>
          <p>欢迎使用 Passion，快速查看任务状态并启动常用工具。</p>
        </div>
      </div>

      <div className="workbench-searchbar">
        <label className="feature-search">
          <span className="sr-only">搜索工具</span>
          <input
            aria-label="搜索工具"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索功能或输入命令，例如：翻译、端口、下载、脚本任务..."
          />
          <kbd>Ctrl + K</kbd>
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
        <>
          <div className="workbench-status-grid" aria-label="工作台摘要">
            {statusCards.map((item) => (
              <article className="workbench-status-card" key={item.id}>
                <span className={`workbench-status-icon ${item.tone}`} aria-hidden="true">
                  <StatusIcon name={item.icon} />
                </span>
                <div>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <p>{item.description}</p>
                </div>
                <button type="button" onClick={item.onClick}>
                  {item.meta}
                </button>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function StatusIcon({ name }: { name: string }) {
  switch (name) {
    case "alarm":
      return (
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M7 4.5 4.8 2.8M17 4.5l2.2-1.7M7.5 20.5l1.2-2.1M16.5 20.5l-1.2-2.1" />
          <circle cx="12" cy="11.5" r="6.5" />
          <path d="M12 8v4l2.6 1.6" />
        </svg>
      );
    case "download":
      return (
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M12 4v10" />
          <path d="m7.5 9.5 4.5 4.5 4.5-4.5" />
          <path d="M5 18.5h14" />
        </svg>
      );
    case "code":
      return (
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="m9 7-5 5 5 5" />
          <path d="m15 7 5 5-5 5" />
          <path d="m13 5-2 14" />
        </svg>
      );
    case "activity":
      return (
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M4 13h4l2-6 4 12 2-6h4" />
        </svg>
      );
    case "network":
      return (
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M7 8h4v4H7z" />
          <path d="M16 4h3v3h-3z" />
          <path d="M16 17h3v3h-3z" />
          <path d="M11 10h3.5c1.2 0 1.8-.6 1.8-1.8V7" />
          <path d="M11 10h3.5c1.2 0 1.8.6 1.8 1.8V17" />
        </svg>
      );
    default:
      return null;
  }
}
