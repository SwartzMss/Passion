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
    let plan = build_command_plan(&task.script_path)?;
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

pub fn build_command_plan(script_path: &str) -> BackendResult<ScriptCommandPlan> {
    validate_script_path(script_path)?;
    let extension = Path::new(script_path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);

    match extension.as_deref() {
        Some("ps1") => Ok(ScriptCommandPlan {
            program: "powershell.exe".to_string(),
            args: vec![
                "-NoProfile".to_string(),
                "-ExecutionPolicy".to_string(),
                "Bypass".to_string(),
                "-File".to_string(),
                script_path.to_string(),
            ],
        }),
        Some("bat" | "cmd") => Ok(ScriptCommandPlan {
            program: "cmd.exe".to_string(),
            args: vec!["/C".to_string(), script_path.to_string()],
        }),
        Some("exe") => Ok(ScriptCommandPlan {
            program: script_path.to_string(),
            args: Vec::new(),
        }),
        _ => Err(BackendError::ScriptTask(
            "仅支持 .ps1、.bat、.cmd、.exe。".to_string(),
        )),
    }
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
        let plan = build_command_plan("C:\\tasks\\backup.ps1").unwrap();

        assert_eq!(plan.program, "powershell.exe");
        assert_eq!(
            plan.args,
            vec![
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                "C:\\tasks\\backup.ps1"
            ]
        );
    }

    #[test]
    fn command_plan_uses_cmd_for_batch_files() {
        let cmd = build_command_plan("C:\\tasks\\backup.cmd").unwrap();
        let bat = build_command_plan("C:\\tasks\\backup.bat").unwrap();

        assert_eq!(cmd.program, "cmd.exe");
        assert_eq!(cmd.args, vec!["/C", "C:\\tasks\\backup.cmd"]);
        assert_eq!(bat.program, "cmd.exe");
        assert_eq!(bat.args, vec!["/C", "C:\\tasks\\backup.bat"]);
    }

    #[test]
    fn command_plan_runs_exe_directly() {
        let plan = build_command_plan("C:\\tasks\\backup.exe").unwrap();

        assert_eq!(plan.program, "C:\\tasks\\backup.exe");
        assert!(plan.args.is_empty());
    }

    #[test]
    fn truncate_output_limits_character_count() {
        let output = truncate_output("abcdef", 4);

        assert_eq!(output, "abcd");
    }
}
