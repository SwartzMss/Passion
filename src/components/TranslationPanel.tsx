import { useState } from "react";
import { translateText } from "../lib/api";

interface Props {
  defaultTargetLanguage: string;
  onBack: () => void;
  onOpenSettings: () => void;
}

const TARGET_LANGUAGES = ["中文", "English", "日本語", "한국어", "Français", "Deutsch"];

export function TranslationPanel({
  defaultTargetLanguage,
  onBack,
  onOpenSettings,
}: Props) {
  const [sourceText, setSourceText] = useState("");
  const [targetLanguage, setTargetLanguage] = useState(defaultTargetLanguage);
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
        targetLanguage,
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
          <button onClick={onBack}>返回工作台</button>
          <button onClick={onOpenSettings}>AI 设置</button>
        </div>
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="translation-grid">
        <label>
          原文
          <textarea
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            rows={12}
          />
        </label>
        <label>
          译文
          <textarea readOnly value={translatedText} rows={12} />
        </label>
      </div>

      <div className="actions">
        <label className="inline-field">
          目标语言
          <select
            value={targetLanguage}
            onChange={(event) => setTargetLanguage(event.target.value)}
          >
            {TARGET_LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
        </label>
        <button onClick={submit} disabled={isTranslating}>
          {isTranslating ? "翻译中..." : "翻译"}
        </button>
        <button onClick={copyResult} disabled={!translatedText}>
          复制译文
        </button>
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
