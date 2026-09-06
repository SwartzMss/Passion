# Issue #38 HTTP Client 复用设计

## 目标

让 HTTP Tester 在多次请求之间复用同一个 `reqwest::Client`，从而复用连接池，减少高负载场景下重复创建 HTTP 客户端的开销。

## 范围

- 只修改 `src-tauri/src/http_tester.rs`。
- 保留现有 30 秒请求超时、请求构造、响应解析和错误格式。
- Translator 与 Downloader 仍使用各自现有的客户端创建方式，不在本 PR 扩大范围。

## 方案

在 HTTP Tester 模块中增加进程级 `OnceLock`，延迟初始化一个带 30 秒超时的 `reqwest::Client`。`send_http_request` 每次从该单例取得引用，再创建独立的 request builder；请求之间不会共享请求头、body 或响应状态，但会共享底层连接池。

客户端初始化错误仍转换为现有 `BackendError::HttpApi`，不会通过 `unwrap` 让命令崩溃。初始化结果本身缓存，避免并发请求重复构造客户端。

## 测试

- 保留现有 HTTP 请求集成测试，确保共享 Client 不改变请求行为。
- 增加单元测试，验证客户端提供函数在多次调用时返回同一个实例。
- 运行 HTTP Tester Rust 测试、完整 Rust 测试和格式检查。

## 验收标准

1. `send_http_request` 不再在每次调用中执行 `Client::builder().build()`。
2. 所有 HTTP Tester 现有行为保持不变。
3. 多次调用使用同一个进程级 Client，且构建失败能以原有错误类型返回。
