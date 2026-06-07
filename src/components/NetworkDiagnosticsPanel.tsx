import { useState } from "react";
import { checkPort, pingHost } from "../lib/api";
import type { PingResult, PortCheckResult } from "../types";

interface Props {
  onBack: () => void;
}

export function NetworkDiagnosticsPanel({ onBack }: Props) {
  const [pingHostValue, setPingHostValue] = useState("");
  const [portHost, setPortHost] = useState("127.0.0.1");
  const [portValue, setPortValue] = useState("80");
  const [pingResult, setPingResult] = useState<PingResult | null>(null);
  const [portResult, setPortResult] = useState<PortCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  async function runPing() {
    if (!pingHostValue.trim()) {
      setError("请输入要 Ping 的 IP 或域名。");
      return;
    }
    setError(null);
    setIsRunning(true);
    try {
      setPingResult(await pingHost({ host: pingHostValue.trim() }));
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
    const port = Number(portValue);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError("请输入 1 到 65535 之间的端口。");
      return;
    }
    setError(null);
    setIsRunning(true);
    try {
      setPortResult(await checkPort({ host: portHost.trim(), port }));
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
          <p className="muted">检查 IP/域名是否可达，或检测 TCP 端口是否开放。</p>
        </div>
        <button onClick={onBack}>返回工作台</button>
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
            />
          </label>
          <button onClick={runPing} disabled={isRunning}>
            Ping
          </button>
          {pingResult ? (
            <div className="result-box">
              <strong>{pingResult.summary}</strong>
              <pre>{pingResult.rawOutput}</pre>
            </div>
          ) : null}
        </article>

        <article className="diagnostics-card">
          <h3>端口检测</h3>
          <label className="field-label">
            Host
            <input
              value={portHost}
              onChange={(event) => setPortHost(event.target.value)}
            />
          </label>
          <label className="field-label">
            Port
            <input
              inputMode="numeric"
              value={portValue}
              onChange={(event) => setPortValue(event.target.value)}
            />
          </label>
          <button onClick={runPortCheck} disabled={isRunning}>
            检测端口
          </button>
          {portResult ? (
            <div className="result-box">
              <strong>{portResult.open ? "端口开放" : "端口关闭"}</strong>
              <p className="muted">
                {portResult.host}:{portResult.port} · {portResult.elapsedMs}ms
              </p>
              {portResult.error ? <p>{portResult.error}</p> : null}
            </div>
          ) : null}
        </article>
      </div>
    </section>
  );
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "网络检测失败。";
}
