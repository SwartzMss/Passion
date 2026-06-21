import { useState } from "react";
import { checkPort, inspectPortOccupancy, pingHost } from "../lib/api";
import type {
  PingResult,
  PortCheckResult,
  PortOccupancyEntry,
  PortOccupancyResult,
} from "../types";

export function NetworkDiagnosticsPanel() {
  const [pingHostValue, setPingHostValue] = useState("");
  const [portHost, setPortHost] = useState("127.0.0.1");
  const [portValue, setPortValue] = useState("80");
  const [occupancyPort, setOccupancyPort] = useState("1420");
  const [pingResult, setPingResult] = useState<PingResult | null>(null);
  const [portResult, setPortResult] = useState<PortCheckResult | null>(null);
  const [occupancyResult, setOccupancyResult] =
    useState<PortOccupancyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPingRunning, setIsPingRunning] = useState(false);
  const [isPortRunning, setIsPortRunning] = useState(false);
  const [isOccupancyRunning, setIsOccupancyRunning] = useState(false);
  const portValidation = validatePortValue(portValue);
  const occupancyValidation = validatePortValue(occupancyPort);

  async function runPing() {
    if (!pingHostValue.trim()) {
      setError("请输入要 Ping 的 IP 或域名。");
      return;
    }
    setError(null);
    setIsPingRunning(true);
    try {
      const result = await pingHost({ host: pingHostValue.trim() });
      setPingResult(result);
    } catch (err) {
      setError(readError(err));
    } finally {
      setIsPingRunning(false);
    }
  }

  async function runPortCheck() {
    if (!portHost.trim()) {
      setError("请输入 Host。");
      return;
    }
    if (portValidation) {
      setError(portValidation);
      return;
    }
    const port = Number(portValue);
    setError(null);
    setIsPortRunning(true);
    try {
      const result = await checkPort({ host: portHost.trim(), port });
      setPortResult(result);
    } catch (err) {
      setError(readError(err));
    } finally {
      setIsPortRunning(false);
    }
  }

  async function runPortOccupancy() {
    if (occupancyValidation) {
      setError(occupancyValidation);
      return;
    }
    const port = Number(occupancyPort);
    setError(null);
    setIsOccupancyRunning(true);
    try {
      const result = await inspectPortOccupancy({ port });
      setOccupancyResult(result);
    } catch (err) {
      setError(readError(err));
    } finally {
      setIsOccupancyRunning(false);
    }
  }

  return (
    <section className="network-panel">
      <div className="network-hero">
        <div>
          <h1>网络检测</h1>
          <p>检查网络连通性、TCP 端口开放情况和本机端口占用。</p>
        </div>
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="diagnostics-grid">
        <article className="diagnostics-card">
          <div className="diagnostics-card-header">
            <div>
              <h3>Ping 检测</h3>
              <p>检测目标地址是否可以访问</p>
            </div>
            <StatusBadge
              status={isPingRunning ? "running" : pingResult?.reachable ? "success" : pingResult ? "failure" : "idle"}
              label={isPingRunning ? "检测中" : pingResult?.reachable ? "正常" : pingResult ? "异常" : "待检测"}
            />
          </div>
          <label className="field-label">
            Ping 目标
            <input
              value={pingHostValue}
              onChange={(event) => setPingHostValue(event.target.value)}
              placeholder="例如 github.com 或 192.168.1.1"
              title="输入域名或 IP 地址，用于判断网络连通性"
            />
          </label>
          <p className="diagnostics-help">例如：github.com 或 192.168.1.1</p>
          <button
            className="diagnostics-button"
            onClick={runPing}
            disabled={isPingRunning}
            title="发送 Ping 请求并查看是否可达"
          >
            <span aria-hidden="true">{isPingRunning ? "…" : "✈"}</span>
            {isPingRunning ? "检测中..." : "开始 Ping"}
          </button>
          <div className="diagnostics-divider" />
          <h4>检测结果</h4>
          <PingResultBox result={pingResult} />
        </article>

        <article className="diagnostics-card">
          <div className="diagnostics-card-header">
            <div>
              <h3>端口检测</h3>
              <p>检测指定主机的 TCP 端口是否开放</p>
            </div>
            <StatusBadge
              status={isPortRunning ? "running" : portResult?.open ? "success" : portResult ? "failure" : "idle"}
              label={isPortRunning ? "检测中" : portResult?.open ? "开放" : portResult ? "关闭" : "待检测"}
            />
          </div>
          <label className="field-label">
            主机地址
            <input
              id="network-host"
              value={portHost}
              onChange={(event) => setPortHost(event.target.value)}
              title="输入要检测的目标主机，例如 127.0.0.1 或 example.com"
            />
          </label>
          <label className="field-label">
            端口号
            <input
              id="network-port"
              inputMode="numeric"
              type="number"
              value={portValue}
              onChange={(event) => setPortValue(event.target.value)}
              title="端口范围为 1 到 65535"
            />
          </label>
          {portValidation ? (
            <p className="field-hint error">{portValidation}</p>
          ) : null}
          <button
            className="diagnostics-button"
            onClick={runPortCheck}
            disabled={isPortRunning || Boolean(portValidation)}
            title="检测指定 TCP 端口是否开放"
          >
            <span aria-hidden="true">{isPortRunning ? "…" : "◧"}</span>
            {isPortRunning ? "检测中..." : "检测端口"}
          </button>
          <div className="diagnostics-divider" />
          <h4>检测结果</h4>
          <PortCheckResultBox result={portResult} />
        </article>

        <article className="diagnostics-card">
          <div className="diagnostics-card-header">
            <div>
              <h3>端口占用</h3>
              <p>查看本机端口被哪个进程占用</p>
            </div>
            <StatusBadge
              status={
                isOccupancyRunning
                  ? "running"
                  : occupancyResult
                  ? occupancyResult.entries.length > 0
                    ? "failure"
                    : "success"
                  : "idle"
              }
              label={
                isOccupancyRunning
                  ? "检测中"
                  : occupancyResult
                  ? occupancyResult.entries.length > 0
                    ? "已占用"
                    : "未占用"
                  : "待检测"
              }
            />
          </div>
          <label className="field-label">
            端口号
            <input
              id="occupancy-port"
              inputMode="numeric"
              type="number"
              value={occupancyPort}
              onChange={(event) => setOccupancyPort(event.target.value)}
              title="输入本机端口，查看是否被进程占用"
            />
          </label>
          {occupancyValidation ? (
            <p className="field-hint error">{occupancyValidation}</p>
          ) : null}
          <button
            className="diagnostics-button query-button"
            onClick={runPortOccupancy}
            disabled={isOccupancyRunning || Boolean(occupancyValidation)}
            title="查看本机端口占用进程"
          >
            <span aria-hidden="true">{isOccupancyRunning ? "…" : "⌕"}</span>
            {isOccupancyRunning ? "检测中..." : "查看占用"}
          </button>
          <div className="diagnostics-divider" />
          <h4>检测结果</h4>
          <PortOccupancyResultBox result={occupancyResult} />
        </article>
      </div>
      <p className="network-tip">💡 小提示：支持域名、IPv4 地址，端口范围 1-65535。</p>
    </section>
  );
}

function StatusBadge({
  label,
  status,
}: {
  label: string;
  status: "idle" | "running" | "success" | "failure";
}) {
  return (
    <span className={`diagnostics-status ${status}`}>
      <span aria-hidden="true" />
      {label}
    </span>
  );
}

function PingResultBox({ result }: { result: PingResult | null }) {
  if (!result) {
    return null;
  }
  return (
    <div className={`diagnostics-result ${result.reachable ? "success" : "failure"}`}>
      <strong>{result.reachable ? `${result.host} 可连通` : `${result.host} 不可达`}</strong>
      <span className="sr-only">{result.reachable ? "Ping 成功" : "Ping 失败"}</span>
      <div className="ping-metrics">
        <MetricItem label="平均延迟" value={formatMs(result.avgTimeMs)} />
        <MetricItem label="最小延迟" value={formatMs(result.minTimeMs)} />
        <MetricItem label="最大延迟" value={formatMs(result.maxTimeMs)} />
        <MetricItem label="丢包率" value={formatPercent(result.lossPercent)} />
        <MetricItem
          label="数据包"
          value={formatPackets(result.packetsReceived, result.packetsTransmitted)}
        />
        <MetricItem label="TTL" value={formatOptionalNumber(result.ttl)} />
      </div>
      {result.replies.length > 0 ? (
        <div className="ping-replies" aria-label="Ping 响应明细">
          {result.replies.map((reply, index) => (
            <span key={`${reply.timeMs}-${reply.ttl}-${index}`}>
              #{index + 1} {formatMs(reply.timeMs)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function PortCheckResultBox({ result }: { result: PortCheckResult | null }) {
  if (!result) {
    return null;
  }
  return (
    <div className={`diagnostics-result ${result.open ? "success" : "failure"}`}>
      <strong>
        {result.host}:{result.port} 端口{result.open ? "已开放" : "未开放"}
      </strong>
      <span className="sr-only">{result.open ? "开放" : "未开放"}</span>
      <p>
        协议：TCP · 响应时间：{result.elapsedMs}ms
      </p>
      {result.error ? <p>{result.error}</p> : null}
    </div>
  );
}

function PortOccupancyResultBox({
  result,
}: {
  result: PortOccupancyResult | null;
}) {
  if (!result) {
    return null;
  }
  const occupied = result.entries.length > 0;
  return (
    <div className={`diagnostics-result ${occupied ? "failure" : "success"}`}>
      <strong>端口 {result.port} {occupied ? "已被占用" : "未被占用"}</strong>
      {occupied ? (
        result.entries.map((entry) => (
          <PortOccupancyRow entry={entry} key={`${entry.pid}-${entry.localAddress}`} />
        ))
      ) : (
        <p>未发现监听进程</p>
      )}
    </div>
  );
}

function PortOccupancyRow({ entry }: { entry: PortOccupancyEntry }) {
  return (
    <div className="port-occupancy-row">
      <p>
        <strong>{entry.processName || "未知进程"}</strong>
      </p>
      <p className="muted">PID {entry.pid}</p>
      <p className="muted">{entry.localAddress}</p>
    </div>
  );
}

function validatePortValue(value: string) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return "端口范围 1-65535";
  }
  return null;
}

function formatMs(value?: number | null) {
  return value === null || value === undefined ? "--" : `${formatNumber(value)} ms`;
}

function formatPercent(value?: number | null) {
  return value === null || value === undefined ? "--" : `${formatNumber(value)}%`;
}

function formatPackets(received?: number | null, transmitted?: number | null) {
  if (received === null || received === undefined || transmitted === null || transmitted === undefined) {
    return "--";
  }
  return `${received} / ${transmitted}`;
}

function formatOptionalNumber(value?: number | null) {
  return value === null || value === undefined ? "--" : String(value);
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "网络检测失败。";
}
