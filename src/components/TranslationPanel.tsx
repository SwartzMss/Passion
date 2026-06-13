import { useState } from "react";
import { translateText } from "../lib/api";

interface Props {
  onOpenSettings: () => void;
}

export function TranslationPanel({ onOpenSettings }: Props) {
  const [sourceText, setSourceText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState("auto");
  const [targetLanguage, setTargetLanguage] = useState("zh-CN");
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

  async function pasteSource() {
    const text = await navigator.clipboard?.readText?.();
    if (text) {
      setSourceText(text);
      setError(null);
    }
  }

  function clearText() {
    setSourceText("");
    setTranslatedText("");
    setError(null);
  }

  function swapLanguages() {
    if (sourceLanguage === "auto") {
      setSourceLanguage(targetLanguage);
      setTargetLanguage("en");
      return;
    }
    setSourceLanguage(targetLanguage);
    setTargetLanguage(sourceLanguage);
  }

  return (
    <section className="translation-panel">
      <div className="translation-hero">
        <div>
          <h1>翻译</h1>
          <p>通过 OpenAI 兼容接口调用本地或云端模型。</p>
        </div>
        <button className="translation-settings-button" onClick={onOpenSettings}>
          <span aria-hidden="true">⚙</span>
          AI 设置
        </button>
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="translation-language-bar">
        <label className="sr-only" htmlFor="translation-source-language">
          源语言
        </label>
        <select
          id="translation-source-language"
          value={sourceLanguage}
          onChange={(event) => setSourceLanguage(event.target.value)}
          aria-label="源语言"
        >
          <option value="auto">自动检测</option>
          <option value="zh-CN">中文（简体）</option>
          <option value="en">英语</option>
          <option value="ja">日语</option>
          <option value="ko">韩语</option>
        </select>
        <button
          className="translation-swap-button"
          onClick={swapLanguages}
          type="button"
          aria-label="交换语言"
        >
          ⇄
        </button>
        <label className="sr-only" htmlFor="translation-target-language">
          目标语言
        </label>
        <select
          id="translation-target-language"
          value={targetLanguage}
          onChange={(event) => setTargetLanguage(event.target.value)}
          aria-label="目标语言"
        >
          <option value="zh-CN">中文（简体）</option>
          <option value="en">英语</option>
          <option value="ja">日语</option>
          <option value="ko">韩语</option>
        </select>
        <button
          className="primary-action translation-submit-button"
          onClick={submit}
          disabled={isTranslating}
        >
          <span aria-hidden="true">✦</span>
          {isTranslating ? "翻译中..." : "翻译"}
        </button>
      </div>

      <div className="translation-stack">
        <section className="translation-card" aria-label="原文输入">
          <div className="translation-card-header">
            <label htmlFor="translation-source">原文</label>
            <div className="translation-card-actions">
              <button onClick={pasteSource} type="button">
                粘贴
              </button>
              <button onClick={clearText} type="button">
                清空
              </button>
            </div>
          </div>
          <textarea
            id="translation-source"
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            onKeyDown={(event) => {
              if (event.ctrlKey && event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
            rows={10}
            placeholder="粘贴或输入要翻译的内容"
          />
          <div className="translation-card-footer">
            <span>{sourceText.length} 字</span>
            <span>Ctrl + Enter 快速翻译</span>
          </div>
        </section>

        <section className="translation-card" aria-label="译文结果">
          <div className="translation-card-header">
            <label htmlFor="translation-result">译文</label>
            <div className="translation-card-actions">
              <button onClick={copyResult} disabled={!translatedText} type="button">
                复制译文
              </button>
              <button
                onClick={submit}
                disabled={!sourceText.trim() || isTranslating}
                type="button"
              >
                重新翻译
              </button>
            </div>
          </div>
          <textarea
            id="translation-result"
            readOnly
            value={translatedText}
            rows={10}
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
