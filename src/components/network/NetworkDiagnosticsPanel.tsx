import { useRef, useState } from "react";
import { checkPort, inspectPortOccupancy } from "../../lib/api";
import type {
  PortCheckResult,
  PortOccupancyEntry,
  PortOccupancyResult,
} from "../../types";

type NetworkTab = "port_check" | "port_occupancy";
type PortCheckMode = "single" | "range";

const NETWORK_TABS: Array<{ id: NetworkTab; label: string }> = [
  { id: "port_check", label: "端口检测" },
  { id: "port_occupancy", label: "端口占用" },
];
const LARGE_SCAN_THRESHOLD = 1000;
const SCAN_CONCURRENCY = 100;

export function NetworkDiagnosticsPanel() {
  const [activeTab, setActiveTab] = useState<NetworkTab>("port_check");
  const [portMode, setPortMode] = useState<PortCheckMode>("single");
  const [portHost, setPortHost] = useState("127.0.0.1");
  const [portValue, setPortValue] = useState("80");
  const [scanStartPort, setScanStartPort] = useState("1");
  const [scanEndPort, setScanEndPort] = useState("1024");
  const [occupancyPort, setOccupancyPort] = useState("1420");
  const [portResult, setPortResult] = useState<PortCheckResult | null>(null);
  const [scanResults, setScanResults] = useState<PortCheckResult[]>([]);
  const [scanCompleted, setScanCompleted] = useState(0);
  const [scanTotal, setScanTotal] = useState(0);
  const [scanStopped, setScanStopped] = useState(false);
  const [occupancyResult, setOccupancyResult] =
    useState<PortOccupancyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPortRunning, setIsPortRunning] = useState(false);
  const [isScanRunning, setIsScanRunning] = useState(false);
  const [isOccupancyRunning, setIsOccupancyRunning] = useState(false);
  const scanRunIdRef = useRef(0);
  const portValidation = validatePortValue(portValue);
  const scanValidation = validatePortRange(scanStartPort, scanEndPort);
  const occupancyValidation = validatePortValue(occupancyPort);
  const scanRangeCount = scanValidation
    ? 0
    : Number(scanEndPort) - Number(scanStartPort) + 1;
  const scanRangeWarning =
    scanRangeCount > LARGE_SCAN_THRESHOLD
      ? "端口范围较大，扫描可能较慢，可随时停止扫描。"
      : null;

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

  async function runPortScan() {
    if (!portHost.trim()) {
      setError("请输入 Host。");
      return;
    }
    if (scanValidation) {
      setError(scanValidation);
      return;
    }

    const host = portHost.trim();
    const startPort = Number(scanStartPort);
    const endPort = Number(scanEndPort);
    const ports = Array.from(
      { length: endPort - startPort + 1 },
      (_, index) => startPort + index,
    );
    const runId = scanRunIdRef.current + 1;
    scanRunIdRef.current = runId;
    setError(null);
    setScanResults([]);
    setScanCompleted(0);
    setScanTotal(ports.length);
    setScanStopped(false);
    setIsScanRunning(true);

    try {
      for (let index = 0; index < ports.length; index += SCAN_CONCURRENCY) {
        if (scanRunIdRef.current !== runId) {
          setScanStopped(true);
          break;
        }
        const batch = ports.slice(index, index + SCAN_CONCURRENCY);
        const results = await Promise.all(
          batch.map((port) => checkPort({ host, port })),
        );
        if (scanRunIdRef.current !== runId) {
          setScanStopped(true);
          break;
        }
        const openResults = results.filter((result) => result.open);
        if (openResults.length > 0) {
          setScanResults((current) => [...current, ...openResults]);
        }
        setScanCompleted((current) => current + results.length);
      }
    } catch (err) {
      if (scanRunIdRef.current === runId) {
        setError(readError(err));
      }
    } finally {
      if (scanRunIdRef.current === runId) {
        setIsScanRunning(false);
      }
    }
  }

  function stopPortScan() {
    scanRunIdRef.current += 1;
    setIsScanRunning(false);
    setScanStopped(true);
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
          <PortModeSwitch
            disabled={isPortRunning || isScanRunning}
            mode={portMode}
            onChange={setPortMode}
          />
          <div className={`port-check-toolbar ${portMode}`}>
            <HostField
              value={portHost}
              onChange={setPortHost}
              onClear={() => setPortHost("")}
            />
            {portMode === "single" ? (
              <NumberField
                id="network-port"
                label="端口号"
                value={portValue}
                onChange={setPortValue}
              />
            ) : (
              <>
                <NumberField
                  id="scan-start-port"
                  label="起始端口"
                  value={scanStartPort}
                  onChange={setScanStartPort}
                />
                <NumberField
                  id="scan-end-port"
                  label="结束端口"
                  value={scanEndPort}
                  onChange={setScanEndPort}
                />
              </>
            )}
            {portMode === "single" ? (
              <PrimaryDiagnosticsButton
                disabled={isPortRunning || Boolean(portValidation)}
                label={isPortRunning ? "检测中..." : "检测端口"}
                onClick={runPortCheck}
                title="检测指定 TCP 端口是否开放"
              />
            ) : isScanRunning ? (
              <button
                className="diagnostics-button secondary"
                onClick={stopPortScan}
                title="停止当前端口扫描"
              >
                <span aria-hidden="true">□</span>
                停止扫描
              </button>
            ) : (
              <PrimaryDiagnosticsButton
                disabled={Boolean(scanValidation)}
                label="开始扫描"
                onClick={runPortScan}
                title="扫描指定 TCP 端口范围"
              />
            )}
          </div>
          {portMode === "single" && portValidation ? (
            <p className="field-hint error">{portValidation}</p>
          ) : null}
          {portMode === "range" && scanValidation ? (
            <p className="field-hint error">{scanValidation}</p>
          ) : null}
          {portMode === "range" && scanRangeWarning ? (
            <p className="field-hint warning">{scanRangeWarning}</p>
          ) : null}
          <div className="diagnostics-divider" />
          <h4>检测结果</h4>
          {portMode === "single" ? (
            <PortCheckResultBox result={portResult} />
          ) : (
            <PortScanResultBox
              completed={scanCompleted}
              results={scanResults}
              stopped={scanStopped}
              total={scanTotal}
            />
          )}
        </article>
        ) : null}

        {activeTab === "port_occupancy" ? (
        <article
          className="diagnostics-card diagnostics-card-wide occupancy-panel"
          role="tabpanel"
          id="network-panel-port_occupancy"
          aria-labelledby="network-tab-port_occupancy"
        >
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

function PortModeSwitch({
  disabled,
  mode,
  onChange,
}: {
  disabled: boolean;
  mode: PortCheckMode;
  onChange: (mode: PortCheckMode) => void;
}) {
  return (
    <div className="port-mode-toggle" aria-label="端口检测模式">
      <button
        type="button"
        aria-pressed={mode === "single"}
        onClick={() => onChange("single")}
        disabled={disabled}
      >
        <span aria-hidden="true">▣</span>
        单端口
      </button>
      <button
        type="button"
        aria-pressed={mode === "range"}
        onClick={() => onChange("range")}
        disabled={disabled}
      >
        <span aria-hidden="true">▦</span>
        范围扫描
      </button>
    </div>
  );
}

function HostField({
  value,
  onChange,
  onClear,
}: {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <label className="field-label">
      主机地址
      <span className="network-input-with-icon">
        <span aria-hidden="true">◎</span>
        <input
          id="network-host"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          title="输入要检测的目标主机，例如 127.0.0.1 或 example.com"
        />
        {value ? (
          <button type="button" aria-label="清空主机地址" onClick={onClear}>
            ×
          </button>
        ) : null}
      </span>
    </label>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field-label">
      {label}
      <input
        id={id}
        inputMode="numeric"
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        title="端口范围为 1 到 65535"
      />
    </label>
  );
}

function PrimaryDiagnosticsButton({
  disabled,
  label,
  onClick,
  title,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      className="diagnostics-button"
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <span aria-hidden="true">⌕</span>
      {label}
    </button>
  );
}

function PortCheckResultBox({ result }: { result: PortCheckResult | null }) {
  if (!result) {
    return null;
  }
  const statusText = result.open ? "端口开放" : "端口未开放";
  return (
    <div className={`port-check-result-panel ${result.open ? "success" : "failure"}`}>
      <div className="port-check-result-main">
        <span className="port-check-result-icon" aria-hidden="true">
          {result.open ? "✓" : "!"}
        </span>
        <div>
          <strong>
            {result.host}:{result.port} {statusText}
          </strong>
          <p>
            {result.open ? "连接成功，目标端口可访问。" : "连接失败，目标端口不可访问。"}
          </p>
        </div>
      </div>
      <span className="sr-only">{result.open ? "开放" : "未开放"}</span>
      <div className="port-check-result-meta">
        <span>▣ 协议：TCP</span>
        <span>◴ 响应时间：<strong>{result.elapsedMs}ms</strong></span>
      </div>
      {result.error ? <p>{result.error}</p> : null}
    </div>
  );
}

function PortScanResultBox({
  completed,
  results,
  stopped,
  total,
}: {
  completed: number;
  results: PortCheckResult[];
  stopped: boolean;
  total: number;
}) {
  if (total === 0) {
    return null;
  }
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="port-scan-panel">
      <div className="port-scan-summary">
        <div>
          <span>
            扫描中：{completed} / {total}
            {stopped ? " · 已停止" : completed >= total ? " · 已完成" : ""}
          </span>
          <span> · </span>
          <strong>已发现 {results.length} 个开放端口</strong>
          <span> · 进度 </span>
          <strong>{progress}%</strong>
        </div>
      </div>
      <div
        className="port-scan-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      {results.length > 0 ? (
        <table className="port-scan-table">
          <thead>
            <tr>
              <th>端口</th>
              <th>服务</th>
              <th>状态</th>
              <th>响应时间</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result) => (
              <tr key={result.port}>
                <td>{result.port}</td>
                <td>{guessServiceName(result.port)}</td>
                <td><span className="open-dot" />开放</td>
                <td>{result.elapsedMs}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="port-scan-empty">
          <span aria-hidden="true">⌕</span>
          <strong>暂未发现开放端口</strong>
          <p>扫描完成后，开放端口会显示在这里。</p>
        </div>
      )}
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
    <div className={`port-occupancy-result-panel ${occupied ? "occupied" : "available"}`}>
      <div className="port-occupancy-result-main">
        <span className="port-occupancy-result-icon" aria-hidden="true">
          {occupied ? "!" : "✓"}
        </span>
        <div>
          <strong>端口 {result.port} {occupied ? "已被占用" : "未被占用"}</strong>
          <p>
            {occupied
              ? "发现监听进程，请确认是否需要释放端口。"
              : "未发现监听进程，可以用于新服务或端口转发。"}
          </p>
        </div>
      </div>
      {occupied ? (
        <div className="port-occupancy-list">
          {result.entries.map((entry) => (
            <PortOccupancyRow entry={entry} key={`${entry.pid}-${entry.localAddress}`} />
          ))}
        </div>
      ) : null}
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

function validatePortRange(startValue: string, endValue: string) {
  const startError = validatePortValue(startValue);
  if (startError) {
    return startError;
  }
  const endError = validatePortValue(endValue);
  if (endError) {
    return endError;
  }
  if (Number(startValue) > Number(endValue)) {
    return "起始端口不能大于结束端口";
  }
  return null;
}

function guessServiceName(port: number) {
  const services: Record<number, string> = {
    21: "FTP",
    22: "SSH",
    25: "SMTP",
    53: "DNS",
    80: "HTTP",
    110: "POP3",
    143: "IMAP",
    443: "HTTPS",
    445: "SMB",
    631: "IPP",
    3306: "MySQL",
    5432: "PostgreSQL",
    6379: "Redis",
    8080: "HTTP",
  };
  return services[port] ?? "TCP";
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "网络检测失败。";
}
