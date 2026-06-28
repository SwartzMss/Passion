import { useMemo, useState } from "react";
import { sendHttpRequest } from "../../lib/api";
import type {
  HttpApiMethod,
  HttpApiPair,
  HttpApiRequest,
  HttpApiResponse,
} from "../../types";

type RequestTab = "headers" | "query" | "body";

interface EditablePair extends HttpApiPair {
  id: string;
  enabled: boolean;
}

const HTTP_METHODS: HttpApiMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const REQUEST_TABS: Array<{ id: RequestTab; label: string }> = [
  { id: "headers", label: "Headers" },
  { id: "query", label: "Query" },
  { id: "body", label: "Body" },
];

export function HttpApiTesterPanel() {
  const [method, setMethod] = useState<HttpApiMethod>("GET");
  const [url, setUrl] = useState("https://api.github.com/users/octocat");
  const [activeTab, setActiveTab] = useState<RequestTab>("headers");
  const [headers, setHeaders] = useState<EditablePair[]>([
    createPair("Accept", "application/json"),
    createPair("User-Agent", "Passion/1.0"),
  ]);
  const [query, setQuery] = useState<EditablePair[]>([]);
  const [body, setBody] = useState("");
  const [response, setResponse] = useState<HttpApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const formattedBody = useMemo(
    () => formatResponseBody(response?.body ?? ""),
    [response],
  );

  async function handleSend() {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setError("请输入请求地址。");
      return;
    }
    const input: HttpApiRequest = {
      method,
      url: trimmedUrl,
      headers: enabledPairs(headers),
      query: enabledPairs(query),
      body: body.trim() ? body : null,
    };
    setError(null);
    setIsSending(true);
    try {
      setResponse(await sendHttpRequest(input));
    } catch (err) {
      setError(readError(err));
    } finally {
      setIsSending(false);
    }
  }

  function clearAll() {
    setMethod("GET");
    setUrl("");
    setActiveTab("headers");
    setHeaders([createPair("Accept", "application/json"), createPair("User-Agent", "Passion/1.0")]);
    setQuery([]);
    setBody("");
    setResponse(null);
    setError(null);
  }

  return (
    <section className="http-panel">
      <header className="http-hero">
        <div>
          <h1>接口测试</h1>
          <p>轻量级接口测试工具，支持 GET、POST、PUT、PATCH、DELETE 等常见请求。</p>
        </div>
      </header>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="http-request-bar">
        <label className="sr-only" htmlFor="http-method">
          请求方法
        </label>
        <select
          id="http-method"
          className="http-method-select"
          value={method}
          onChange={(event) => setMethod(event.target.value as HttpApiMethod)}
        >
          {HTTP_METHODS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="http-url">
          请求地址
        </label>
        <input
          id="http-url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://api.example.com/users"
        />
        <button className="http-send-button" type="button" disabled={isSending} onClick={handleSend}>
          <span aria-hidden="true">↗</span>
          {isSending ? "发送中" : "发送"}
        </button>
        <button className="http-clear-button" type="button" onClick={clearAll}>
          清空
        </button>
      </div>

      <section className="http-card http-config-card">
        <div className="http-tabs" role="tablist" aria-label="请求配置">
          {REQUEST_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`http-tab-panel-${tab.id}`}
              id={`http-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {activeTab === "headers" ? (
          <PairTable
            addLabel="添加 Header"
            itemLabel="Header"
            panelId="http-tab-panel-headers"
            rows={headers}
            tabId="http-tab-headers"
            onAdd={() => setHeaders((current) => [...current, createPair()])}
            onChange={setHeaders}
          />
        ) : null}
        {activeTab === "query" ? (
          <PairTable
            addLabel="添加 Query"
            itemLabel="Query"
            panelId="http-tab-panel-query"
            rows={query}
            tabId="http-tab-query"
            onAdd={() => setQuery((current) => [...current, createPair()])}
            onChange={setQuery}
          />
        ) : null}
        {activeTab === "body" ? (
          <div
            className="http-body-panel"
            role="tabpanel"
            id="http-tab-panel-body"
            aria-labelledby="http-tab-body"
          >
            <label htmlFor="http-body">请求 Body</label>
            <textarea
              id="http-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder='{"name":"Passion"}'
            />
          </div>
        ) : null}
      </section>

      <section className="http-card http-response-card">
        <div className="http-response-header">
          <h2>响应结果</h2>
          {response ? (
            <>
              <div className="http-response-meta">
                <span>
                  状态码：<strong>{response.status} {response.statusText}</strong>
                </span>
                <span>耗时：<strong>{response.elapsedMs}ms</strong></span>
                <span>大小：<strong>{formatBytes(response.sizeBytes)}</strong></span>
                <span>时间：{formatTime(response.receivedAt)}</span>
              </div>
              <div className="http-response-tools">
                <button type="button" onClick={() => setResponse({ ...response, body: formattedBody })}>
                  格式化
                </button>
                <button type="button" onClick={() => copyText(formattedBody)}>
                  复制
                </button>
              </div>
            </>
          ) : null}
        </div>
        {response ? (
          <div className="http-code-view">
            <pre aria-label="响应内容">{formattedBody}</pre>
          </div>
        ) : (
          <div className="http-empty-result">
            <span aria-hidden="true">▤</span>
            <strong>暂无响应结果</strong>
            <p>点击“发送”后，状态码和响应内容会显示在这里。</p>
          </div>
        )}
      </section>
    </section>
  );
}

function PairTable({
  addLabel,
  itemLabel,
  panelId,
  rows,
  tabId,
  onAdd,
  onChange,
}: {
  addLabel: string;
  itemLabel: string;
  panelId: string;
  rows: EditablePair[];
  tabId: string;
  onAdd: () => void;
  onChange: (rows: EditablePair[]) => void;
}) {
  function updateRow(id: string, patch: Partial<EditablePair>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  return (
    <div
      className="http-pair-panel"
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId}
    >
      <table className="http-pair-table">
        <thead>
          <tr>
            <th aria-label="启用" />
            <th>键</th>
            <th>值</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id}>
              <td>
                <input
                  aria-label={`${itemLabel} 启用 ${index + 1}`}
                  type="checkbox"
                  checked={row.enabled}
                  onChange={(event) => updateRow(row.id, { enabled: event.target.checked })}
                />
              </td>
              <td>
                <input
                  id={`${panelId}-${row.id}-key`}
                  aria-label={`${itemLabel} 键 ${index + 1}`}
                  value={row.key}
                  onChange={(event) => updateRow(row.id, { key: event.target.value })}
                />
              </td>
              <td>
                <input
                  aria-label={`${itemLabel} 值 ${index + 1}`}
                  value={row.value}
                  onChange={(event) => updateRow(row.id, { value: event.target.value })}
                />
              </td>
              <td>
                <div className="http-row-actions">
                  <button
                    type="button"
                    aria-label="删除"
                    title="删除"
                    onClick={() => onChange(rows.filter((item) => item.id !== row.id))}
                  >
                    <TrashIcon />
                  </button>
                  <button
                    type="button"
                    aria-label="编辑"
                    title="编辑"
                    onClick={() => {
                      document.getElementById(`${panelId}-${row.id}-key`)?.focus();
                    }}
                  >
                    <EditIcon />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="http-pair-actions">
        <button type="button" onClick={onAdd}>
          + {addLabel}
        </button>
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="m13.5 8.5 3 3" />
    </svg>
  );
}

function createPair(key = "", value = ""): EditablePair {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    enabled: true,
    key,
    value,
  };
}

function enabledPairs(rows: EditablePair[]): HttpApiPair[] {
  return rows
    .filter((row) => row.enabled && row.key.trim())
    .map((row) => ({ key: row.key.trim(), value: row.value }));
}

function formatResponseBody(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(2)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "请求失败。";
}

function copyText(value: string) {
  navigator.clipboard?.writeText(value).catch(() => {});
}
