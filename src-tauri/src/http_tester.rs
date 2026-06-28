use crate::error::{BackendError, BackendResult};
use crate::models::{HttpApiHeader, HttpApiRequest, HttpApiResponse};
use chrono::Utc;
use reqwest::{Client, Method, Url};
use std::time::{Duration, Instant};

const DEFAULT_TIMEOUT_SECONDS: u64 = 30;

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
    let response = request
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
    let body = response
        .text()
        .await
        .map_err(|err| BackendError::HttpApi(err.to_string()))?;
    let size_bytes = body.len();

    Ok(HttpApiResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        elapsed_ms,
        size_bytes,
        received_at: Utc::now(),
        headers,
        body,
    })
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
}
