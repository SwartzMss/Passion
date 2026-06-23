import { useState } from "react";
import { checkPort, inspectPortOccupancy } from "../lib/api";
import type {
  PortCheckResult,
  PortOccupancyEntry,
  PortOccupancyResult,
} from "../types";

type NetworkTab = "port_check" | "port_occupancy";

const NETWORK_TABS: Array<{ id: NetworkTab; label: string }> = [
  { id: "port_check", label: "端口检测" },
  { id: "port_occupancy", label: "端口占用" },
];

export function NetworkDiagnosticsPanel() {
  const [activeTab, setActiveTab] = useState<NetworkTab>("port_check");
  const [portHost, setPortHost] = useState("127.0.0.1");
  const [portValue, setPortValue] = useState("80");
  const [occupancyPort, setOccupancyPort] = useState("1420");
  const [portResult, setPortResult] = useState<PortCheckResult | null>(null);
  const [occupancyResult, setOccupancyResult] =
    useState<PortOccupancyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPortRunning, setIsPortRunning] = useState(false);
  const [isOccupancyRunning, setIsOccupancyRunning] = useState(false);
  const portValidation = validatePortValue(portValue);
  const occupancyValidation = validatePortValue(occupancyPort);

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
          <p>检查 TCP 端口开放情况和本机端口占用。</p>
        </div>
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="network-tabs" role="tablist" aria-label="网络检测类型">
        {NETWORK_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`network-panel-${tab.id}`}
            id={`network-tab-${tab.id}`}
            className={activeTab === tab.id ? "active" : ""}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="diagnostics-grid diagnostics-tab-content">
        {activeTab === "port_check" ? (
        <article
          className="diagnostics-card diagnostics-card-wide"
          role="tabpanel"
          id="network-panel-port_check"
          aria-labelledby="network-tab-port_check"
        >
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
          <div className="diagnostics-field-row">
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
          </div>
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
        ) : null}

        {activeTab === "port_occupancy" ? (
        <article
          className="diagnostics-card diagnostics-card-wide"
          role="tabpanel"
          id="network-panel-port_occupancy"
          aria-labelledby="network-tab-port_occupancy"
        >
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
          <div className="diagnostics-inline-action">
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
            <button
              className="diagnostics-button query-button"
              onClick={runPortOccupancy}
              disabled={isOccupancyRunning || Boolean(occupancyValidation)}
              title="查看本机端口占用进程"
            >
              <span aria-hidden="true">{isOccupancyRunning ? "…" : "⌕"}</span>
              {isOccupancyRunning ? "检测中..." : "查看占用"}
            </button>
          </div>
          {occupancyValidation ? (
            <p className="field-hint error">{occupancyValidation}</p>
          ) : null}
          <div className="diagnostics-divider" />
          <h4>检测结果</h4>
          <PortOccupancyResultBox result={occupancyResult} />
        </article>
        ) : null}
      </div>
      <p className="network-tip">💡 小提示：端口检测支持域名、IPv4 地址，端口范围 1-65535。</p>
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

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "网络检测失败。";
}
