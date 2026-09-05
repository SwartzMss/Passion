use crate::error::{BackendError, BackendResult};
use crate::models::ScriptTask;
use crate::script_tasks::validate_script_path;
use chrono::{DateTime, Utc};
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;

#[cfg(windows)]
#[path = "windows_job.rs"]
mod windows_job;

#[cfg(windows)]
type ProcessTreeHandle = windows_job::JobObject;
#[cfg(not(windows))]
type ProcessTreeHandle = ();

const MAX_OUTPUT_BYTES: usize = 32 * 1024;
const MAX_OUTPUT_CHARS: usize = 8000;
const SCRIPT_TIMEOUT: Duration = Duration::from_secs(5 * 60);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptCommandPlan {
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptExecutionResult {
    pub started_at: DateTime<Utc>,
    pub finished_at: DateTime<Utc>,
    pub exit_code: Option<i32>,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub error: Option<String>,
}

pub async fn run_script(task: &ScriptTask) -> ScriptExecutionResult {
    run_script_with_timeout(task, SCRIPT_TIMEOUT).await
}

pub(crate) async fn run_script_with_timeout(
    task: &ScriptTask,
    timeout: Duration,
) -> ScriptExecutionResult {
    let started_at = Utc::now();
    let result = run_script_inner(task, timeout).await;
    let finished_at = Utc::now();

    match result {
        Ok(output) => ScriptExecutionResult {
            started_at,
            finished_at,
            exit_code: output.exit_code,
            stdout: non_empty_output(output.stdout),
            stderr: non_empty_output(output.stderr),
            error: output.error,
        },
        Err(err) => ScriptExecutionResult {
            started_at,
            finished_at,
            exit_code: None,
            stdout: None,
            stderr: None,
            error: Some(err.to_string()),
        },
    }
}

struct ScriptExecutionOutput {
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    error: Option<String>,
}

async fn run_script_inner(
    task: &ScriptTask,
    timeout: Duration,
) -> BackendResult<ScriptExecutionOutput> {
    let plan = build_command_plan(&task.script_path, task.script_args.as_deref().unwrap_or(""))?;
    let mut command = Command::new(&plan.program);
    command
        .args(&plan.args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command
        .spawn()
        .map_err(|err| BackendError::ScriptTask(format!("脚本执行失败：{err}")))?;
    let process_group_pid = child.id();
    #[cfg(windows)]
    let process_tree = match windows_job::JobObject::attach(&child) {
        Ok(job) => job,
        Err(err) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(BackendError::ScriptTask(format!(
                "脚本进程树隔离失败：{err}"
            )));
        }
    };
    #[cfg(not(windows))]
    let process_tree = ();
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            terminate_child(&mut child, process_group_pid, &process_tree).await;
            return Err(BackendError::ScriptTask(
                "脚本 stdout 管道创建失败。".to_string(),
            ));
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            terminate_child(&mut child, process_group_pid, &process_tree).await;
            return Err(BackendError::ScriptTask(
                "脚本 stderr 管道创建失败。".to_string(),
            ));
        }
    };
    let stdout_task = tokio::spawn(collect_output(stdout, MAX_OUTPUT_BYTES));
    let stderr_task = tokio::spawn(collect_output(stderr, MAX_OUTPUT_BYTES));

    let mut stdout_task = stdout_task;
    let mut stderr_task = stderr_task;
    let execution = async {
        let status = child
            .wait()
            .await
            .map_err(|err| BackendError::ScriptTask(format!("脚本等待失败：{err}")))?;
        let stdout = (&mut stdout_task)
            .await
            .map_err(|err| BackendError::ScriptTask(format!("读取脚本 stdout 失败：{err}")))?
            .map_err(|err| BackendError::ScriptTask(format!("读取脚本 stdout 失败：{err}")))?;
        let stderr = (&mut stderr_task)
            .await
            .map_err(|err| BackendError::ScriptTask(format!("读取脚本 stderr 失败：{err}")))?
            .map_err(|err| BackendError::ScriptTask(format!("读取脚本 stderr 失败：{err}")))?;
        Ok::<_, BackendError>((status, stdout, stderr))
    };

    let (status, stdout, stderr) = match tokio::time::timeout(timeout, execution).await {
        Ok(result) => result?,
        Err(_) => {
            terminate_child(&mut child, process_group_pid, &process_tree).await;
            let stdout = (&mut stdout_task)
                .await
                .map_err(|err| BackendError::ScriptTask(format!("读取脚本 stdout 失败：{err}")))?
                .map_err(|err| BackendError::ScriptTask(format!("读取脚本 stdout 失败：{err}")))?;
            let stderr = (&mut stderr_task)
                .await
                .map_err(|err| BackendError::ScriptTask(format!("读取脚本 stderr 失败：{err}")))?
                .map_err(|err| BackendError::ScriptTask(format!("读取脚本 stderr 失败：{err}")))?;
            return Ok(ScriptExecutionOutput {
                exit_code: None,
                stdout: decode_output(stdout),
                stderr: decode_output(stderr),
                error: Some(format!("脚本执行超时（超过 {} 秒）。", timeout.as_secs())),
            });
        }
    };

    Ok(ScriptExecutionOutput {
        exit_code: status.code(),
        stdout: decode_output(stdout),
        stderr: decode_output(stderr),
        error: None,
    })
}

async fn terminate_child(
    child: &mut tokio::process::Child,
    process_group_pid: Option<u32>,
    _process_tree: &ProcessTreeHandle,
) {
    #[cfg(unix)]
    {
        let killed_group = process_group_pid.or_else(|| child.id()).is_some_and(|pid| {
            // The child is started as its own process group so descendants do not
            // retain stdout/stderr pipes after a timeout.
            unsafe { libc::kill(-(pid as i32), libc::SIGKILL) == 0 }
        });
        if !killed_group {
            let _ = child.kill().await;
        }
    }

    #[cfg(windows)]
    {
        let killed_tree = _process_tree.terminate()
            || child
                .id()
                .or(process_group_pid)
                .map(|pid| async move {
                    Command::new("taskkill")
                        .args(["/PID", &pid.to_string(), "/T", "/F"])
                        .status()
                        .await
                        .map(|status| status.success())
                        .unwrap_or(false)
                })
                .map(|future| future.await)
                .unwrap_or(false);
        if !killed_tree {
            let _ = child.kill().await;
        }
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = child.kill().await;
    }
    let _ = child.wait().await;
}

async fn collect_output<R: AsyncRead + Unpin>(
    mut reader: R,
    max_bytes: usize,
) -> std::io::Result<Vec<u8>> {
    let mut retained = Vec::with_capacity(max_bytes.min(4096));
    let mut chunk = [0_u8; 4096];
    loop {
        let read = reader.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        let remaining = max_bytes.saturating_sub(retained.len());
        retained.extend_from_slice(&chunk[..read.min(remaining)]);
    }
    Ok(retained)
}

fn decode_output(output: Vec<u8>) -> String {
    truncate_output(&String::from_utf8_lossy(&output), MAX_OUTPUT_CHARS)
}

pub fn build_command_plan(
    script_path: &str,
    script_args: &str,
) -> BackendResult<ScriptCommandPlan> {
    validate_script_path(script_path)?;
    let extra_args = parse_script_args(script_args)?;
    let extension = Path::new(script_path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);

    match extension.as_deref() {
        Some("ps1") => {
            let mut args = vec![
                "-NoProfile".to_string(),
                "-ExecutionPolicy".to_string(),
                "Bypass".to_string(),
                "-File".to_string(),
                script_path.to_string(),
            ];
            args.extend(extra_args);
            Ok(ScriptCommandPlan {
                program: "powershell.exe".to_string(),
                args,
            })
        }
        Some("py") => {
            let mut args = vec![script_path.to_string()];
            args.extend(extra_args);
            Ok(ScriptCommandPlan {
                program: "python.exe".to_string(),
                args,
            })
        }
        Some("bat" | "cmd") => {
            let mut args = vec!["/C".to_string(), script_path.to_string()];
            args.extend(extra_args);
            Ok(ScriptCommandPlan {
                program: "cmd.exe".to_string(),
                args,
            })
        }
        Some("exe") | None => Ok(ScriptCommandPlan {
            program: script_path.to_string(),
            args: extra_args,
        }),
        _ => Ok(ScriptCommandPlan {
            program: script_path.to_string(),
            args: extra_args,
        }),
    }
}

pub fn parse_script_args(value: &str) -> BackendResult<Vec<String>> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut chars = value.chars().peekable();
    let mut quote: Option<char> = None;
    while let Some(ch) = chars.next() {
        match ch {
            '"' | '\'' if quote.is_none() => quote = Some(ch),
            '"' | '\'' if quote == Some(ch) => quote = None,
            '\\' if matches!(chars.peek(), Some('"') | Some('\'')) => {
                if let Some(next) = chars.next() {
                    current.push(next);
                }
            }
            ch if ch.is_whitespace() && quote.is_none() => {
                if !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                }
            }
            ch => current.push(ch),
        }
    }
    if quote.is_some() {
        return Err(BackendError::ScriptTask(
            "执行参数中的引号未闭合。".to_string(),
        ));
    }
    if !current.is_empty() {
        args.push(current);
    }
    Ok(args)
}

pub fn truncate_output(output: &str, max_chars: usize) -> String {
    output.chars().take(max_chars).collect()
}

fn non_empty_output(output: String) -> Option<String> {
    if output.is_empty() {
        None
    } else {
        Some(output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn command_plan_uses_powershell_for_ps1() {
        let plan = build_command_plan("C:\\tasks\\backup.ps1", "--config C:\\cfg\\a.json").unwrap();

        assert_eq!(plan.program, "powershell.exe");
        assert_eq!(
            plan.args,
            vec![
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                "C:\\tasks\\backup.ps1",
                "--config",
                "C:\\cfg\\a.json"
            ]
        );
    }

    #[test]
    fn command_plan_uses_python_for_py_with_quoted_args() {
        let plan =
            build_command_plan("C:\\tasks\\sync.py", "--name \"hello world\" --count 2").unwrap();

        assert_eq!(plan.program, "python.exe");
        assert_eq!(
            plan.args,
            vec![
                "C:\\tasks\\sync.py",
                "--name",
                "hello world",
                "--count",
                "2"
            ]
        );
    }

    #[test]
    fn command_plan_uses_cmd_for_batch_files() {
        let cmd = build_command_plan("C:\\tasks\\backup.cmd", "--dry-run").unwrap();
        let bat = build_command_plan("C:\\tasks\\backup.bat", "").unwrap();

        assert_eq!(cmd.program, "cmd.exe");
        assert_eq!(cmd.args, vec!["/C", "C:\\tasks\\backup.cmd", "--dry-run"]);
        assert_eq!(bat.program, "cmd.exe");
        assert_eq!(bat.args, vec!["/C", "C:\\tasks\\backup.bat"]);
    }

    #[test]
    fn command_plan_runs_exe_directly() {
        let plan = build_command_plan("C:\\tasks\\backup.exe", "--silent").unwrap();

        assert_eq!(plan.program, "C:\\tasks\\backup.exe");
        assert_eq!(plan.args, vec!["--silent"]);
    }

    #[test]
    fn command_plan_runs_command_directly() {
        let plan = build_command_plan(
            "C:\\Program Files\\Python\\python.exe",
            "\"C:\\tasks\\hello world.py\" --port 7890",
        )
        .unwrap();

        assert_eq!(plan.program, "C:\\Program Files\\Python\\python.exe");
        assert_eq!(
            plan.args,
            vec!["C:\\tasks\\hello world.py", "--port", "7890"]
        );
    }

    #[test]
    fn truncate_output_limits_character_count() {
        let output = truncate_output("abcdef", 4);

        assert_eq!(output, "abcd");
    }

    #[test]
    fn parse_script_args_rejects_unclosed_quote() {
        let err = parse_script_args("--name \"hello").unwrap_err();

        assert!(
            matches!(err, BackendError::ScriptTask(message) if message == "执行参数中的引号未闭合。")
        );
    }

    #[tokio::test]
    async fn collect_output_keeps_only_the_configured_summary() {
        let input = std::io::Cursor::new(vec![b'x'; 128 * 1024]);
        let output = collect_output(input, 32 * 1024).await.unwrap();

        assert_eq!(output.len(), 32 * 1024);
    }

    #[tokio::test]
    async fn run_script_reports_timeout_and_reaps_child() {
        let started = std::time::Instant::now();
        let result =
            run_script_with_timeout(&test_sleeping_task(), Duration::from_millis(50)).await;

        assert!(result
            .error
            .as_deref()
            .is_some_and(|message| message.contains("超时")));
        assert!(result.finished_at >= result.started_at);
        assert!(started.elapsed() < Duration::from_millis(500));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn run_script_times_out_when_descendant_keeps_output_pipe_open() {
        let task = ScriptTask {
            script_path: "sh".to_string(),
            script_args: Some("-c \"sleep 1 & exit 0\"".to_string()),
            ..test_sleeping_task()
        };
        let started = std::time::Instant::now();

        let result = run_script_with_timeout(&task, Duration::from_millis(50)).await;

        assert!(result
            .error
            .as_deref()
            .is_some_and(|message| message.contains("超时")));
        assert!(started.elapsed() < Duration::from_millis(500));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn run_script_times_out_when_windows_descendant_keeps_output_pipe_open() {
        let task = ScriptTask {
            script_path: "powershell.exe".to_string(),
            script_args: Some(
                "-NoProfile -Command \"Start-Process powershell.exe -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 1' -PassThru; exit 0\"".to_string(),
            ),
            ..test_sleeping_task()
        };
        let started = std::time::Instant::now();

        let result = run_script_with_timeout(&task, Duration::from_millis(50)).await;

        assert!(result
            .error
            .as_deref()
            .is_some_and(|message| message.contains("超时")));
        assert!(started.elapsed() < Duration::from_millis(500));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn dropping_windows_job_object_does_not_kill_a_running_script() {
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-Command", "Start-Sleep -Milliseconds 100"]);
        let mut child = command.spawn().unwrap();
        let job = windows_job::JobObject::attach(&child).unwrap();
        drop(job);

        let status = tokio::time::timeout(Duration::from_secs(1), child.wait())
            .await
            .unwrap()
            .unwrap();
        assert!(status.success());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn run_script_keeps_bounded_stdout_from_a_real_child() {
        let task = ScriptTask {
            script_path: "sh".to_string(),
            script_args: Some("-c \"yes x | head -c 131072\"".to_string()),
            ..test_sleeping_task()
        };

        let result = run_script_with_timeout(&task, Duration::from_secs(1)).await;

        assert_eq!(result.error, None);
        assert_eq!(result.stdout.as_deref().map(str::len), Some(8000));
    }

    fn test_sleeping_task() -> ScriptTask {
        #[cfg(unix)]
        let (script_path, script_args) = ("sh", Some("-c \"sleep 1\"".to_string()));
        #[cfg(windows)]
        let (script_path, script_args) = (
            "powershell.exe",
            Some("-Command \"Start-Sleep -Seconds 1\"".to_string()),
        );

        ScriptTask {
            id: "test-script".to_string(),
            name: "Test script".to_string(),
            script_path: script_path.to_string(),
            script_args,
            schedule_type: "interval".to_string(),
            interval_minutes: 15,
            time_of_day: None,
            weekdays: None,
            enabled: true,
            last_started_at: None,
            last_finished_at: None,
            last_exit_code: None,
            last_stdout: None,
            last_stderr: None,
            last_error: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }
}
