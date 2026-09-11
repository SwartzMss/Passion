use crate::error::{BackendError, BackendResult};
use crate::models::{AiSettings, TranslationRequest, TranslationResult};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::time::Duration;

const RESPONSE_PREVIEW_LIMIT: usize = 500;
const MAX_INPUT_BYTES: usize = 100_000;
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();

fn http_client() -> BackendResult<&'static reqwest::Client> {
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .read_timeout(Duration::from_secs(30))
                .timeout(Duration::from_secs(90))
                .build()
                .map_err(|err| err.to_string())
        })
        .as_ref()
        .map_err(|err| BackendError::AiProvider(err.clone()))
}

fn language_name(code: &str) -> Option<&'static str> {
    match code {
        "zh-CN" => Some("中文（简体）"),
        "en" => Some("英语"),
        "ja" => Some("日语"),
        "ko" => Some("韩语"),
        _ => None,
    }
}

pub fn chat_completions_url(base_url: &str) -> String {
    format!("{}/chat/completions", base_url.trim().trim_end_matches('/'))
}

pub fn validate_translation_request(input: &TranslationRequest) -> BackendResult<()> {
    if input.text.trim().is_empty() {
        return Err(BackendError::Translation(
            "请输入要翻译的内容。".to_string(),
        ));
    }
    if input.text.len() > MAX_INPUT_BYTES {
        return Err(BackendError::Translation(
            "原文过长，请分段翻译（最多 100 KB）。".into(),
        ));
    }
    if (input.source_language != "auto" && language_name(&input.source_language).is_none())
        || language_name(&input.target_language).is_none()
    {
        return Err(BackendError::Translation("不支持所选翻译语言。".into()));
    }
    Ok(())
}

pub fn validate_ai_settings(settings: &AiSettings) -> BackendResult<()> {
    if settings.base_url.trim().is_empty() {
        return Err(BackendError::Translation(
            "请先在设置中配置 API 地址。".to_string(),
        ));
    }
    if settings.model.trim().is_empty() {
        return Err(BackendError::Translation(
            "请先在设置中配置模型名称。".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
pub fn parse_translation_response(body: &str) -> BackendResult<TranslationResult> {
    parse_translation_response_with_context(body, None, None, None)
}

fn parse_translation_response_with_context(
    body: &str,
    status: Option<reqwest::StatusCode>,
    url: Option<&str>,
    model: Option<&str>,
) -> BackendResult<TranslationResult> {
    let response: ChatCompletionResponse = serde_json::from_str(body).map_err(|err| {
        BackendError::AiProvider(format!(
            "failed to parse provider response as JSON: {err}; {}",
            provider_context(status, url, model, body)
        ))
    })?;
    let content = response
        .choices
        .into_iter()
        .next()
        .and_then(|choice| choice.message.content)
        .ok_or_else(|| {
            BackendError::AiProvider(
                "response did not include choices[0].message.content".to_string(),
            )
        })?;
    Ok(TranslationResult {
        translated_text: content,
    })
}

pub async fn translate(
    settings: &AiSettings,
    input: &TranslationRequest,
) -> BackendResult<TranslationResult> {
    validate_ai_settings(settings)?;
    validate_translation_request(input)?;
    let body = send_chat_completion(settings, build_messages(input)).await?;
    parse_translation_response_with_context(
        &body,
        Some(reqwest::StatusCode::OK),
        Some(&chat_completions_url(&settings.base_url)),
        Some(settings.model.trim()),
    )
}

pub async fn test_connection(settings: &AiSettings) -> BackendResult<()> {
    validate_ai_settings(settings)?;
    let input = TranslationRequest {
        text: "hello".to_string(),
        ..Default::default()
    };
    validate_translation_request(&input)?;
    let body = send_chat_completion(settings, build_messages(&input)).await?;
    parse_translation_response_with_context(
        &body,
        Some(reqwest::StatusCode::OK),
        Some(&chat_completions_url(&settings.base_url)),
        Some(settings.model.trim()),
    )
    .map(|_| ())
}

fn build_messages(input: &TranslationRequest) -> Vec<ChatMessage> {
    vec![
        ChatMessage {
            role: "system".to_string(),
            content: format!("你是专业翻译助手。源语言：{}。目标语言：{}。将用户文本翻译成目标语言，保留专有名词、代码、URL、数字、格式、换行、列表和 Markdown。只输出译文，不解释。", language_name(&input.source_language).unwrap_or("自动检测"), language_name(&input.target_language).unwrap_or("中文（简体）")),
        },
        ChatMessage {
            role: "user".to_string(),
            content: input.text.clone(),
        },
    ]
}

async fn send_chat_completion(
    settings: &AiSettings,
    messages: Vec<ChatMessage>,
) -> BackendResult<String> {
    let request = ChatCompletionRequest {
        model: settings.model.trim(),
        messages,
        temperature: 0.2,
    };
    let url = chat_completions_url(&settings.base_url);
    let client = http_client()?;
    let mut builder = client.post(&url).json(&request);
    if !settings.api_key.trim().is_empty() {
        builder = builder.bearer_auth(settings.api_key.trim());
    }
    let response = builder.send().await.map_err(|err| {
        BackendError::AiProvider(format!(
            "request failed: {err}; url={url}; model={}",
            settings.model.trim()
        ))
    })?;
    let status = response.status();
    let text = read_response(response).await.map_err(|err| {
        BackendError::AiProvider(format!(
            "failed to read provider response body: {err}; url={url}; model={}",
            settings.model.trim()
        ))
    })?;
    if !status.is_success() {
        return Err(BackendError::AiProvider(format!(
            "provider returned non-success status; {}",
            provider_context(Some(status), Some(&url), Some(settings.model.trim()), &text)
        )));
    }
    Ok(text)
}

async fn read_response(mut response: reqwest::Response) -> BackendResult<String> {
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
    {
        return Err(BackendError::AiProvider("翻译响应超过 2 MB 限制。".into()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| BackendError::AiProvider(err.to_string()))?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(BackendError::AiProvider("翻译响应超过 2 MB 限制。".into()));
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|err| BackendError::AiProvider(err.to_string()))
}

fn provider_context(
    status: Option<reqwest::StatusCode>,
    url: Option<&str>,
    model: Option<&str>,
    body: &str,
) -> String {
    format!(
        "status={}; url={}; model={}; response_preview={}",
        status
            .map(|value| value.to_string())
            .unwrap_or_else(|| "<unknown>".to_string()),
        url.unwrap_or("<unknown>"),
        model.unwrap_or("<unknown>"),
        response_preview(body)
    )
}

fn response_preview(body: &str) -> String {
    let normalized = body
        .chars()
        .take(RESPONSE_PREVIEW_LIMIT + 1)
        .map(|ch| if ch.is_control() { ' ' } else { ch })
        .collect::<String>();
    let trimmed = normalized.trim();
    let preview = if trimmed.chars().count() > RESPONSE_PREVIEW_LIMIT {
        format!(
            "{}...",
            trimmed
                .chars()
                .take(RESPONSE_PREVIEW_LIMIT)
                .collect::<String>()
        )
    } else {
        trimmed.to_string()
    };
    if preview.is_empty() {
        "<empty>".to_string()
    } else {
        preview
    }
}

#[derive(Serialize)]
struct ChatCompletionRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage>,
    temperature: f32,
}

#[derive(Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatChoiceMessage,
}

#[derive(Deserialize)]
struct ChatChoiceMessage {
    content: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_languages_and_input_bounds() {
        let mut input = TranslationRequest {
            text: "hello".into(),
            ..Default::default()
        };
        assert!(validate_translation_request(&input).is_ok());
        input.target_language = "invalid".into();
        assert!(validate_translation_request(&input).is_err());
        input.target_language = "ko".into();
        input.text = "x".repeat(MAX_INPUT_BYTES + 1);
        assert!(validate_translation_request(&input).is_err());
        assert!(std::ptr::eq(http_client().unwrap(), http_client().unwrap()));
    }

    #[tokio::test]
    async fn bounds_provider_response_with_or_without_content_length() {
        use std::io::{Read, Write};
        for declared_length in [true, false] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}", listener.local_addr().unwrap());
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0; 1024];
                stream.read(&mut request).unwrap();
                if declared_length {
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        MAX_RESPONSE_BYTES + 1
                    )
                    .unwrap();
                } else {
                    stream
                        .write_all(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n")
                        .unwrap();
                    let _ = stream.write_all(&vec![b'x'; MAX_RESPONSE_BYTES + 1]);
                }
            });
            let response = http_client().unwrap().get(url).send().await.unwrap();
            let err = read_response(response).await.unwrap_err();
            assert!(err.to_string().contains("2 MB"));
            server.join().unwrap();
        }
    }

    #[test]
    fn chat_completions_url_trims_trailing_slashes() {
        assert_eq!(
            chat_completions_url("http://localhost:11434/v1/"),
            "http://localhost:11434/v1/chat/completions"
        );
    }

    #[test]
    fn parse_translation_response_reads_first_choice_content() {
        let body = r#"{"choices":[{"message":{"content":"你好"}}]}"#;

        let result = parse_translation_response(body).unwrap();

        assert_eq!(result.translated_text, "你好");
    }

    #[test]
    fn parse_translation_response_includes_body_preview_for_non_json() {
        let err = parse_translation_response("<html>not found</html>").unwrap_err();
        let message = err.to_string();

        assert!(message.contains("failed to parse provider response as JSON"));
        assert!(message.contains("response_preview=<html>not found</html>"));
    }

    #[test]
    fn validate_translation_request_rejects_empty_text() {
        let err = validate_translation_request(&TranslationRequest {
            text: "  ".to_string(),
            ..Default::default()
        })
        .unwrap_err();

        assert!(err.to_string().contains("请输入要翻译的内容"));
    }

    #[test]
    fn build_messages_honors_selected_languages() {
        let messages = build_messages(&TranslationRequest {
            text: "Hello world".to_string(),
            source_language: "en".into(),
            target_language: "ja".into(),
        });

        assert!(messages[0].content.contains("源语言：英语"));
        assert!(messages[0].content.contains("目标语言：日语"));
        assert!(messages[1].content.contains("Hello world"));
    }
}
