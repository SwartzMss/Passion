import { useMemo, useState } from "react";

type UtilityError = string | null;
type UtilityTab = "base64" | "hex" | "timestamp";

const MAX_UTILITY_INPUT_CHARS = 1_000_000;
const OVERSIZED_INPUT_MESSAGE = "输入内容过大，请控制在 1 MB 以内。";
const UTILITY_TABS: Array<{ id: UtilityTab; label: string }> = [
  { id: "base64", label: "Base64" },
  { id: "hex", label: "Hex" },
  { id: "timestamp", label: "时间戳" },
];

export function UtilitiesPanel() {
  const [activeTool, setActiveTool] = useState<UtilityTab>("base64");
  const [base64Input, setBase64Input] = useState("");
  const [base64Result, setBase64Result] = useState("");
  const [base64Error, setBase64Error] = useState<UtilityError>(null);
  const [hexInput, setHexInput] = useState("");
  const [hexResult, setHexResult] = useState("");
  const [hexError, setHexError] = useState<UtilityError>(null);
  const [timestampInput, setTimestampInput] = useState(() =>
    String(Math.floor(Date.now() / 1000)),
  );
  const [timestampResult, setTimestampResult] = useState<ReturnType<typeof convertTimestamp> | null>(() =>
    convertTimestamp(String(Math.floor(Date.now() / 1000))),
  );
  const [timestampError, setTimestampError] = useState<UtilityError>(null);

  const currentTimestamp = useMemo(() => {
    const now = Date.now();
    return {
      seconds: Math.floor(now / 1000),
      milliseconds: now,
    };
  }, [timestampResult]);

  function encodeBase64() {
    setBase64Error(null);
    if (isOversizedUtilityInput(base64Input)) {
      setBase64Result("");
      setBase64Error(OVERSIZED_INPUT_MESSAGE);
      return;
    }
    setBase64Result(encodeTextToBase64(base64Input));
  }

  function decodeBase64() {
    setBase64Error(null);
    if (isOversizedUtilityInput(base64Input)) {
      setBase64Result("");
      setBase64Error(OVERSIZED_INPUT_MESSAGE);
      return;
    }
    try {
      setBase64Result(decodeBase64ToText(base64Input));
    } catch (err) {
      setBase64Result("");
      setBase64Error(readUtilityError(err, "Base64 内容格式不正确。"));
    }
  }

  function encodeHex() {
    setHexError(null);
    if (isOversizedUtilityInput(hexInput)) {
      setHexResult("");
      setHexError(OVERSIZED_INPUT_MESSAGE);
      return;
    }
    setHexResult(encodeTextToHex(hexInput));
  }

  function decodeHex() {
    setHexError(null);
    if (isOversizedUtilityInput(hexInput)) {
      setHexResult("");
      setHexError(OVERSIZED_INPUT_MESSAGE);
      return;
    }
    try {
      setHexResult(decodeHexToText(hexInput));
    } catch (err) {
      setHexResult("");
      setHexError(readUtilityError(err, "Hex 内容格式不正确。"));
    }
  }

  function submitTimestamp() {
    setTimestampError(null);
    try {
      setTimestampResult(convertTimestamp(timestampInput));
    } catch (err) {
      setTimestampResult(null);
      setTimestampError(readUtilityError(err, "时间戳格式不正确。"));
    }
  }

  function useCurrentTimestamp() {
    const value = String(Math.floor(Date.now() / 1000));
    setTimestampInput(value);
    setTimestampError(null);
    setTimestampResult(convertTimestamp(value));
  }

  return (
    <section className="utilities-panel">
      <header className="utilities-hero">
        <div>
          <h1>实用工具</h1>
          <p>常用文本编码和时间转换。</p>
        </div>
      </header>

      <div className="utility-tabs" role="tablist" aria-label="实用工具类型">
        {UTILITY_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTool === tab.id}
            aria-controls={`utility-panel-${tab.id}`}
            id={`utility-tab-${tab.id}`}
            className={activeTool === tab.id ? "active" : ""}
            onClick={() => setActiveTool(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="utilities-grid utilities-tab-content">
        {activeTool === "base64" ? (
        <section
          className="utility-card utility-card-wide"
          aria-label="Base64 工具"
          role="tabpanel"
          id="utility-panel-base64"
          aria-labelledby="utility-tab-base64"
        >
          <UtilityTextareas
            inputLabel="Base64 输入"
            inputPlaceholder="输入原文或 Base64 内容"
            inputValue={base64Input}
            resultLabel="Base64 结果"
            resultValue={base64Result}
            onInputChange={setBase64Input}
          />
          {base64Error ? <p className="utility-error">{base64Error}</p> : null}
          <div className="utility-actions">
            <button className="primary-action" onClick={encodeBase64} type="button">
              编码
            </button>
            <button onClick={decodeBase64} type="button">
              解码
            </button>
            <button onClick={() => copyText(base64Result)} disabled={!base64Result} type="button">
              复制结果
            </button>
            <button
              onClick={() => {
                setBase64Input("");
                setBase64Result("");
                setBase64Error(null);
              }}
              type="button"
            >
              清空
            </button>
          </div>
        </section>
        ) : null}

        {activeTool === "hex" ? (
        <section
          className="utility-card utility-card-wide"
          aria-label="Hex 工具"
          role="tabpanel"
          id="utility-panel-hex"
          aria-labelledby="utility-tab-hex"
        >
          <UtilityTextareas
            inputLabel="Hex 输入"
            inputPlaceholder="输入文本或 Hex，例如：48 69"
            inputValue={hexInput}
            resultLabel="Hex 结果"
            resultValue={hexResult}
            onInputChange={setHexInput}
          />
          {hexError ? <p className="utility-error">{hexError}</p> : null}
          <div className="utility-actions">
            <button className="primary-action" onClick={encodeHex} type="button">
              编码
            </button>
            <button onClick={decodeHex} type="button">
              解码
            </button>
            <button onClick={() => copyText(hexResult)} disabled={!hexResult} type="button">
              复制结果
            </button>
            <button
              onClick={() => {
                setHexInput("");
                setHexResult("");
                setHexError(null);
              }}
              type="button"
            >
              清空
            </button>
          </div>
        </section>
        ) : null}

        {activeTool === "timestamp" ? (
        <section
          className="utility-card utility-card-wide"
          aria-label="时间戳转换"
          role="tabpanel"
          id="utility-panel-timestamp"
          aria-labelledby="utility-tab-timestamp"
        >
          <div className="timestamp-tool">
            <label className="field-label">
              时间戳输入
              <input
                aria-label="时间戳输入"
                inputMode="numeric"
                value={timestampInput}
                onChange={(event) => setTimestampInput(event.target.value)}
                placeholder="例如：1700000000 或 1700000000000"
              />
            </label>
            <div className="timestamp-actions">
              <button className="primary-action" onClick={submitTimestamp} type="button">
                转换时间戳
              </button>
              <button onClick={useCurrentTimestamp} type="button">
                使用当前时间
              </button>
            </div>
          </div>
          {timestampError ? <p className="utility-error">{timestampError}</p> : null}
          <div className="timestamp-result-grid">
            <ReadonlyField label="本地时间" value={timestampResult?.localTime ?? ""} />
            <ReadonlyField label="ISO 时间" value={timestampResult?.isoTime ?? ""} />
            <ReadonlyField label="秒级时间戳" value={timestampResult?.seconds ?? ""} />
            <ReadonlyField label="毫秒级时间戳" value={timestampResult?.milliseconds ?? ""} />
          </div>
          <div className="timestamp-current">
            <span>当前秒级：{currentTimestamp.seconds}</span>
            <span>当前毫秒级：{currentTimestamp.milliseconds}</span>
          </div>
        </section>
        ) : null}
      </div>
    </section>
  );
}

function UtilityTextareas({
  inputLabel,
  inputPlaceholder,
  inputValue,
  onInputChange,
  resultLabel,
  resultValue,
}: {
  inputLabel: string;
  inputPlaceholder: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  resultLabel: string;
  resultValue: string;
}) {
  return (
    <div className="utility-textarea-grid">
      <label>
        <span>{inputLabel}</span>
        <textarea
          aria-label={inputLabel}
          value={inputValue}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder={inputPlaceholder}
          rows={7}
        />
      </label>
      <label>
        <span>{resultLabel}</span>
        <textarea aria-label={resultLabel} readOnly value={resultValue} rows={7} />
      </label>
    </div>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string | number }) {
  return (
    <label>
      <span>{label}</span>
      <input aria-label={label} readOnly value={value} />
    </label>
  );
}

function encodeTextToBase64(value: string) {
  return bytesToBase64(new TextEncoder().encode(value));
}

function isOversizedUtilityInput(value: string) {
  return value.length > MAX_UTILITY_INPUT_CHARS;
}

function decodeBase64ToText(value: string) {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error("Base64 内容格式不正确。");
  }
  return new TextDecoder().decode(base64ToBytes(normalized));
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeTextToHex(value: string) {
  return Array.from(new TextEncoder().encode(value))
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

function decodeHexToText(value: string) {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized || normalized.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error("Hex 内容格式不正确。");
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

function convertTimestamp(value: string) {
  const normalized = value.trim();
  if (!/^-?\d+$/.test(normalized)) {
    throw new Error("时间戳格式不正确。");
  }
  const numeric = Number(normalized);
  if (!Number.isSafeInteger(numeric)) {
    throw new Error("时间戳格式不正确。");
  }
  const milliseconds = Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) {
    throw new Error("时间戳格式不正确。");
  }
  return {
    localTime: new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date),
    isoTime: date.toISOString(),
    seconds: Math.floor(date.getTime() / 1000),
    milliseconds: date.getTime(),
  };
}

async function copyText(value: string) {
  if (value) {
    await navigator.clipboard?.writeText(value);
  }
}

function readUtilityError(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}
