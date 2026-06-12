use crate::error::{BackendError, BackendResult};
use crate::models::{AiSettings, TranslationRequest, TranslationResult};
use serde::{Deserialize, Serialize};

pub fn chat_completions_url(base_url: &str) -> String {
    format!("{}/chat/completions", base_url.trim().trim_end_matches('/'))
}

pub fn validate_translation_request(input: &TranslationRequest) -> BackendResult<()> {
    if input.text.trim().is_empty() {
        return Err(BackendError::Translation(
            "请输入要翻译的内容。".to_string(),
        ));
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

pub fn parse_translation_response(body: &str) -> BackendResult<TranslationResult> {
    let response: ChatCompletionResponse =
        serde_json::from_str(body).map_err(|err| BackendError::AiProvider(err.to_string()))?;
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
    parse_translation_response(&body)
}

pub async fn test_connection(settings: &AiSettings) -> BackendResult<()> {
    validate_ai_settings(settings)?;
    let input = TranslationRequest {
        text: "hello".to_string(),
    };
    validate_translation_request(&input)?;
    let body = send_chat_completion(settings, build_messages(&input)).await?;
    parse_translation_response(&body).map(|_| ())
}

fn build_messages(input: &TranslationRequest) -> Vec<ChatMessage> {
    vec![
        ChatMessage {
            role: "system".to_string(),
            content: "你是专业中英互译助手。自动判断用户输入的主要语言：如果主要是中文，翻译成自然、准确的英文；如果主要不是中文，翻译成自然、准确的中文。处理中英混合文本时，按主要语义输出另一种语言，并保留必要的专有名词、代码、URL、数字、格式、换行、列表和 Markdown。只输出译文，不解释。".to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: format!("请进行中英互译：\n\n{}", input.text),
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
    let client = reqwest::Client::new();
    let mut builder = client
        .post(chat_completions_url(&settings.base_url))
        .json(&request);
    if !settings.api_key.trim().is_empty() {
        builder = builder.bearer_auth(settings.api_key.trim());
    }
    let response = builder
        .send()
        .await
        .map_err(|err| BackendError::AiProvider(err.to_string()))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| BackendError::AiProvider(err.to_string()))?;
    if !status.is_success() {
        return Err(BackendError::AiProvider(format!(
            "provider returned {status}: {text}"
        )));
    }
    Ok(text)
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
    fn validate_translation_request_rejects_empty_text() {
        let err = validate_translation_request(&TranslationRequest {
            text: "  ".to_string(),
        })
        .unwrap_err();

        assert!(err.to_string().contains("请输入要翻译的内容"));
    }

    #[test]
    fn build_messages_requests_automatic_chinese_english_translation() {
        let messages = build_messages(&TranslationRequest {
            text: "Hello world".to_string(),
        });

        assert!(messages[0].content.contains("自动判断用户输入的主要语言"));
        assert!(messages[0].content.contains("主要是中文"));
        assert!(messages[0].content.contains("主要不是中文"));
        assert!(messages[1].content.contains("请进行中英互译"));
        assert!(messages[1].content.contains("Hello world"));
    }
}
