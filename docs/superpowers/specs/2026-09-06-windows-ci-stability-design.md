# Windows CI 进程树测试稳定性设计

## 背景

Windows Tests run 34028308373 在 `Rust tests on Windows` job 中失败：131 个测试中 129 个通过，以下两个 Windows 专用测试失败：

- `script_runner::tests::run_script_times_out_when_windows_descendant_keeps_output_pipe_open`
- `script_runner::tests::preserving_windows_job_object_does_not_kill_a_running_script`

失败发生在 `script_runner.rs` 的进程树与 Job Object 测试，不涉及本次 HTTP client 改动。相同 PR 的 Windows 检查和前一个 main 检查均通过，说明当前测试依赖 runner 调度和进程启动时序，存在间歇性失败。

## 目标与非目标

目标：

1. 保持生产行为：超时时终止整个 Windows 进程树，成功完成时不因 Job Object 句柄释放而误杀合法的后台子进程。
2. 消除测试对并发执行、瞬时临时文件状态和 `windows-latest` 镜像漂移的脆弱依赖。
3. 让 CI 失败时仍能清楚反映真实的 Rust 测试失败。

非目标：

- 不改变 HTTP Tester、脚本任务业务 API 或超时契约。
- 不用重试掩盖测试失败。
- 不重写现有 Windows Job Object 实现；当前失败证据不足以证明其生产逻辑错误。

## 方案

### 方案 A：稳定测试并固定 CI runner（采用）

- 在两个会创建/释放 Windows 进程树的测试之间增加测试级互斥，避免它们并行操作 Job Object 和 PowerShell 子进程。
- 将临时脚本和标记文件放入每次测试独有的临时目录，并使用有上限的轮询等待启动标记；测试结束时统一清理。
- 将 Windows Tests 的 runner 从 `windows-latest` 固定为 `windows-2022`，避免最新镜像切换带来的未预期行为变化。
- 保持测试对两个核心行为的断言：超时后后台子进程不会继续写入 alive 标记；成功路径不会杀死仍在运行的脚本。

优点：改动范围小，直接处理已观察到的时序不稳定，同时保留生产行为验证。缺点：测试执行时间略有增加，runner 仍会接收 `windows-2022` 的常规镜像更新。

### 方案 B：仅固定 runner

只把 `windows-latest` 固定到 `windows-2022`。改动最小，但无法解决测试本身对并发和进程启动时序的依赖，未来仍可能复发。

### 方案 C：重写生产进程树生命周期

改变 Job Object 的挂载、释放或超时清理策略。该方案风险高，且当前失败只出现在间歇性的 Windows 测试中，没有足够证据支持生产逻辑是根因。

## 测试策略

先运行现有 Windows 相关测试，确认当前 Linux 环境会跳过 Windows 分支但不会引入编译错误；实现后运行完整 Rust 测试、格式检查和 diff 检查。Windows 专用行为最终由 GitHub Actions 的固定 runner 验证。

## 成功标准

- Windows Tests 在相同代码下不再因上述两个进程树测试的已知时序问题失败。
- 完整 Rust 测试在本地通过，且没有新增格式或 diff 检查错误。
- 生产代码的超时杀树和成功保留子进程语义不变。
