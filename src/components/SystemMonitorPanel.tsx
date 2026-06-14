import { useCallback, useEffect, useMemo, useState } from "react";
import { getSystemSnapshot } from "../lib/api";
import type { SystemSnapshot } from "../types";

type MetricTone = "blue" | "purple" | "orange" | "green";

interface MetricCardModel {
  title: string;
  icon: string;
  tone: MetricTone;
  status: "正常" | "注意";
  value: string;
  detail: string;
  progress?: number;
}

export function SystemMonitorPanel() {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      const nextSnapshot = await getSystemSnapshot();
      setSnapshot(nextSnapshot);
      setLastUpdatedAt(new Date());
    } catch (err) {
      setError(readError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const cards = useMemo(() => (snapshot ? buildMetricCards(snapshot) : []), [snapshot]);

  return (
    <section className="system-panel system-panel-simple">
      <div className="system-simple-header">
        <div>
          <h1>系统监控</h1>
          <p className="muted">查看本机基础资源占用。</p>
        </div>
        <div className="system-simple-actions">
          <button className="secondary-action" onClick={refresh} disabled={isLoading}>
            {isLoading ? "刷新中..." : "↻ 刷新"}
          </button>
          <span className="system-updated">
            上次更新：{lastUpdatedAt ? formatDateTime(lastUpdatedAt) : "--"}
          </span>
        </div>
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {snapshot ? (
        <div className="system-simple-grid">
          {cards.map((card) => (
            <MetricCard key={card.title} card={card} />
          ))}
        </div>
      ) : (
        <p className="muted">正在读取系统状态...</p>
      )}
    </section>
  );
}

function MetricCard({ card }: { card: MetricCardModel }) {
  const progress = typeof card.progress === "number"
    ? Math.min(Math.max(card.progress, 0), 100)
    : null;

  return (
    <article className="system-card system-card-simple">
      <div className="system-card-header">
        <span className={`system-icon ${card.tone}`} aria-hidden="true">
          {card.icon}
        </span>
        <h3>{card.title}</h3>
        <span className={`system-badge ${card.status === "正常" ? "normal" : "warn"}`}>
          {card.status}
        </span>
      </div>
      <strong className="system-value">{card.value}</strong>
      <p className="muted">{card.detail}</p>
      <div className="system-progress-row">
        <div className="system-progress" aria-hidden="true">
          <span style={{ width: `${progress ?? 100}%` }} />
        </div>
        {progress !== null ? <span>{formatPercent(progress)}</span> : null}
      </div>
    </article>
  );
}

function buildMetricCards(snapshot: SystemSnapshot): MetricCardModel[] {
  const memoryPercent = usagePercent(
    snapshot.memoryUsedBytes,
    snapshot.memoryTotalBytes,
  );
  const diskPercent = usagePercent(snapshot.diskUsedBytes, snapshot.diskTotalBytes);

  return [
    {
      title: "CPU 使用率",
      icon: "CPU",
      tone: "blue",
      status: snapshot.cpuUsagePercent >= 80 ? "注意" : "正常",
      value: formatPercent(snapshot.cpuUsagePercent),
      detail: snapshot.cpuUsagePercent >= 80 ? "当前负载较高" : "当前负载较低",
      progress: snapshot.cpuUsagePercent,
    },
    {
      title: "内存",
      icon: "RAM",
      tone: "purple",
      status: memoryPercent >= 85 ? "注意" : "正常",
      value: formatBytesPair(snapshot.memoryUsedBytes, snapshot.memoryTotalBytes),
      detail: formatPercent(memoryPercent),
      progress: memoryPercent,
    },
    {
      title: "磁盘",
      icon: "DISK",
      tone: "orange",
      status: diskPercent >= 85 ? "注意" : "正常",
      value: formatBytesPair(snapshot.diskUsedBytes, snapshot.diskTotalBytes),
      detail: formatPercent(diskPercent),
      progress: diskPercent,
    },
    {
      title: "运行时长",
      icon: "UPTIME",
      tone: "green",
      status: "正常",
      value: formatUptime(snapshot.uptimeSeconds),
      detail: "系统启动后",
    },
  ];
}

function formatBytesPair(used: number, total: number) {
  return `${formatBytes(used)} / ${formatBytes(total)}`;
}

function formatBytes(bytes: number) {
  const gb = bytes / 1024 / 1024 / 1024;
  return `${gb.toFixed(1)} GB`;
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return `${days} 天 ${hours} 小时`;
  }
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`;
  }
  return `${minutes} 分钟`;
}

function usagePercent(used: number, total: number) {
  if (total <= 0) {
    return 0;
  }
  return Math.min((used / total) * 100, 100);
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatDateTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "读取系统状态失败。";
}
