import { useState } from "react";
import { translateText } from "../lib/api";

interface Props {
  onOpenSettings: () => void;
}

export function TranslationPanel({ onOpenSettings }: Props) {
  const [sourceText, setSourceText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);

  async function submit() {
    if (!sourceText.trim()) {
      setError("请输入要翻译的内容。");
      return;
    }
    setError(null);
    setIsTranslating(true);
    try {
      const result = await translateText({
        text: sourceText,
      });
      setTranslatedText(result.translatedText);
    } catch (err) {
      setError(readError(err));
    } finally {
      setIsTranslating(false);
    }
  }

  async function copyResult() {
    if (translatedText) {
      await navigator.clipboard?.writeText(translatedText);
    }
  }

  return (
    <section className="translation-panel">
      <div className="section-header">
        <div>
          <h2>翻译</h2>
          <p className="muted">通过 OpenAI 兼容接口调用本地或云端模型。</p>
        </div>
        <div className="actions">
          <button onClick={onOpenSettings}>AI 设置</button>
        </div>
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="translation-stack">
        <section className="translation-card" aria-label="原文输入">
          <div className="translation-card-header">
            <label htmlFor="translation-source">原文</label>
            <button onClick={submit} disabled={isTranslating}>
              {isTranslating ? "翻译中..." : "翻译"}
            </button>
          </div>
          <textarea
            id="translation-source"
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            rows={9}
            placeholder="粘贴或输入要翻译的内容"
          />
        </section>

        <section className="translation-card" aria-label="译文结果">
          <div className="translation-card-header">
            <label htmlFor="translation-result">译文</label>
            <button onClick={copyResult} disabled={!translatedText}>
              复制译文
            </button>
          </div>
          <textarea
            id="translation-result"
            readOnly
            value={translatedText}
            rows={9}
            placeholder="翻译结果会显示在这里"
          />
        </section>
      </div>
    </section>
  );
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "翻译失败，请检查 AI 设置。";
}
