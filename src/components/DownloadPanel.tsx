import { useState } from "react";
import { downloadFile } from "../lib/api";
import type { DownloadResult } from "../types";

export function DownloadPanel() {
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<DownloadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  async function submit() {
    if (!url.trim()) {
      setError("请输入 HTTP/HTTPS 下载地址。");
      return;
    }
    setError(null);
    setResult(null);
    setIsDownloading(true);
    try {
      setResult(
        await downloadFile({
          url: url.trim(),
          fileName: fileName.trim(),
        }),
      );
    } catch (err) {
      setError(readError(err));
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <section className="download-panel">
      <div className="section-header">
        <div>
          <h2>下载工具</h2>
          <p className="muted">输入 HTTP/HTTPS 地址，文件会保存到系统下载目录。</p>
        </div>
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="download-card">
        <label className="field-label">
          下载地址
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/file.zip"
          />
        </label>
        <label className="field-label">
          文件名（可选）
          <input
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
            placeholder="留空则自动从 URL 获取"
          />
        </label>
        <button onClick={submit} disabled={isDownloading}>
          {isDownloading ? "下载中..." : "开始下载"}
        </button>
      </div>

      {result ? (
        <div className="result-box">
          <strong>{result.fileName}</strong>
          <p>{result.savedPath}</p>
          <p className="muted">
            {formatBytes(result.bytes)} · {result.elapsedMs}ms
          </p>
        </div>
      ) : null}
    </section>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "下载失败。";
}
