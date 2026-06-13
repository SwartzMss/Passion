import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getSystemSnapshot } from "../lib/api";
import type { SystemSnapshot } from "../types";

interface SnapshotPoint extends SystemSnapshot {
  capturedAt: Date;
}

export function SystemMonitorPanel() {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [history, setHistory] = useState<SnapshotPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [intervalSeconds, setIntervalSeconds] = useState(5);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      const nextSnapshot = await getSystemSnapshot();
      const capturedAt = new Date();
      setSnapshot(nextSnapshot);
      setLastUpdatedAt(capturedAt);
      setHistory((items) => [
        ...items.slice(-29),
        { ...nextSnapshot, capturedAt },
      ]);
    } catch (err) {
      setError(readError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void refresh();
    }, intervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, intervalSeconds, refresh]);

  const metrics = useMemo(() => {
    if (!snapshot) {
      return null;
    }
    const memoryPercent = usagePercent(
      snapshot.memoryUsedBytes,
      snapshot.memoryTotalBytes,
    );
    const diskPercent = usagePercent(snapshot.diskUsedBytes, snapshot.diskTotalBytes);

    return {
      memoryPercent,
      diskPercent,
      cpuStatus: snapshot.cpuUsagePercent >= 80 ? "注意" : "正常",
      memoryStatus: memoryPercent >= 85 ? "注意" : "正常",
      diskStatus: diskPercent >= 85 ? "注意" : "正常",
    };
  }, [snapshot]);

  return (
    <section className="system-panel">
      <div className="system-hero">
        <div>
          <h1>系统监控</h1>
          <p className="muted">查看本机基础资源占用，按需手动刷新。</p>
        </div>
        <div className="system-toolbar">
          <label className="system-toggle">
            <span>自动刷新</span>
            <input
              aria-label="自动刷新"
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
          </label>
          <select
            aria-label="刷新间隔"
            value={intervalSeconds}
            onChange={(event) => setIntervalSeconds(Number(event.target.value))}
          >
            <option value={5}>5 秒</option>
            <option value={10}>10 秒</option>
            <option value={30}>30 秒</option>
          </select>
          <button className="secondary-action" onClick={refresh} disabled={isLoading}>
            {isLoading ? "刷新中..." : "刷新"}
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
        <>
          <div className="system-metric-grid">
            <MetricCard
              title="CPU 使用率"
              icon="CPU"
              tone="blue"
              status={metrics?.cpuStatus ?? "正常"}
              value={`${snapshot.cpuUsagePercent.toFixed(1)}%`}
              detail={snapshot.cpuUsagePercent >= 80 ? "当前负载较高" : "当前负载较低"}
              progress={snapshot.cpuUsagePercent}
              meta={["核心数：--", "线程数：--"]}
            />
            <MetricCard
              title="内存"
              icon="RAM"
              tone="purple"
              status={metrics?.memoryStatus ?? "正常"}
              value={formatBytesPair(
                snapshot.memoryUsedBytes,
                snapshot.memoryTotalBytes,
              )}
              detail={`已使用 ${(metrics?.memoryPercent ?? 0).toFixed(1)}%`}
              progress={metrics?.memoryPercent ?? 0}
              meta={["类型：--", "频率：--"]}
            />
            <MetricCard
              title="磁盘"
              icon="DISK"
              tone="orange"
              status={metrics?.diskStatus ?? "正常"}
              value={formatBytesPair(snapshot.diskUsedBytes, snapshot.diskTotalBytes)}
              detail={`已使用 ${(metrics?.diskPercent ?? 0).toFixed(1)}%`}
              progress={metrics?.diskPercent ?? 0}
              meta={["健康状态：--", "温度：--"]}
            />
            <MetricCard
              title="运行时长"
              icon="UP"
              tone="green"
              status="正常"
              value={formatUptime(snapshot.uptimeSeconds)}
              detail="系统启动后"
              meta={["启动时间：需要后端支持"]}
            />
          </div>

          <div className="system-dashboard-grid">
            <PanelCard title="资源使用趋势（最近 60 秒）">
              <TrendChart history={history} />
            </PanelCard>

            <PanelCard title="磁盘分区使用情况">
              <div className="system-disk-list">
                <DiskUsageRow
                  name="本机磁盘"
                  used={snapshot.diskUsedBytes}
                  total={snapshot.diskTotalBytes}
                />
                <p className="system-placeholder">分区明细需要后端补充。</p>
              </div>
            </PanelCard>

            <PanelCard title="高占用进程（按 CPU 使用率排序）">
              <div className="system-process-table" role="table">
                <div className="system-process-head" role="row">
                  <span>进程名</span>
                  <span>CPU</span>
                  <span>内存</span>
                  <span>状态</span>
                </div>
                <div className="system-empty-row" role="row">
                  进程明细需要后端补充。
                </div>
              </div>
            </PanelCard>

            <PanelCard title="系统信息">
              <dl className="system-info-list">
                <div>
                  <dt>操作系统</dt>
                  <dd>需要后端支持</dd>
                </div>
                <div>
                  <dt>处理器</dt>
                  <dd>需要后端支持</dd>
                </div>
                <div>
                  <dt>内存</dt>
                  <dd>
                    {formatBytes(snapshot.memoryTotalBytes)}（已使用{" "}
                    {formatBytes(snapshot.memoryUsedBytes)}）
                  </dd>
                </div>
                <div>
                  <dt>系统类型</dt>
                  <dd>需要后端支持</dd>
                </div>
              </dl>
            </PanelCard>
          </div>
        </>
      ) : (
        <p className="muted">正在读取系统状态...</p>
      )}
    </section>
  );
}

function MetricCard({
  title,
  icon,
  tone,
  status,
  value,
  detail,
  progress,
  meta,
}: {
  title: string;
  icon: string;
  tone: "blue" | "purple" | "orange" | "green";
  status: string;
  value: string;
  detail: string;
  progress?: number;
  meta: string[];
}) {
  return (
    <article className="system-card">
      <div className="system-card-header">
        <span className={`system-icon ${tone}`} aria-hidden="true">
          {icon}
        </span>
        <h3>{title}</h3>
        <span className={`system-badge ${status === "正常" ? "normal" : "warn"}`}>
          {status}
        </span>
      </div>
      <strong className="system-value">{value}</strong>
      <p className="muted">{detail}</p>
      {typeof progress === "number" ? (
        <div className="system-progress" aria-hidden="true">
          <span style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }} />
        </div>
      ) : null}
      <div className="system-card-meta">
        {meta.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </article>
  );
}

function PanelCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <article className="system-panel-card">
      <h2>{title}</h2>
      {children}
    </article>
  );
}

function TrendChart({ history }: { history: SnapshotPoint[] }) {
  const points = history.length > 1 ? history : duplicateSinglePoint(history);
  const cpuLine = buildPolyline(points.map((point) => point.cpuUsagePercent));
  const memoryLine = buildPolyline(
    points.map((point) => usagePercent(point.memoryUsedBytes, point.memoryTotalBytes)),
  );

  return (
    <div className="system-chart">
      <div className="system-chart-legend">
        <span>
          <i className="cpu" /> CPU (%)
        </span>
        <span>
          <i className="memory" /> 内存 (%)
        </span>
      </div>
      <svg viewBox="0 0 320 140" role="img" aria-label="CPU 和内存使用趋势">
        <g className="system-grid-lines">
          <line x1="0" x2="320" y1="20" y2="20" />
          <line x1="0" x2="320" y1="60" y2="60" />
          <line x1="0" x2="320" y1="100" y2="100" />
        </g>
        <polyline className="cpu-line" points={cpuLine} />
        <polyline className="memory-line" points={memoryLine} />
      </svg>
      <div className="system-chart-axis">
        <span>60 秒前</span>
        <span>现在</span>
      </div>
    </div>
  );
}

function DiskUsageRow({
  name,
  used,
  total,
}: {
  name: string;
  used: number;
  total: number;
}) {
  const percent = usagePercent(used, total);
  return (
    <div className="system-disk-row">
      <div>
        <strong>{name}</strong>
        <span>
          {formatBytes(used)} / {formatBytes(total)}
        </span>
      </div>
      <div className="system-progress" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      <b>{Math.round(percent)}%</b>
    </div>
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

function usagePercent(used: number, total: number) {
  if (total <= 0) {
    return 0;
  }
  return Math.min((used / total) * 100, 100);
}

function formatDateTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
}

function duplicateSinglePoint(history: SnapshotPoint[]) {
  if (history.length === 0) {
    return [];
  }
  return [history[0], history[0]];
}

function buildPolyline(values: number[]) {
  if (values.length === 0) {
    return "";
  }
  const width = 320;
  const height = 120;
  const topOffset = 10;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  return values
    .map((value, index) => {
      const x = index * step;
      const y = topOffset + height - (Math.min(Math.max(value, 0), 100) / 100) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "读取系统状态失败。";
}
