import { useMemo, useState } from "react";

interface Props {
  pendingReminderCount: number;
  onOpenReminders: () => void;
  onAddReminder: () => void;
  onOpenTranslation: () => void;
  onOpenNetworkDiagnostics: () => void;
  onOpenDownloader: () => void;
  onOpenSystemMonitor: () => void;
  onOpenScriptTasks: () => void;
  onOpenSettings: () => void;
}

export function WorkbenchHome({
  pendingReminderCount,
  onOpenReminders,
  onAddReminder,
  onOpenTranslation,
  onOpenNetworkDiagnostics,
  onOpenDownloader,
  onOpenSystemMonitor,
  onOpenScriptTasks,
  onOpenSettings,
}: Props) {
  const [query, setQuery] = useState("");
  const features = useMemo(
    () => [
      {
        id: "reminders",
        label: "提醒",
        title: "提醒",
        description: `${pendingReminderCount} 个待提醒，支持单次和中国法定工作日提醒。`,
        keywords: "提醒 工作日 通知 日程 日历",
        actions: [
          { label: "查看提醒", onClick: onOpenReminders, primary: true },
          { label: "新增提醒", onClick: onAddReminder },
        ],
      },
      {
        id: "translation",
        label: "AI",
        title: "翻译",
        description: "使用 OpenAI 兼容接口或本地模型进行文本翻译。",
        keywords: "翻译 AI OpenAI 模型 本地模型 语言",
        actions: [{ label: "开始翻译", onClick: onOpenTranslation, primary: true }],
      },
      {
        id: "network",
        label: "网络",
        title: "网络检测",
        description: "Ping、端口连通性和端口占用进程查看。",
        keywords: "网络 ping 端口 检测 占用 pid 进程",
        actions: [
          { label: "开始检测", onClick: onOpenNetworkDiagnostics, primary: true },
        ],
      },
      {
        id: "download",
        label: "工具",
        title: "下载工具",
        description: "下载 HTTP/HTTPS 文件，保存到系统下载目录。",
        keywords: "下载 http https 文件 保存",
        actions: [{ label: "开始下载", onClick: onOpenDownloader, primary: true }],
      },
      {
        id: "system",
        label: "系统",
        title: "系统监控",
        description: "查看 CPU、内存、磁盘和系统运行时长。",
        keywords: "系统 监控 cpu 内存 磁盘 运行时长",
        actions: [{ label: "查看状态", onClick: onOpenSystemMonitor, primary: true }],
      },
      {
        id: "scripts",
        label: "自动化",
        title: "脚本任务",
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
  const normalizedQuery = query.trim().toLowerCase();
  const visibleFeatures = normalizedQuery
    ? features.filter((feature) =>
        `${feature.label} ${feature.title} ${feature.description} ${feature.keywords}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : features;

  return (
    <section className="workbench">
      <div className="workbench-searchbar">
        <label className="feature-search">
          <span className="sr-only">搜索功能</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索功能，例如：端口、翻译、脚本、下载"
          />
        </label>
        <button onClick={onOpenSettings}>设置</button>
      </div>

      {visibleFeatures.length > 0 ? (
        <div className="feature-grid">
          {visibleFeatures.map((feature) => (
            <article className="feature-card" key={feature.id}>
              <div className="feature-card-top">
                <span className="feature-badge">{feature.label}</span>
              </div>
              <div>
                <h3>{feature.title}</h3>
                <p className="muted">{feature.description}</p>
              </div>
              <div className="card-actions">
                {feature.actions.map((action) => (
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
        <div className="empty-state">没有找到相关功能</div>
      )}
    </section>
  );
}
