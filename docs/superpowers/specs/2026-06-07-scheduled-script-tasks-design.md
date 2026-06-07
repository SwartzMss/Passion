# 定时脚本任务设计

## 背景

Passion 目前已经有提醒调度、网络检测、下载工具和系统监控。定时脚本任务会把应用扩展成一个轻量桌面自动化助手：用户可以配置本机脚本，应用在运行时按固定间隔执行，并展示最近一次执行结果。

这个功能涉及执行本机程序，第一版需要明确安全边界，避免把 UI 做成任意命令执行器。

## 目标

- 新增「脚本任务」入口，用户可以管理定时执行的本机脚本。
- 支持新增、删除、启用/停用、立即运行一次。
- 支持按固定间隔执行，例如每 5 分钟、30 分钟、1 小时。
- 支持 Windows 脚本和可执行文件：`.ps1`、`.bat`、`.cmd`、`.exe`。
- 保存最近一次执行状态：开始时间、结束时间、退出码、stdout/stderr 摘要。
- 应用启动时恢复启用中的脚本任务调度。

## 非目标

- 不做 cron 表达式。
- 不做应用未启动时仍执行的系统服务。
- 不做脚本内容编辑器。
- 不支持 UI 输入任意命令字符串。
- 不保留无限历史日志。
- 不支持同一个任务并发多实例运行。

## 用户体验

顶部导航和工作台新增「脚本任务」入口。

脚本任务页面包含：

- 任务列表：名称、脚本路径、间隔、启用状态、最近执行状态。
- 操作：新增任务、立即运行、启用/停用、删除。
- 最近输出：展示 stdout/stderr 摘要，保留固定长度。

新增任务表单包含：

- 任务名。
- 脚本路径。
- 执行间隔分钟数。
- 是否启用。

第一版使用路径输入框，不强依赖文件选择器。后续可以接入系统文件选择器优化体验。

## 数据模型

新增 SQLite 表 `script_tasks`：

- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `script_path TEXT NOT NULL`
- `interval_minutes INTEGER NOT NULL`
- `enabled INTEGER NOT NULL`
- `last_started_at INTEGER`
- `last_finished_at INTEGER`
- `last_exit_code INTEGER`
- `last_stdout TEXT`
- `last_stderr TEXT`
- `last_error TEXT`
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`

前端类型：

- `ScriptTask`
- `NewScriptTask`
- `UpdateScriptTaskEnabled`
- `ScriptTaskRunResult`

## 后端边界

新增 `script_tasks.rs` 负责数据库读写和输入校验。

新增 `script_runner.rs` 负责执行脚本：

- 校验路径不能为空。
- 校验扩展名只能是 `.ps1`、`.bat`、`.cmd`、`.exe`。
- `.ps1` 使用 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <path>`。
- `.bat` 和 `.cmd` 使用 `cmd.exe /C <path>`。
- `.exe` 直接执行路径。
- 第一版不支持传参，避免把参数拼接变成命令注入入口。
- stdout/stderr 截断保存，建议每个最多 8000 字符。

新增 `script_task_scheduler.rs` 负责定时：

- 应用启动时读取启用任务并调度。
- 新增或启用任务后调度。
- 停用或删除任务后取消调度。
- 到点执行时，如果该任务正在运行，则跳过本次。
- 执行完成后写回最近结果。

## Tauri Commands

新增命令：

- `list_script_tasks() -> Vec<ScriptTask>`
- `create_script_task(input: NewScriptTask) -> ScriptTask`
- `delete_script_task(id: String) -> ()`
- `set_script_task_enabled(id: String, enabled: bool) -> ScriptTask`
- `run_script_task_now(id: String) -> ScriptTask`

命令层只做参数接收、状态锁定和错误转换；业务逻辑放在 repository/runner/scheduler 模块。

## 调度策略

第一版使用进程内 Tokio 定时任务。

每个启用任务在内存中有一个调度 handle。应用退出后调度停止，应用下次启动再从数据库恢复。

每次任务执行结束后，再等待一个完整的 interval 进入下一轮。这意味着如果一个 5 分钟任务执行了 30 秒，下一次会在执行结束后的 5 分钟后开始。

## 错误处理

用户可见错误：

- 任务名不能为空。
- 脚本路径不能为空。
- 仅支持 `.ps1`、`.bat`、`.cmd`、`.exe`。
- 执行间隔必须大于 0。
- 任务不存在。

执行错误不阻塞任务列表使用。执行失败时写入 `last_error`，并在 UI 中展示。

## 测试计划

Rust：

- 创建任务会 trim 名称和路径。
- 空名称、空路径、非法扩展名、非正间隔会失败。
- 启用/停用会更新任务。
- 删除不存在任务会返回错误。
- runner 能根据扩展名生成正确执行方式。
- 输出摘要会截断。
- 正在运行的任务不会并发执行第二次。

前端：

- 工作台显示「脚本任务」卡片并能打开。
- 页面加载任务列表。
- 新增任务表单校验必填项。
- 点击立即运行后刷新任务状态。
- 启用/停用和删除会调用对应 API。

集成验证：

- `npm test -- --run`
- `cargo test`
- `npm run tauri build`

## 后续扩展

- 文件选择器。
- 参数白名单。
- Cron 表达式。
- 最近 N 次执行历史。
- 任务失败通知。
- 任务运行超时设置。
- 应用未启动也运行的系统计划任务集成。
