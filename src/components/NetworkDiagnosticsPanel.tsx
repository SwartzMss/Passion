import { useState } from "react";
import { checkPort, inspectPortOccupancy, pingHost } from "../lib/api";
import type {
  PingResult,
  PortCheckResult,
  PortOccupancyEntry,
  PortOccupancyResult,
} from "../types";

interface HistoryEntry {
  id: string;
  label: string;
  status: "success" | "failure";
  detail: string;
}

export function NetworkDiagnosticsPanel() {
  const [pingHostValue, setPingHostValue] = useState("");
  const [portHost, setPortHost] = useState("127.0.0.1");
  const [portValue, setPortValue] = useState("80");
  const [occupancyPort, setOccupancyPort] = useState("1420");
  const [pingResult, setPingResult] = useState<PingResult | null>(null);
  const [portResult, setPortResult] = useState<PortCheckResult | null>(null);
  const [occupancyResult, setOccupancyResult] =
    useState<PortOccupancyResult | null>(null);
  const [pingHistory, setPingHistory] = useState<HistoryEntry[]>([]);
  const [portHistory, setPortHistory] = useState<HistoryEntry[]>([]);
  const [occupancyHistory, setOccupancyHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const portValidation = validatePortValue(portValue);
  const occupancyValidation = validatePortValue(occupancyPort);

  async function runPing() {
    if (!pingHostValue.trim()) {
      setError("请输入要 Ping 的 IP 或域名。");
      return;
    }
    setError(null);
    setIsRunning(true);
    try {
      const result = await pingHost({ host: pingHostValue.trim() });
      setPingResult(result);
      pushHistory(setPingHistory, {
        label: result.host,
        status: result.reachable ? "success" : "failure",
        detail: `${result.reachable ? "Ping 成功" : "Ping 失败"} · ${
          formatPingTime(result) ?? result.summary
        }`,
      });
    } catch (err) {
      setError(readError(err));
    } finally {
      setIsRunning(false);
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
    setIsRunning(true);
    try {
      const result = await checkPort({ host: portHost.trim(), port });
      setPortResult(result);
      pushHistory(setPortHistory, {
        label: `${result.host}:${result.port}`,
        status: result.open ? "success" : "failure",
        detail: `${result.open ? "开放" : "未开放"} · ${result.elapsedMs}ms`,
      });
    } catch (err) {
      setError(readError(err));
    } finally {
      setIsRunning(false);
    }
  }

  async function runPortOccupancy() {
    if (occupancyValidation) {
      setError(occupancyValidation);
      return;
    }
    const port = Number(occupancyPort);
    setError(null);
    setIsRunning(true);
    try {
      const result = await inspectPortOccupancy({ port });
      setOccupancyResult(result);
      pushHistory(setOccupancyHistory, {
        label: `端口 ${result.port}`,
        status: result.entries.length > 0 ? "failure" : "success",
        detail:
          result.entries.length > 0
            ? `已占用 · ${result.entries.length} 个进程`
            : "未占用",
      });
    } catch (err) {
      setError(readError(err));
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section className="network-panel">
      <div className="section-header">
        <div>
          <h2>网络检测</h2>
          <p className="muted">检查网络连通性、TCP 端口开放情况和本机端口占用。</p>
        </div>
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="diagnostics-grid">
        <article className="diagnostics-card">
          <h3>Ping 检测</h3>
          <label className="field-label">
            Ping 目标
            <input
              value={pingHostValue}
              onChange={(event) => setPingHostValue(event.target.value)}
              placeholder="例如 github.com 或 192.168.1.1"
              title="输入域名或 IP 地址，用于判断网络连通性"
            />
          </label>
          <button
            className="diagnostics-button"
            onClick={runPing}
            disabled={isRunning}
            title="发送 Ping 请求并查看是否可达"
          >
            <span aria-hidden="true">✈</span>
            开始 Ping
          </button>
          <p className="diagnostics-help">判断网络连通性</p>
          <PingResultBox result={pingResult} />
          <HistoryPanel entries={pingHistory} />
        </article>

        <article className="diagnostics-card">
          <h3>端口检测</h3>
          <label className="field-label">
            Host
            <input
              value={portHost}
              onChange={(event) => setPortHost(event.target.value)}
              title="输入要检测的目标主机，例如 127.0.0.1 或 example.com"
            />
          </label>
          <label className="field-label">
            Port
            <input
              inputMode="numeric"
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
            disabled={isRunning || Boolean(portValidation)}
            title="检测指定 TCP 端口是否开放"
          >
            <span aria-hidden="true">◧</span>
            检测端口
          </button>
          <p className="diagnostics-help">判断指定 TCP 端口是否开放</p>
          <PortCheckResultBox result={portResult} />
          <HistoryPanel entries={portHistory} />
        </article>

        <article className="diagnostics-card">
          <h3>端口占用</h3>
          <label className="field-label">
            占用端口
            <input
              inputMode="numeric"
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
            disabled={isRunning || Boolean(occupancyValidation)}
            title="查看本机端口占用进程"
          >
            <span aria-hidden="true">⌕</span>
            查看占用
          </button>
          <p className="diagnostics-help">判断本机端口是否被占用</p>
          <PortOccupancyResultBox result={occupancyResult} />
          <HistoryPanel entries={occupancyHistory} />
        </article>
      </div>
    </section>
  );
}

function PingResultBox({ result }: { result: PingResult | null }) {
  if (!result) {
    return null;
  }
  const pingTime = formatPingTime(result);
  return (
    <div className={`diagnostics-result ${result.reachable ? "success" : "failure"}`}>
      <strong>{result.reachable ? "Ping 成功" : "Ping 失败"}</strong>
      <p>{pingTime ?? result.summary}</p>
      <pre>{result.rawOutput}</pre>
    </div>
  );
}

function PortCheckResultBox({ result }: { result: PortCheckResult | null }) {
  if (!result) {
    return null;
  }
  return (
    <div className={`diagnostics-result ${result.open ? "success" : "failure"}`}>
      <strong>{result.open ? "开放" : "未开放"}</strong>
      <p>
        {result.host}:{result.port} · {result.elapsedMs}ms
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
      <strong>{occupied ? "已占用" : "未占用"}</strong>
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

function HistoryPanel({ entries }: { entries: HistoryEntry[] }) {
  return (
    <details className="diagnostics-history">
      <summary>历史记录（{entries.length}）</summary>
      {entries.length === 0 ? (
        <p className="muted">暂无历史记录。</p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <li key={entry.id}>
              <span className={`history-dot ${entry.status}`} />
              <span>
                <strong>{entry.label}</strong>
                <span>{entry.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function pushHistory(
  setHistory: (value: (current: HistoryEntry[]) => HistoryEntry[]) => void,
  entry: Omit<HistoryEntry, "id">,
) {
  setHistory((current) => [
    { ...entry, id: crypto.randomUUID() },
    ...current.slice(0, 4),
  ]);
}

function validatePortValue(value: string) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return "端口范围 1-65535";
  }
  return null;
}

function formatPingTime(result: PingResult) {
  const source = `${result.summary} ${result.rawOutput}`;
  const match = source.match(/(?:time[=<]?|时间[=<]?)(\d+(?:\.\d+)?)\s*ms/i);
  return match ? `响应时间 ${match[1]}ms` : null;
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "网络检测失败。";
}
