use crate::error::{BackendError, BackendResult};
use crate::models::{HttpApiHeader, HttpApiRequest, HttpApiResponse};
use chrono::Utc;
use encoding_rs::{Encoding, UTF_8};
use reqwest::{header::CONTENT_TYPE, Client, Method, Url};
use std::time::{Duration, Instant};

const DEFAULT_TIMEOUT_SECONDS: u64 = 30;
const MAX_RESPONSE_BODY_BYTES: usize = 10 * 1024 * 1024;

pub async fn send_http_request(input: HttpApiRequest) -> BackendResult<HttpApiResponse> {
    let method = parse_method(&input.method)?;
    let url = build_url(&input.url, &input.query)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECONDS))
        .build()
        .map_err(|err| BackendError::HttpApi(err.to_string()))?;
    let mut request = client.request(method.clone(), url);

    for header in input
        .headers
        .iter()
        .filter(|header| !header.key.trim().is_empty())
    {
        request = request.header(header.key.trim(), header.value.trim());
    }
    if method != Method::GET {
        if let Some(body) = input.body.filter(|value| !value.is_empty()) {
            request = request.body(body);
        }
    }

    let started_at = Instant::now();
    let mut response = request
        .send()
        .await
        .map_err(|err| BackendError::HttpApi(err.to_string()))?;
    let elapsed_ms = started_at.elapsed().as_millis().max(1);
    let status = response.status();
    let headers = response
        .headers()
        .iter()
        .map(|(key, value)| HttpApiHeader {
            key: key.as_str().to_string(),
            value: value.to_str().unwrap_or("").to_string(),
        })
        .collect::<Vec<_>>();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let content_length_exceeds_limit = response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BODY_BYTES as u64);
    let mut body_bytes = Vec::with_capacity(
        response
            .content_length()
            .map(|length| length.min(MAX_RESPONSE_BODY_BYTES as u64) as usize)
            .unwrap_or(0),
    );
    let mut truncated = content_length_exceeds_limit;

    loop {
        let chunk = response
            .chunk()
            .await
            .map_err(|err| BackendError::HttpApi(err.to_string()))?;
        let Some(chunk) = chunk else {
            break;
        };
        let remaining = MAX_RESPONSE_BODY_BYTES.saturating_sub(body_bytes.len());
        if chunk.len() > remaining {
            body_bytes.extend_from_slice(&chunk[..remaining]);
            truncated = true;
            break;
        }
        body_bytes.extend_from_slice(&chunk);
        if truncated && body_bytes.len() == MAX_RESPONSE_BODY_BYTES {
            break;
        }
    }

    let size_bytes = body_bytes.len();
    let body = decode_response_body(&body_bytes, content_type.as_deref());

    Ok(HttpApiResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        elapsed_ms,
        size_bytes,
        truncated,
        received_at: Utc::now(),
        headers,
        body,
    })
}

fn decode_response_body(body: &[u8], content_type: Option<&str>) -> String {
    let charset = content_type.and_then(|value| {
        value.split(';').find_map(|parameter| {
            let (name, value) = parameter.split_once('=')?;
            name.trim()
                .eq_ignore_ascii_case("charset")
                .then_some(value.trim().trim_matches('"'))
        })
    });
    let encoding = charset
        .and_then(|label| Encoding::for_label(label.as_bytes()))
        .unwrap_or(UTF_8);
    let (text, _, _) = encoding.decode(body);
    text.into_owned()
}

fn parse_method(value: &str) -> BackendResult<Method> {
    match value.trim().to_ascii_uppercase().as_str() {
        "GET" => Ok(Method::GET),
        "POST" => Ok(Method::POST),
        "PUT" => Ok(Method::PUT),
        "PATCH" => Ok(Method::PATCH),
        "DELETE" => Ok(Method::DELETE),
        _ => Err(BackendError::HttpApi("不支持的请求方法。".to_string())),
    }
}

fn build_url(raw_url: &str, query: &[HttpApiHeader]) -> BackendResult<Url> {
    let mut url =
        Url::parse(raw_url.trim()).map_err(|err| BackendError::HttpApi(err.to_string()))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(BackendError::HttpApi(
            "仅支持 HTTP/HTTPS 请求地址。".to_string(),
        ));
    }
    {
        let mut pairs = url.query_pairs_mut();
        for item in query.iter().filter(|item| !item.key.trim().is_empty()) {
            pairs.append_pair(item.key.trim(), item.value.trim());
        }
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    use crate::models::{HttpApiHeader, HttpApiRequest};

    #[tokio::test]
    async fn sends_http_request_with_headers_query_and_body() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let address = listener.local_addr().expect("local addr");
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            let mut buffer = [0; 2048];
            let read = stream.read(&mut buffer).expect("read request");
            let request_text = String::from_utf8_lossy(&buffer[..read]);
            assert!(request_text.starts_with("POST /api?debug=true HTTP/1.1"));
            assert!(request_text.contains("x-test: yes"));
            assert!(request_text.contains(r#"{"name":"Passion"}"#));
            stream
                .write_all(
                    b"HTTP/1.1 201 Created\r\ncontent-type: application/json\r\ncontent-length: 16\r\n\r\n{\"created\":true}",
                )
                .expect("write response");
        });

        let response = super::send_http_request(HttpApiRequest {
            method: "POST".to_string(),
            url: format!("http://{address}/api"),
            headers: vec![HttpApiHeader {
                key: "x-test".to_string(),
                value: "yes".to_string(),
            }],
            query: vec![HttpApiHeader {
                key: "debug".to_string(),
                value: "true".to_string(),
            }],
            body: Some(r#"{"name":"Passion"}"#.to_string()),
        })
        .await
        .expect("send request");

        handle.join().expect("server thread");
        assert_eq!(response.status, 201);
        assert_eq!(response.status_text, "Created");
        assert_eq!(response.body, r#"{"created":true}"#);
        assert!(response.elapsed_ms > 0);
        assert_eq!(response.size_bytes, 16);
        assert!(!response.truncated);
        assert!(response
            .headers
            .iter()
            .any(|header| header.key == "content-type"));
    }

    #[tokio::test]
    async fn rejects_non_http_urls() {
        let result = super::send_http_request(HttpApiRequest {
            method: "GET".to_string(),
            url: "file:///C:/secret.txt".to_string(),
            headers: vec![],
            query: vec![],
            body: None,
        })
        .await;

        assert!(result.is_err());
    }

    #[test]
    fn decodes_response_body_with_declared_charset_and_bom() {
        assert_eq!(
            super::decode_response_body(b"\xef\xbb\xbfhello", Some("text/plain; charset=utf-8")),
            "hello"
        );
        assert_eq!(
            super::decode_response_body(&[0xe9], Some("text/plain; charset=windows-1252")),
            "é"
        );
    }

    #[tokio::test]
    async fn truncates_responses_that_exceed_the_memory_limit() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let address = listener.local_addr().expect("local addr");
        let body = vec![b'a'; super::MAX_RESPONSE_BODY_BYTES + 1];
        let content_length = body.len();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            let mut request = [0; 1024];
            stream.read(&mut request).expect("read request");
            write!(
                stream,
                "HTTP/1.1 200 OK\r\ncontent-length: {content_length}\r\n\r\n"
            )
            .expect("write response headers");
            let _ = stream.write_all(&body);
        });

        let response = super::send_http_request(HttpApiRequest {
            method: "GET".to_string(),
            url: format!("http://{address}/large"),
            headers: vec![],
            query: vec![],
            body: None,
        })
        .await
        .expect("send request");

        handle.join().expect("server thread");
        assert_eq!(response.body.len(), super::MAX_RESPONSE_BODY_BYTES);
        assert_eq!(response.size_bytes, super::MAX_RESPONSE_BODY_BYTES);
        assert!(response.truncated);
    }
}
