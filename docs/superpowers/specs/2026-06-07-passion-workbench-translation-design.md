# Passion Workbench and Translation Design

## Summary

Passion should evolve from a reminder-only desktop app into a personal assistant workbench. The current reminder feature remains intact, and translation becomes the second full feature. The UI should use a dashboard-style home page with feature cards, then route into focused feature pages for reminders, translation, and settings.

The translation feature should use OpenAI-compatible Chat Completions instead of binding only to OpenAI's official Responses API. This supports local and self-hosted models such as Ollama, LM Studio, LocalAI, vLLM, llama.cpp server, and compatible cloud endpoints.

## Product Structure

The app has four primary views:

1. Workbench home
2. Reminders
3. Translation
4. Settings

The home view is the default entry point. It shows compact cards for available capabilities:

- Reminder card: pending reminder count and a quick "新增提醒" action.
- Translation card: entry point for text translation.
- Recent activity area: lightweight summary of recent reminders or translation use. For the first implementation, this can be static or omitted if history is not yet implemented.

This structure keeps the app extensible. Future features such as summarization, writing, OCR, clipboard tools, or quick chat can be added as new cards without changing the base navigation model.

## Navigation

Use a simple view-state router in React for the initial implementation. No external routing library is required.

Suggested view ids:

- `home`
- `reminders`
- `translation`
- `settings`

The header keeps the product name `Passion`. From feature pages, users can return to the workbench. Settings should be reachable from the home page and from translation, because translation depends on AI provider configuration.

## Translation Page

The translation page should be a focused two-panel tool:

- Left panel: source text input.
- Right panel: translated output.
- Target language selector: common presets such as 中文, English, 日本語, 한국어, Français, Deutsch.
- Translate button.
- Copy result button.
- Error area for provider failures.

The first implementation should not require translation history. It should perform one translation at a time and keep the result in component state. History can be added later as a separate persistence feature.

Prompt behavior:

- Preserve meaning.
- Preserve formatting, line breaks, lists, code blocks, and proper nouns.
- If the source is already in the target language, return it unchanged.
- Return only the translated text, with no explanation.

## AI Provider Settings

Settings should gain an "AI 翻译设置" section while keeping existing system settings:

- API 地址
- 模型名称
- API Key
- 默认目标语言
- 测试连接

Defaults:

- API 地址: `http://localhost:11434/v1`
- 模型名称: `qwen2.5:7b`
- API Key: empty
- 默认目标语言: `中文`

The API key is optional because local compatible services often do not require one. If present, the backend should send it as a bearer token.

## Backend Architecture

Add a Rust translation module that owns all provider calls. The frontend should call Tauri commands only; it should never call the model provider directly.

Suggested modules:

- `ai_settings.rs`: read/write AI provider settings.
- `translator.rs`: build Chat Completions request, call provider, parse response.
- `commands.rs`: expose `translate_text`, `get_ai_settings`, `update_ai_settings`, and `test_ai_connection`.

Use OpenAI-compatible Chat Completions:

`POST {base_url}/chat/completions`

Request shape:

```json
{
  "model": "qwen2.5:7b",
  "messages": [
    {
      "role": "system",
      "content": "你是专业翻译助手。只输出译文，不解释。"
    },
    {
      "role": "user",
      "content": "请翻译成中文：..."
    }
  ],
  "temperature": 0.2
}
```

The backend should normalize `base_url` by trimming trailing slashes before appending `/chat/completions`.

## Data Storage

Continue using SQLite for settings.

AI settings can use the existing `settings` key-value table:

- `ai_base_url`
- `ai_model`
- `ai_api_key`
- `ai_default_target_language`

This avoids a schema migration for the first implementation. If future AI features need multiple providers or profiles, introduce a dedicated provider table later.

## Error Handling

Translation should fail clearly when:

- Source text is empty.
- API base URL is missing.
- Model name is missing.
- Provider returns a non-success HTTP status.
- Provider response does not contain `choices[0].message.content`.
- Network connection fails.

Frontend error text should be Chinese and actionable, for example:

- `请输入要翻译的内容。`
- `请先在设置中配置模型名称。`
- `无法连接到 AI 服务，请检查接口地址。`

## Testing

Frontend tests:

- Workbench shows reminder and translation cards.
- Translation page rejects empty input.
- Translation page calls translate command and displays result.
- Settings page renders and saves AI settings.

Rust tests:

- AI settings default values.
- AI settings round trip through SQLite.
- Chat Completions URL normalization.
- Translation response parsing.
- Empty text validation.

Network provider calls should be unit-tested with small pure parsing helpers where possible. End-to-end provider tests are optional because local model availability depends on the user's machine.

## Initial Implementation Scope

In scope:

- Workbench home view.
- Existing reminders moved behind a reminder feature page.
- Translation feature page.
- AI provider settings.
- Tauri commands for translation and provider settings.
- OpenAI-compatible Chat Completions support.

Out of scope for the first implementation:

- Translation history persistence.
- Multiple provider profiles.
- Streaming translation output.
- Global hotkeys.
- Clipboard watcher.
- OCR or document translation.
- Provider-specific model discovery.

## Open Questions Resolved

- Product name remains `Passion`.
- The UI direction is the workbench/card model.
- Translation should support local/self-hosted OpenAI-compatible endpoints.
- Translation history is deferred to keep the first implementation focused.
