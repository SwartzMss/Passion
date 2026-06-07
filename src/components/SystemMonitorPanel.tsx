import { useEffect, useState } from "react";
import { getSystemSnapshot } from "../lib/api";
import type { SystemSnapshot } from "../types";

interface Props {
  onBack: () => void;
}

export function SystemMonitorPanel({ onBack }: Props) {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function refresh() {
    setError(null);
    setIsLoading(true);
    try {
      setSnapshot(await getSystemSnapshot());
    } catch (err) {
      setError(readError(err));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <section className="system-panel">
      <div className="section-header">
        <div>
          <h2>系统监控</h2>
          <p className="muted">查看本机基础资源占用，按需手动刷新。</p>
        </div>
        <div className="card-actions">
          <button onClick={refresh} disabled={isLoading}>
            {isLoading ? "刷新中..." : "刷新"}
          </button>
          <button onClick={onBack}>返回工作台</button>
        </div>
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {snapshot ? (
        <div className="system-grid">
          <MetricCard
            title="CPU"
            value={`${snapshot.cpuUsagePercent.toFixed(1)}%`}
            detail="当前使用率"
          />
          <MetricCard
            title="内存"
            value={formatBytesPair(
              snapshot.memoryUsedBytes,
              snapshot.memoryTotalBytes,
            )}
            detail="已用 / 总量"
          />
          <MetricCard
            title="磁盘"
            value={formatBytesPair(snapshot.diskUsedBytes, snapshot.diskTotalBytes)}
            detail="已用 / 总量"
          />
          <MetricCard
            title="运行时长"
            value={formatUptime(snapshot.uptimeSeconds)}
            detail="系统启动后"
          />
        </div>
      ) : (
        <p className="muted">正在读取系统状态...</p>
      )}
    </section>
  );
}

function MetricCard({
  title,
  value,
  detail,
}: {
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="system-card">
      <h3>{title}</h3>
      <strong>{value}</strong>
      <p className="muted">{detail}</p>
    </article>
  );
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

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "读取系统状态失败。";
}
