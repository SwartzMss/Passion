use crate::error::{BackendError, BackendResult};
use crate::models::ScriptTask;
use crate::script_tasks::validate_script_path;
use chrono::{DateTime, Utc};
use std::path::Path;
use tokio::process::Command;

const MAX_OUTPUT_CHARS: usize = 8000;

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
    let started_at = Utc::now();
    let result = run_script_inner(task).await;
    let finished_at = Utc::now();

    match result {
        Ok((exit_code, stdout, stderr)) => ScriptExecutionResult {
            started_at,
            finished_at,
            exit_code,
            stdout: non_empty_output(stdout),
            stderr: non_empty_output(stderr),
            error: None,
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

async fn run_script_inner(task: &ScriptTask) -> BackendResult<(Option<i32>, String, String)> {
    let plan = build_command_plan(&task.script_path, task.script_args.as_deref().unwrap_or(""))?;
    let output = Command::new(&plan.program)
        .args(&plan.args)
        .output()
        .await
        .map_err(|err| BackendError::ScriptTask(format!("脚本执行失败：{err}")))?;

    Ok((
        output.status.code(),
        truncate_output(&String::from_utf8_lossy(&output.stdout), MAX_OUTPUT_CHARS),
        truncate_output(&String::from_utf8_lossy(&output.stderr), MAX_OUTPUT_CHARS),
    ))
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
}
