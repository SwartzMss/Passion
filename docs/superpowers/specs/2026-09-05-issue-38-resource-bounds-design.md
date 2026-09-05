# Issue #38 高负载场景资源边界设计

## 目标与范围

本设计覆盖 Issue #38 中优先级最高的两个项目：

1. 将端口范围扫描从前端逐端口 IPC 调用改为后端单任务扫描。
2. 限制脚本 stdout/stderr 内存占用，并为脚本执行增加超时。

本次不改动 Reminder Scheduler、ScriptTask Scheduler、Downloader，也不包含 HTTP Tester、SSH Tunnel、tasklist 查询或日志轮转。单端口端口检测和脚本任务现有的禁止同一任务并发执行语义保持不变。

## 端口扫描

### 后端接口

新增两个 Tauri command：

- `start_port_scan(input) -> String`：校验 host、起止端口，创建扫描任务并立即返回唯一 `scan_id`。
- `stop_port_scan(scan_id) -> ()`：请求停止指定扫描；重复停止和任务已结束后的停止操作保持幂等。

新增 `PortScanManager` 并挂载至 `AppState`。管理器保存活动扫描的取消发送端，任务结束后清理登记。启动新扫描时先取消同一管理器中已有的扫描，避免后台任务长期累积。

### 扫描执行

扫描任务使用 Tokio 异步网络 API，不再为每个端口创建 `spawn_blocking` 任务。每个端口连接使用 3 秒超时，并由固定大小为 64 的 `Semaphore` 限制同时进行的连接数。

单个端口的连接失败表示该端口未开放，不会中断整个扫描。DNS 解析失败、任务创建失败等任务级错误会终止扫描并推送错误状态。取消信号使用 Tokio channel，连接等待通过 `select!` 同时响应取消和连接结果。

### 事件协议

后端向前端发送 `port-scan-progress` 事件，事件 payload 至少包含：

```text
scanId: string
completed: number
total: number
result: PortCheckResult | null
done: boolean
stopped: boolean
error: string | null
```

开放端口通过 `result` 推送；关闭端口只推进 `completed`，避免将大量无用结果发送到前端。最终事件设置 `done: true`，并标记 `stopped` 或 `error`。前端只处理当前 `scanId` 的事件，并在最终事件后移除监听。

### 前端行为

范围扫描开始时先注册事件监听，再调用 `start_port_scan`，因此不会错过首个进度事件。前端仅维护一个后端任务 ID，不再构造端口数组或逐端口调用 `checkPort`。

停止按钮调用 `stop_port_scan`；后端完成取消后发送停止事件，前端显示已扫描进度和已发现开放端口。启动、停止、完成和异常路径都会恢复控件状态并清理事件监听。

## 脚本执行

### 子进程与输出

`run_script_inner` 改用 `Command::spawn()`，设置 stdout/stderr pipe，并为两个流各启动一个异步 reader。reader 持续读取固定大小 chunk，以保证子进程管道不会因未及时消费而阻塞。

每个流最多保留 32 KiB 原始字节，超过部分继续读取但直接丢弃；最终按现有规则转换为字符串并限制为 8000 字符。这样数据库保存格式兼容现有字段，同时执行期间的摘要内存有固定上限。

### 超时与进程回收

脚本默认最大执行时间为 5 分钟。子进程等待和两个输出 reader 的完成被统一放在 timeout 中：

- 正常退出：返回退出码及 stdout/stderr 摘要。
- 启动失败：保留现有脚本执行错误格式。
- 超时：先 kill 子进程，再 wait/reap，回收两个 reader，保留已经收集的摘要，并设置明确的超时错误。

超时不会改变 `ScriptTaskScheduler::run_if_idle` 的同任务互斥语义；任务完成后仍照常更新数据库中的执行时间、退出码、输出和错误。

## 错误处理与兼容性

- 前后端均校验端口范围，后端不依赖 UI 校验。
- 单端口连接错误作为关闭结果；扫描任务错误通过最终事件报告。
- 未知扫描 ID 返回网络诊断错误；停止已完成任务不重复创建资源。
- 现有 `check_port`、端口占用查询和脚本任务数据模型继续可用。
- 新增事件和 API 类型使用现有 camelCase 约定。

## 测试与验收

### Rust 测试

- 批量扫描本地 listener 能返回开放端口。
- 端口扫描并发数不超过 64。
- 取消后任务停止并发送停止状态。
- 无效 host、端口范围被拒绝。
- stdout/stderr 大量输出时摘要固定受限且不超过 8000 字符。
- 正常脚本返回退出码和摘要；超时脚本被终止并返回超时错误。

### React 测试

- 范围扫描只调用一次启动 API。
- 进度事件能展示开放端口、完成数和总数。
- 停止按钮调用停止 API。
- 其他扫描 ID 的事件不会污染当前结果。

### 完整验证

实现后运行前端测试、前端构建、Rust 测试、Rust 格式检查和 diff 检查；只有所有适用检查通过后才创建 PR。
