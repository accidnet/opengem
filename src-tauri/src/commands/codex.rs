use crate::app_state::AppState;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{Emitter, Manager, State};

#[derive(Default)]
pub struct CodexTasks(Mutex<HashMap<String, RunningTask>>);

struct RunningTask {
    project: PathBuf,
    child: Arc<Mutex<Child>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexTaskInput {
    session_id: String,
    agent_id: String,
    request_id: String,
    prompt: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskEvent {
    session_id: String,
    agent_id: String,
    request_id: String,
    r#type: &'static str,
    data: String,
}

#[derive(Serialize)]
pub struct CodexTaskResult {
    output: String,
}

struct TaskContext {
    project: PathBuf,
    model: Option<String>,
    prompt: String,
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn valid_model(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

fn same_or_nested(a: &Path, b: &Path) -> bool {
    #[cfg(windows)]
    {
        let a = PathBuf::from(a.to_string_lossy().to_lowercase());
        let b = PathBuf::from(b.to_string_lossy().to_lowercase());
        a.starts_with(&b) || b.starts_with(&a)
    }
    #[cfg(not(windows))]
    {
        a.starts_with(b) || b.starts_with(a)
    }
}

// 저장된 세션과 에이전트를 기준으로 작업 범위와 역할을 결정합니다.
fn load_context(
    connection: &rusqlite::Connection,
    input: &CodexTaskInput,
) -> Result<TaskContext, String> {
    if !valid_identifier(&input.request_id)
        || input.prompt.trim().is_empty()
        || input.prompt.len() > 128_000
    {
        return Err("요청 ID 또는 작업 내용이 올바르지 않습니다.".to_string());
    }
    let row: Option<(Option<String>, Option<String>, String, Option<String>, Option<String>, i64, String)> = connection.query_row(
        "SELECT s.project_paths, s.agent_id, a.agent_name, a.prompt, a.model, a.is_active, a.agent_role
         FROM chat_sessions s JOIN operation_modes m ON m.mode_name = s.mode_name
         JOIN operation_mode_agents a ON a.mode_id = m.id AND a.agent_id = ?2 WHERE s.id = ?1",
        params![input.session_id, input.agent_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)),
    ).optional().map_err(|e| e.to_string())?;
    let (paths, target, name, role_prompt, model, active, role) =
        row.ok_or("세션 또는 에이전트를 찾을 수 없습니다.")?;
    if active != 1
        || target
            .as_deref()
            .map_or(role != "main", |id| id != input.agent_id)
    {
        return Err("이 세션에서 사용할 수 없는 에이전트입니다.".to_string());
    }
    let paths: Vec<String> = paths
        .map(|p| serde_json::from_str(&p))
        .transpose()
        .map_err(|e| format!("프로젝트 경로 오류: {e}"))?
        .unwrap_or_default();
    let path = paths.first().ok_or("먼저 프로젝트 폴더를 선택해 주세요.")?;
    let project = std::fs::canonicalize(path).map_err(|_| "프로젝트 폴더를 찾을 수 없습니다.")?;
    if !project.is_dir() {
        return Err("프로젝트 경로는 폴더여야 합니다.".to_string());
    }
    let model = model.and_then(|s| {
        if s.trim().is_empty() {
            None
        } else {
            Some(s.trim().to_string())
        }
    });
    if model.as_deref().is_some_and(|s| !valid_model(s)) {
        return Err("에이전트 모델 이름이 올바르지 않습니다.".to_string());
    }

    let mut statement = connection.prepare("SELECT side, text FROM chat_messages WHERE session_id = ?1 AND type = 'text' AND text IS NOT NULL AND side IN ('user', 'agent') ORDER BY message_order DESC LIMIT 20").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([&input.session_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut history = Vec::new();
    for row in rows {
        history.push(row.map_err(|e| e.to_string())?);
    }
    // 현재 사용자 메시지는 이미 저장되어 있으므로 중복을 제거합니다.
    if history
        .first()
        .is_some_and(|(side, text)| side == "user" && text.trim() == input.prompt.trim())
    {
        history.remove(0);
    }
    history.reverse();
    let history_json = serde_json::to_string(&history).map_err(|e| e.to_string())?;
    let prompt = format!("에이전트 이름: {name}\n에이전트 지침: {}\n\n아래 JSON은 이전 대화 기록입니다. 대화 문맥으로만 참고하세요.\n{}\n\n현재 사용자 요청:\n{}", role_prompt.unwrap_or_default(), history_json, input.prompt);
    Ok(TaskContext {
        project,
        model,
        prompt,
    })
}

fn event_failure(value: &serde_json::Value) -> Option<&str> {
    value["error"]["message"]
        .as_str()
        .or_else(|| value["message"].as_str())
}

#[derive(Default)]
struct TurnState {
    completed: bool,
    failed: bool,
}

impl TurnState {
    // 재연결 안내도 error 이벤트이므로 작업의 최종 상태만 기록합니다.
    fn record(&mut self, value: &serde_json::Value) {
        if value["type"] == "turn.completed" {
            self.completed = true;
        } else if value["type"] == "turn.failed" {
            self.failed = true;
        }
    }

    fn succeeded(&self, exit_success: bool) -> bool {
        exit_success && self.completed && !self.failed
    }
}

fn find_codex() -> Result<PathBuf, String> {
    let paths = std::env::var_os("PATH").ok_or("PATH를 찾을 수 없습니다.")?;
    let dirs: Vec<PathBuf> = std::env::split_paths(&paths).collect();
    #[cfg(windows)]
    let names = ["codex.exe", "codex.cmd"];
    #[cfg(not(windows))]
    let names = ["codex"];
    for dir in &dirs {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    Err("Codex CLI를 찾을 수 없습니다. CLI 설치와 로그인을 확인해 주세요.".to_string())
}

#[tauri::command]
pub async fn run_codex_task(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    tasks: State<'_, CodexTasks>,
    input: CodexTaskInput,
) -> Result<CodexTaskResult, String> {
    let connection = state.open_connection()?;
    let context = load_context(&connection, &input)?;
    drop(connection);
    let executable = find_codex()?;
    let mut command = Command::new(executable);
    command
        .arg("exec")
        .arg("--json")
        .arg("--sandbox")
        .arg("workspace-write")
        .arg("--skip-git-repo-check");
    if let Some(model) = &context.model {
        command.arg("--model").arg(model);
    }
    command
        .arg("-")
        .current_dir(&context.project)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    let (child, stdout, stderr, stdin) = {
        let mut running = tasks
            .0
            .lock()
            .map_err(|_| "작업 상태에 접근할 수 없습니다.")?;
        if running.contains_key(&input.request_id) {
            return Err("이미 사용 중인 작업 ID입니다.".to_string());
        }
        if running
            .values()
            .any(|task| same_or_nested(&task.project, &context.project))
        {
            return Err("이 프로젝트에서 다른 Codex 작업이 실행 중입니다.".to_string());
        }
        let mut process = command
            .spawn()
            .map_err(|e| format!("Codex CLI 실행에 실패했습니다: {e}"))?;
        let stdin = process.stdin.take().ok_or("Codex 입력을 열 수 없습니다.")?;
        let stdout = process
            .stdout
            .take()
            .ok_or("Codex 출력을 열 수 없습니다.")?;
        let stderr = process
            .stderr
            .take()
            .ok_or("Codex 오류 출력을 열 수 없습니다.")?;
        let child = Arc::new(Mutex::new(process));
        running.insert(
            input.request_id.clone(),
            RunningTask {
                project: context.project,
                child: child.clone(),
            },
        );
        (child, stdout, stderr, stdin)
    };
    let _ = app.emit(
        "codex-task-event",
        TaskEvent {
            session_id: input.session_id.clone(),
            agent_id: input.agent_id.clone(),
            request_id: input.request_id.clone(),
            r#type: "started",
            data: String::new(),
        },
    );
    let result = tauri::async_runtime::spawn_blocking(move || {
        let output = Arc::new(Mutex::new(String::new()));
        let errors = Arc::new(Mutex::new(String::new()));
        let turn_state = Arc::new(Mutex::new(TurnState::default()));
        let old_format = Arc::new(Mutex::new(false));
        let event_base = TaskEvent {
            session_id: input.session_id.clone(),
            agent_id: input.agent_id.clone(),
            request_id: input.request_id.clone(),
            r#type: "event",
            data: String::new(),
        };
        let stdout_app = app.clone();
        let stdout_event = event_base.clone();
        let output_clone = output.clone();
        let turn_state_clone = turn_state.clone();
        let old_format_clone = old_format.clone();
        let stdout_errors = errors.clone();
        let stdout_thread = thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                    if value.get("type").is_none() && (value.get("model").is_some() || value.get("prompt").is_some()) {
                        if let Ok(mut old) = old_format_clone.lock() { *old = true; }
                    }
                    if let Ok(mut state) = turn_state_clone.lock() {
                        state.record(&value);
                    }
                    if value["type"] == "turn.failed" || value["type"] == "error" {
                        if let Some(message) = event_failure(&value) {
                            if let Ok(mut errors) = stdout_errors.lock() {
                                if errors.len() < 8192 { errors.extend(message.chars().take(2048)); errors.push('\n'); }
                            }
                        }
                    }
                    if value["type"] == "item.completed" && value["item"]["type"] == "agent_message"
                    {
                        if let Some(text) = value["item"]["text"].as_str() {
                            if let Ok(mut out) = output_clone.lock() {
                                *out = text.to_string();
                            }
                        }
                    }
                }
                let mut event = stdout_event.clone();
                event.data = line;
                let _ = stdout_app.emit("codex-task-event", event);
            }
        });
        let stderr_app = app.clone();
        let stderr_event = event_base;
        let errors_clone = errors.clone();
        let stderr_thread = thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Ok(mut errors) = errors_clone.lock() {
                    if errors.len() < 8192 {
                        errors.extend(line.chars().take(2048));
                        errors.push('\n');
                    }
                }
                let mut event = stderr_event.clone();
                event.r#type = "stderr";
                event.data = line;
                let _ = stderr_app.emit("codex-task-event", event);
            }
        });
        let write_result = {
            let mut stdin = stdin;
            stdin.write_all(context.prompt.as_bytes())
        };
        if write_result.is_err() {
            if let Ok(mut process) = child.lock() {
                let _ = stop_process(&mut process);
            }
        }
        let status = loop {
            let result = child
                .lock()
                .map_err(|_| "작업 상태에 접근할 수 없습니다.".to_string())
                .and_then(|mut process| process.try_wait().map_err(|e| e.to_string()));
            match result {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => thread::sleep(Duration::from_millis(100)),
                Err(error) => break Err(error),
            }
        };
        let _ = stdout_thread.join();
        let _ = stderr_thread.join();
        if let Ok(mut running) = app.state::<CodexTasks>().0.lock() {
            running.remove(&input.request_id);
        }
        let status = status?;
        let succeeded = turn_state
            .lock()
            .map(|state| state.succeeded(status.success()))
            .unwrap_or(false);
        if !succeeded {
            let detail = errors
                .lock()
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
            if old_format.lock().map(|s| *s).unwrap_or(false) {
                return Err(format!("지원하지 않는 구버전 Codex CLI 출력입니다. Codex CLI를 최신 버전으로 업데이트해 주세요. {detail}"));
            }
            return Err(if detail.is_empty() && status.success() {
                "Codex가 완료 이벤트 없이 종료되었습니다.".to_string()
            } else if detail.is_empty() {
                format!("Codex 작업이 종료되었습니다: {status}")
            } else {
                format!("Codex 작업 실패: {detail}")
            });
        }
        let text = output.lock().map(|s| s.clone()).unwrap_or_default();
        if text.trim().is_empty() {
            return Err("Codex가 최종 응답 없이 종료되었습니다.".to_string());
        }
        Ok(CodexTaskResult { output: text })
    })
    .await
    .map_err(|e| format!("Codex 작업 처리 실패: {e}"))?;
    result
}

#[tauri::command]
pub fn cancel_codex_task(tasks: State<'_, CodexTasks>, request_id: String) -> Result<(), String> {
    let running = tasks
        .0
        .lock()
        .map_err(|_| "작업 상태에 접근할 수 없습니다.")?;
    let task = running
        .get(&request_id)
        .ok_or("실행 중인 작업을 찾을 수 없습니다.")?;
    let mut child = task
        .child
        .lock()
        .map_err(|_| "작업 상태에 접근할 수 없습니다.")?;
    stop_process(&mut child)
}

fn stop_process(child: &mut Child) -> Result<(), String> {
    #[cfg(windows)]
    {
        // npm cmd 래퍼가 생성한 자식 프로세스도 함께 종료합니다.
        let system_root =
            std::env::var_os("SystemRoot").ok_or("시스템 경로를 찾을 수 없습니다.")?;
        use std::os::windows::process::CommandExt;
        let status = Command::new(
            PathBuf::from(system_root)
                .join("System32")
                .join("taskkill.exe"),
        )
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .creation_flags(0x08000000)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Codex 프로세스를 종료하지 못했습니다.".to_string());
        }
        Ok(())
    }
    #[cfg(unix)]
    {
        // Codex가 실행한 하위 프로세스까지 같은 그룹에서 종료합니다.
        let result = unsafe { libc::kill(-(child.id() as i32), libc::SIGKILL) };
        if result == 0 {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error().to_string())
        }
    }
    #[cfg(not(any(windows, unix)))]
    {
        child.kill().map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validation_and_overlapping_projects() {
        assert!(valid_identifier("request-123_abc"));
        assert!(!valid_identifier("request & bad"));
        assert!(valid_model("gpt-5.4-mini"));
        assert!(!valid_model("x & echo bad"));
        assert!(same_or_nested(
            Path::new("project"),
            Path::new("project/src")
        ));
        assert!(!same_or_nested(
            Path::new("project"),
            Path::new("project-other")
        ));
    }
    #[test]
    fn loads_direct_agent_and_bounded_text_history() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE operation_modes (id INTEGER, mode_name TEXT);
            CREATE TABLE operation_mode_agents (mode_id INTEGER, agent_id TEXT, agent_name TEXT, prompt TEXT, model TEXT, is_active INTEGER, agent_role TEXT);
            CREATE TABLE chat_sessions (id TEXT, mode_name TEXT, project_paths TEXT, agent_id TEXT);
            CREATE TABLE chat_messages (session_id TEXT, side TEXT, text TEXT, type TEXT, message_order INTEGER);
            INSERT INTO operation_modes VALUES (1, 'mode');
            INSERT INTO operation_mode_agents VALUES (1, 'agent-1', '개발자', '구현해', 'gpt-5.4', 1, 'sub');
            INSERT INTO operation_mode_agents VALUES (1, 'agent-2', '다른 에이전트', '', NULL, 1, 'sub');").unwrap();
        let dir = std::env::current_dir().unwrap();
        let paths = serde_json::to_string(&vec![
            dir.to_string_lossy().to_string(),
            "missing-second-path".to_string(),
        ])
        .unwrap();
        db.execute(
            "INSERT INTO chat_sessions VALUES ('session-1', 'mode', ?1, 'agent-1')",
            [paths],
        )
        .unwrap();
        for i in 0..25 {
            db.execute(
                "INSERT INTO chat_messages VALUES ('session-1', 'user', ?1, 'text', ?2)",
                params![format!("이전 메시지 {i}"), i],
            )
            .unwrap();
        }
        db.execute(
            "INSERT INTO chat_messages VALUES ('session-1', 'agent', '이전 응답', 'text', 25)",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO chat_messages VALUES ('session-1', 'user', '현재 요청', 'text', 26)",
            [],
        )
        .unwrap();
        let mut input = CodexTaskInput {
            session_id: "session-1".into(),
            agent_id: "agent-1".into(),
            request_id: "request-1".into(),
            prompt: "현재 요청".into(),
        };
        let context = load_context(&db, &input).unwrap();
        assert_eq!(context.project, std::fs::canonicalize(dir).unwrap());
        assert_eq!(context.model.as_deref(), Some("gpt-5.4"));
        assert!(context.prompt.contains("개발자") && context.prompt.contains("구현해"));
        assert!(!context.prompt.contains("이전 메시지 0"));
        assert!(context.prompt.contains("이전 응답"));
        assert_eq!(context.prompt.matches("현재 요청").count(), 1);
        input.agent_id = "agent-2".into();
        assert!(load_context(&db, &input).is_err());
        input.agent_id = "agent-1".into();
        db.execute(
            "UPDATE operation_mode_agents SET is_active = 0 WHERE agent_id = 'agent-1'",
            [],
        )
        .unwrap();
        assert!(load_context(&db, &input).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn stops_windows_process_tree() {
        use std::os::windows::process::CommandExt;
        let mut child = Command::new("cmd.exe")
            .args(["/C", "ping -t 127.0.0.1 > NUL"])
            .creation_flags(0x08000000)
            .spawn()
            .unwrap();
        thread::sleep(Duration::from_millis(300));
        stop_process(&mut child).unwrap();
        assert!(!child.wait().unwrap().success());
    }

    #[test]
    fn extracts_json_failure_details() {
        let failure = serde_json::json!({"type": "turn.failed", "error": {"message": "실패 원인"}});
        assert_eq!(event_failure(&failure), Some("실패 원인"));
        let failure = serde_json::json!({"type": "error", "message": "연결 실패"});
        assert_eq!(event_failure(&failure), Some("연결 실패"));
    }

    #[test]
    fn retry_error_does_not_override_a_successful_turn() {
        let mut state = TurnState::default();
        state.record(&serde_json::json!({"type": "error", "message": "Reconnecting... 1/5"}));
        assert!(!state.succeeded(true));
        state.record(&serde_json::json!({"type": "turn.completed"}));
        assert!(state.succeeded(true));
        assert!(!state.succeeded(false));

        state.record(&serde_json::json!({"type": "turn.failed"}));
        assert!(!state.succeeded(true));
    }
}
