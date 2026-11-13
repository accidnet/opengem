use crate::app_state::AppState;
use rand::{distributions::Alphanumeric, Rng};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use tauri::State;

const MEMORY_LIMIT: usize = 24 * 1024;
const LEASE_MILLIS: i64 = 10 * 60 * 1000;
const ROUTINE_COLUMNS: &str = "r.id, m.mode_name, r.agent_id, r.instruction, r.interval_minutes, r.enabled, r.checkpoint, r.next_run_at, r.last_run_at, r.last_error, r.mailbox_email";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemory {
    content: String,
    updated_at: Option<i64>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMemoryInput {
    mode_name: String,
    agent_id: String,
    content: String,
    expected_updated_at: Option<i64>,
}

#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentRoutine {
    id: String,
    mode_name: String,
    agent_id: String,
    instruction: String,
    interval_minutes: i64,
    enabled: bool,
    checkpoint: i64,
    next_run_at: i64,
    last_run_at: Option<i64>,
    last_error: Option<String>,
    mailbox_email: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRoutineInput {
    mode_name: String,
    agent_id: String,
    instruction: String,
    interval_minutes: i64,
    enabled: Option<bool>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimedRoutine {
    #[serde(flatten)]
    routine: AgentRoutine,
    lease_id: String,
    lease_expires_at: i64,
    agent_name: String,
    agent_prompt: Option<String>,
    agent_model: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteRoutineInput {
    routine_id: String,
    lease_id: String,
    report: String,
    checkpoint: Option<i64>,
    error: Option<String>,
    mailbox_email: Option<String>,
    #[serde(default)]
    message_ids: Vec<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentReport {
    id: String,
    routine_id: String,
    content: String,
    created_at: i64,
    status: String,
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or_default()
}

fn new_id(prefix: &str) -> String {
    let suffix: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(24)
        .map(char::from)
        .collect();
    format!("{prefix}-{suffix}")
}

fn agent_mode_id(connection: &Connection, mode_name: &str, agent_id: &str) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT m.id FROM operation_modes m JOIN operation_mode_agents a ON a.mode_id = m.id WHERE m.mode_name = ?1 AND a.agent_id = ?2",
            params![mode_name, agent_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "선택한 모드에서 에이전트를 찾을 수 없습니다.".to_string())
}

fn read_memory(
    connection: &Connection,
    mode_id: i64,
    agent_id: &str,
) -> Result<AgentMemory, String> {
    connection
        .query_row(
            "SELECT content, updated_at FROM agent_memories WHERE mode_id = ?1 AND agent_id = ?2",
            params![mode_id, agent_id],
            |row| {
                Ok(AgentMemory {
                    content: row.get(0)?,
                    updated_at: Some(row.get(1)?),
                })
            },
        )
        .optional()
        .map(|value| {
            value.unwrap_or(AgentMemory {
                content: String::new(),
                updated_at: None,
            })
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_agent_memory(
    state: State<AppState>,
    mode_name: String,
    agent_id: String,
) -> Result<AgentMemory, String> {
    let connection = state.open_connection()?;
    let mode_id = agent_mode_id(&connection, &mode_name, &agent_id)?;
    read_memory(&connection, mode_id, &agent_id)
}

fn save_memory(
    connection: &mut Connection,
    input: SaveMemoryInput,
    now: i64,
) -> Result<AgentMemory, String> {
    if input.content.len() > MEMORY_LIMIT {
        return Err("기억은 UTF-8 기준 24 KiB 이내로 정리해 주세요.".to_string());
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let mode_id = agent_mode_id(&transaction, &input.mode_name, &input.agent_id)?;
    let previous = read_memory(&transaction, mode_id, &input.agent_id)?;
    if input.expected_updated_at != previous.updated_at {
        return Err("다른 작업에서 기억을 변경했습니다. 다시 읽은 뒤 저장해 주세요.".to_string());
    }
    let updated_at = now.max(previous.updated_at.unwrap_or_default() + 1);
    transaction.execute(
        "INSERT INTO agent_memories (mode_id, agent_id, content, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(mode_id, agent_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at",
        params![mode_id, input.agent_id, input.content, updated_at],
    ).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(AgentMemory {
        content: input.content,
        updated_at: Some(updated_at),
    })
}

#[tauri::command]
pub fn save_agent_memory(
    state: State<AppState>,
    input: SaveMemoryInput,
) -> Result<AgentMemory, String> {
    save_memory(&mut state.open_connection()?, input, now_millis())
}

fn recent_context(
    connection: &Connection,
    mode_name: &str,
    agent_id: &str,
) -> Result<String, String> {
    agent_mode_id(connection, mode_name, agent_id)?;
    let mut statement = connection.prepare(
        "SELECT msg.side, msg.text FROM chat_messages msg JOIN chat_sessions s ON s.id = msg.session_id WHERE s.mode_name = ?1 AND s.agent_id = ?2 AND msg.side IN ('user', 'agent') AND msg.type = 'text' AND msg.text IS NOT NULL ORDER BY msg.created_at DESC, msg.message_order DESC LIMIT 20",
    ).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![mode_name, agent_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    let mut remaining = 12_000;
    let mut messages = Vec::new();
    for row in rows {
        let (side, content) = row.map_err(|error| error.to_string())?;
        if remaining == 0 {
            break;
        }
        let text: String = content.chars().take(remaining.min(2_000)).collect();
        remaining -= text.chars().count();
        messages.push(format!("[{side}] {text}"));
    }
    messages.reverse();
    Ok(messages.join("\n\n"))
}

#[tauri::command]
pub fn get_agent_recent_context(
    state: State<AppState>,
    mode_name: String,
    agent_id: String,
) -> Result<String, String> {
    recent_context(&state.open_connection()?, &mode_name, &agent_id)
}

fn routine_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentRoutine> {
    Ok(AgentRoutine {
        id: row.get(0)?,
        mode_name: row.get(1)?,
        agent_id: row.get(2)?,
        instruction: row.get(3)?,
        interval_minutes: row.get(4)?,
        enabled: row.get(5)?,
        checkpoint: row.get(6)?,
        next_run_at: row.get(7)?,
        last_run_at: row.get(8)?,
        last_error: row.get(9)?,
        mailbox_email: row.get(10)?,
    })
}

fn read_routines(
    connection: &Connection,
    mode_name: &str,
    agent_id: &str,
) -> Result<Vec<AgentRoutine>, String> {
    let mode_id = agent_mode_id(connection, mode_name, agent_id)?;
    let mut statement = connection.prepare(&format!("SELECT {ROUTINE_COLUMNS} FROM agent_routines r JOIN operation_modes m ON m.id = r.mode_id WHERE r.mode_id = ?1 AND r.agent_id = ?2")).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![mode_id, agent_id], routine_from_row)
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_agent_routines(
    state: State<AppState>,
    mode_name: String,
    agent_id: String,
) -> Result<Vec<AgentRoutine>, String> {
    read_routines(&state.open_connection()?, &mode_name, &agent_id)
}

fn save_routine(
    connection: &mut Connection,
    input: SaveRoutineInput,
    now: i64,
) -> Result<AgentRoutine, String> {
    let instruction = input.instruction.trim();
    if instruction.is_empty() || instruction.len() > 8_000 {
        return Err(
            "반복 업무 지시는 비어 있지 않은 8,000바이트 이내의 내용이어야 합니다.".to_string(),
        );
    }
    if !(5..=10_080).contains(&input.interval_minutes) {
        return Err("반복 주기는 5분에서 7일 사이로 설정해 주세요.".to_string());
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let mode_id = agent_mode_id(&transaction, &input.mode_name, &input.agent_id)?;
    // 수정 시 확인한 이메일 위치는 보존하고, 이전 실행 결과가 새 지시를 덮어쓰지 못하게 합니다.
    transaction.execute(
        "INSERT INTO agent_routines (id, mode_id, agent_id, instruction, interval_minutes, enabled, checkpoint, next_run_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7) ON CONFLICT(mode_id, agent_id) DO UPDATE SET instruction = excluded.instruction, interval_minutes = excluded.interval_minutes, enabled = excluded.enabled, next_run_at = excluded.next_run_at, last_error = NULL, lease_id = NULL, lease_expires_at = NULL",
        params![new_id("routine"), mode_id, input.agent_id, instruction, input.interval_minutes, input.enabled.unwrap_or(true), now],
    ).map_err(|error| error.to_string())?;
    let routine = read_routines(&transaction, &input.mode_name, &input.agent_id)?
        .into_iter()
        .next()
        .ok_or_else(|| "반복 업무 저장 결과가 없습니다.".to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(routine)
}

#[tauri::command]
pub fn save_email_routine(
    state: State<AppState>,
    input: SaveRoutineInput,
) -> Result<AgentRoutine, String> {
    save_routine(&mut state.open_connection()?, input, now_millis())
}

fn update_routine_enabled(
    connection: &Connection,
    mode_name: &str,
    agent_id: &str,
    routine_id: &str,
    enabled: bool,
    now: i64,
) -> Result<(), String> {
    let mode_id = agent_mode_id(connection, mode_name, agent_id)?;
    let count = connection.execute("UPDATE agent_routines SET enabled = ?1, next_run_at = ?2, lease_id = NULL, lease_expires_at = NULL WHERE id = ?3 AND mode_id = ?4 AND agent_id = ?5", params![enabled, now, routine_id, mode_id, agent_id]).map_err(|error| error.to_string())?;
    if count == 0 {
        return Err("이 에이전트의 반복 업무를 찾을 수 없습니다.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn set_agent_routine_enabled(
    state: State<AppState>,
    mode_name: String,
    agent_id: String,
    routine_id: String,
    enabled: bool,
) -> Result<(), String> {
    update_routine_enabled(
        &state.open_connection()?,
        &mode_name,
        &agent_id,
        &routine_id,
        enabled,
        now_millis(),
    )
}

#[tauri::command]
pub fn run_agent_routine_now(
    state: State<AppState>,
    mode_name: String,
    agent_id: String,
    routine_id: String,
) -> Result<(), String> {
    let connection = state.open_connection()?;
    let mode_id = agent_mode_id(&connection, &mode_name, &agent_id)?;
    let count = connection.execute("UPDATE agent_routines SET next_run_at = ?1 WHERE id = ?2 AND mode_id = ?3 AND agent_id = ?4 AND enabled = 1", params![now_millis(), routine_id, mode_id, agent_id]).map_err(|error| error.to_string())?;
    if count == 0 {
        return Err("활성화된 반복 업무를 찾을 수 없습니다. 먼저 재개해 주세요.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn delete_agent_routine(
    state: State<AppState>,
    mode_name: String,
    agent_id: String,
    routine_id: String,
) -> Result<(), String> {
    let connection = state.open_connection()?;
    let mode_id = agent_mode_id(&connection, &mode_name, &agent_id)?;
    let count = connection
        .execute(
            "DELETE FROM agent_routines WHERE id = ?1 AND mode_id = ?2 AND agent_id = ?3",
            params![routine_id, mode_id, agent_id],
        )
        .map_err(|error| error.to_string())?;
    if count == 0 {
        return Err("이 에이전트의 반복 업무를 찾을 수 없습니다.".to_string());
    }
    Ok(())
}

fn claim_due(connection: &mut Connection, now: i64) -> Result<Vec<ClaimedRoutine>, String> {
    // 여러 창/중복 타이머가 동시에 실행되어도 하나만 임대를 획득합니다.
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let candidate = transaction.query_row(
        &format!("SELECT {ROUTINE_COLUMNS}, a.agent_name, a.prompt, COALESCE(a.model, m.default_model) FROM agent_routines r JOIN operation_modes m ON m.id = r.mode_id JOIN operation_mode_agents a ON a.mode_id = r.mode_id AND a.agent_id = r.agent_id WHERE r.enabled = 1 AND a.is_active = 1 AND r.next_run_at <= ?1 AND (r.lease_expires_at IS NULL OR r.lease_expires_at <= ?1) ORDER BY r.next_run_at, r.id LIMIT 1"),
        [now],
        |row| Ok((routine_from_row(row)?, row.get::<_, String>(11)?, row.get::<_, Option<String>>(12)?, row.get::<_, Option<String>>(13)?)),
    ).optional().map_err(|error| error.to_string())?;
    let Some((routine, agent_name, agent_prompt, agent_model)) = candidate else {
        return Ok(Vec::new());
    };
    let lease_id = new_id("lease");
    let lease_expires_at = now + LEASE_MILLIS;
    transaction
        .execute(
            "UPDATE agent_routines SET lease_id = ?1, lease_expires_at = ?2 WHERE id = ?3",
            params![lease_id, lease_expires_at, routine.id],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(vec![ClaimedRoutine {
        routine,
        lease_id,
        lease_expires_at,
        agent_name,
        agent_prompt,
        agent_model,
    }])
}

#[tauri::command]
pub fn claim_due_email_routines(state: State<AppState>) -> Result<Vec<ClaimedRoutine>, String> {
    claim_due(&mut state.open_connection()?, now_millis())
}

fn complete_routine(
    connection: &mut Connection,
    input: CompleteRoutineInput,
    now: i64,
) -> Result<(), String> {
    if input.report.len() > 2 * 1024 * 1024
        || input
            .error
            .as_ref()
            .is_some_and(|error| error.len() > 8_000)
    {
        return Err("반복 업무 결과가 저장 한도를 초과했습니다.".to_string());
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let current: Option<(i64, i64, Option<String>)> = transaction.query_row(
        "SELECT r.checkpoint, r.interval_minutes, r.mailbox_email FROM agent_routines r JOIN operation_mode_agents a ON a.mode_id = r.mode_id AND a.agent_id = r.agent_id WHERE r.id = ?1 AND r.lease_id = ?2 AND r.lease_expires_at > ?3 AND r.enabled = 1 AND a.is_active = 1",
        params![input.routine_id, input.lease_id, now],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).optional().map_err(|error| error.to_string())?;
    let Some((checkpoint, interval_minutes, bound_mailbox)) = current else {
        return Err(
            "반복 업무가 변경되었거나 실행 시간이 만료되었습니다. 이전 결과는 저장하지 않았습니다."
                .to_string(),
        );
    };
    let error = input
        .error
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let success = error.is_none();
    let next_checkpoint = if success {
        input
            .checkpoint
            .ok_or_else(|| "성공한 실행에는 이메일 확인 시각이 필요합니다.".to_string())?
    } else {
        checkpoint
    };
    if next_checkpoint < checkpoint || next_checkpoint > now {
        return Err("이메일 확인 시각은 이전 확인 시각과 현재 시각 사이여야 합니다.".to_string());
    }
    validate_message_ids(&input.message_ids)?;
    let mailbox = if success {
        let email = normalize_mailbox(input.mailbox_email.as_deref().unwrap_or_default())?;
        verify_mailbox(bound_mailbox.as_deref(), &email)?;
        Some(email)
    } else {
        bound_mailbox
    };
    let retry_minutes = if success {
        interval_minutes
    } else {
        interval_minutes.min(15)
    };
    transaction.execute(
        "UPDATE agent_routines SET checkpoint = ?1, next_run_at = ?2, last_run_at = ?3, last_error = ?4, lease_id = NULL, lease_expires_at = NULL, mailbox_email = ?7 WHERE id = ?5 AND lease_id = ?6",
        params![next_checkpoint, now + retry_minutes * 60_000, now, error, input.routine_id, input.lease_id, mailbox],
    ).map_err(|error| error.to_string())?;
    if success {
        for message_id in &input.message_ids {
            transaction.execute("INSERT INTO agent_routine_seen_messages (routine_id, mailbox_email, message_id, checked_until) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(routine_id, mailbox_email, message_id) DO UPDATE SET checked_until = excluded.checked_until", params![input.routine_id, mailbox, message_id, next_checkpoint]).map_err(|error| error.to_string())?;
        }
        transaction.execute("DELETE FROM agent_routine_seen_messages WHERE routine_id = ?1 AND checked_until < ?2", params![input.routine_id, next_checkpoint - 5 * 60_000]).map_err(|error| error.to_string())?;
    }
    let content = if input.report.trim().is_empty() {
        error.unwrap_or("새로 도착한 이메일이 없습니다.")
    } else {
        input.report.as_str()
    };
    transaction.execute("INSERT INTO agent_reports (id, routine_id, content, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5)", params![new_id("report"), input.routine_id, content, if success { "success" } else { "error" }, now]).map_err(|error| error.to_string())?;
    // 결과와 확인 위치를 같은 트랜잭션으로 기록해 실패 시 이메일을 건너뛰지 않습니다.
    transaction.execute("DELETE FROM agent_reports WHERE routine_id = ?1 AND id NOT IN (SELECT id FROM agent_reports WHERE routine_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 30)", [&input.routine_id]).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn complete_email_routine(
    state: State<AppState>,
    input: CompleteRoutineInput,
) -> Result<(), String> {
    complete_routine(&mut state.open_connection()?, input, now_millis())
}

#[tauri::command]
pub fn list_agent_reports(
    state: State<AppState>,
    mode_name: String,
    agent_id: String,
) -> Result<Vec<AgentReport>, String> {
    let connection = state.open_connection()?;
    let mode_id = agent_mode_id(&connection, &mode_name, &agent_id)?;
    let mut statement = connection.prepare("SELECT p.id, p.routine_id, p.content, p.created_at, p.status FROM agent_reports p JOIN agent_routines r ON r.id = p.routine_id WHERE r.mode_id = ?1 AND r.agent_id = ?2 ORDER BY p.created_at DESC, p.id DESC LIMIT 30").map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![mode_id, agent_id], |row| {
            Ok(AgentReport {
                id: row.get(0)?,
                routine_id: row.get(1)?,
                content: row.get(2)?,
                created_at: row.get(3)?,
                status: row.get(4)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn normalize_mailbox(value: &str) -> Result<String, String> {
    let email = value.trim().to_lowercase();
    if email.len() > 320 || !email.contains('@') || email.chars().any(char::is_whitespace) {
        return Err("연결된 이메일 계정을 확인할 수 없습니다.".to_string());
    }
    Ok(email)
}

fn verify_mailbox(bound: Option<&str>, mailbox: &str) -> Result<(), String> {
    if bound.is_some_and(|value| value != mailbox) {
        return Err("이메일 계정이 변경되었습니다. 이전 계정의 확인 위치를 재사용하지 않도록 이 반복 업무를 삭제한 뒤 다시 등록해 주세요.".to_string());
    }
    Ok(())
}

fn validate_message_ids(ids: &[String]) -> Result<(), String> {
    if ids.len() > 1_000 || ids.iter().any(|id| id.is_empty() || id.len() > 256) {
        return Err("이메일 식별자 목록이 유효하지 않습니다.".to_string());
    }
    Ok(())
}

fn seen_message_ids(
    connection: &Connection,
    routine_id: &str,
    lease_id: &str,
    mailbox_email: &str,
    message_ids: Vec<String>,
    now: i64,
) -> Result<Vec<String>, String> {
    validate_message_ids(&message_ids)?;
    let mailbox = normalize_mailbox(mailbox_email)?;
    let bound: Option<Option<String>> = connection.query_row(
        "SELECT r.mailbox_email FROM agent_routines r JOIN operation_mode_agents a ON a.mode_id = r.mode_id AND a.agent_id = r.agent_id WHERE r.id = ?1 AND r.lease_id = ?2 AND r.lease_expires_at > ?3 AND r.enabled = 1 AND a.is_active = 1",
        params![routine_id, lease_id, now], |row| row.get(0),
    ).optional().map_err(|error| error.to_string())?;
    let bound = bound.ok_or_else(|| "반복 업무의 실행 권한이 만료되었습니다.".to_string())?;
    verify_mailbox(bound.as_deref(), &mailbox)?;
    let mut statement = connection.prepare("SELECT EXISTS(SELECT 1 FROM agent_routine_seen_messages WHERE routine_id = ?1 AND mailbox_email = ?2 AND message_id = ?3)").map_err(|error| error.to_string())?;
    let mut seen = Vec::new();
    for id in message_ids {
        let exists: bool = statement
            .query_row(params![routine_id, mailbox, id], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        if exists {
            seen.push(id);
        }
    }
    Ok(seen)
}

#[tauri::command]
pub fn get_email_routine_seen_ids(
    state: State<AppState>,
    routine_id: String,
    lease_id: String,
    mailbox_email: String,
    message_ids: Vec<String>,
) -> Result<Vec<String>, String> {
    seen_message_ids(
        &state.open_connection()?,
        &routine_id,
        &lease_id,
        &mailbox_email,
        message_ids,
        now_millis(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations::run_migrations;

    fn setup() -> (Connection, Vec<String>) {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys = ON")
            .unwrap();
        run_migrations(&mut connection).unwrap();
        // 에이전트별 격리 검증에 필요한 두 번째 에이전트는 테스트에서 직접 추가합니다.
        connection
            .execute(
                "INSERT INTO operation_mode_agents (mode_id, agent_name, icon, color, agent_role, display_order, agent_id)
                 SELECT id, '보조 에이전트', 'code', 'emerald', 'sub', 1, 'test-secondary-agent'
                 FROM operation_modes WHERE mode_name = 'Orchestration'",
                [],
            )
            .unwrap();
        let ids = connection
            .prepare("SELECT agent_id FROM operation_mode_agents ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        (connection, ids)
    }

    fn routine(connection: &mut Connection, agent_id: &str, now: i64) -> AgentRoutine {
        save_routine(
            connection,
            SaveRoutineInput {
                mode_name: "Orchestration".to_string(),
                agent_id: agent_id.to_string(),
                instruction: "새 이메일과 일정을 정리해 줘".to_string(),
                interval_minutes: 60,
                enabled: None,
            },
            now,
        )
        .unwrap()
    }

    fn finish(
        run: &ClaimedRoutine,
        checkpoint: Option<i64>,
        error: Option<&str>,
    ) -> CompleteRoutineInput {
        CompleteRoutineInput {
            routine_id: run.routine.id.clone(),
            lease_id: run.lease_id.clone(),
            report: "요약".to_string(),
            checkpoint,
            error: error.map(str::to_string),
            mailbox_email: Some("owner@example.com".to_string()),
            message_ids: vec!["message-1".to_string()],
        }
    }

    #[test]
    fn memory_is_scoped_and_survives_mode_rename_and_agent_reinsert() {
        let (mut connection, ids) = setup();
        let saved = save_memory(
            &mut connection,
            SaveMemoryInput {
                mode_name: "Orchestration".to_string(),
                agent_id: ids[0].clone(),
                content: "# 기억\n사용자는 오전 보고를 선호한다.".to_string(),
                expected_updated_at: None,
            },
            10,
        )
        .unwrap();
        assert!(save_memory(
            &mut connection,
            SaveMemoryInput {
                mode_name: "Orchestration".to_string(),
                agent_id: ids[0].clone(),
                content: "초기 화면의 오래된 변경".to_string(),
                expected_updated_at: None
            },
            11
        )
        .is_err());
        let mode_id = agent_mode_id(&connection, "Orchestration", &ids[0]).unwrap();
        assert!(read_memory(&connection, mode_id, &ids[1])
            .unwrap()
            .content
            .is_empty());
        connection
            .execute(
                "UPDATE operation_modes SET mode_name = 'Renamed' WHERE id = ?1",
                [mode_id],
            )
            .unwrap();
        assert!(agent_mode_id(&connection, "Orchestration", &ids[0]).is_err());
        assert_eq!(
            agent_mode_id(&connection, "Renamed", &ids[0]).unwrap(),
            mode_id
        );
        connection.execute_batch("CREATE TEMP TABLE saved_agents AS SELECT * FROM operation_mode_agents; DELETE FROM operation_mode_agents; INSERT INTO operation_mode_agents SELECT * FROM saved_agents;").unwrap();
        assert_eq!(
            read_memory(&connection, mode_id, &ids[0]).unwrap().content,
            saved.content
        );
        assert!(save_memory(
            &mut connection,
            SaveMemoryInput {
                mode_name: "Renamed".to_string(),
                agent_id: ids[0].clone(),
                content: "오래된 변경".to_string(),
                expected_updated_at: Some(9)
            },
            20
        )
        .is_err());
        connection
            .execute("DELETE FROM operation_modes WHERE id = ?1", [mode_id])
            .unwrap();
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM agent_memories", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn leases_exclude_duplicate_runs_and_recover_after_restart() {
        let (mut connection, ids) = setup();
        let created = routine(&mut connection, &ids[0], 1_000);
        let first = claim_due(&mut connection, 1_000).unwrap().remove(0);
        assert_eq!(first.routine.checkpoint, 1_000);
        assert!(claim_due(&mut connection, 1_001).unwrap().is_empty());
        let second = claim_due(&mut connection, 1_000 + LEASE_MILLIS)
            .unwrap()
            .remove(0);
        assert_ne!(first.lease_id, second.lease_id);
        assert!(complete_routine(
            &mut connection,
            finish(&first, Some(1_100), None),
            1_001 + LEASE_MILLIS
        )
        .is_err());
        complete_routine(
            &mut connection,
            finish(&second, Some(1_100), None),
            1_002 + LEASE_MILLIS,
        )
        .unwrap();
        assert_eq!(
            read_routines(&connection, "Orchestration", &ids[0]).unwrap()[0].checkpoint,
            1_100
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM agent_reports WHERE routine_id = ?1",
                    [created.id],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
    }

    #[test]
    fn failed_runs_preserve_checkpoint_and_success_deduplicates_atomically() {
        let (mut connection, ids) = setup();
        routine(&mut connection, &ids[0], 1_000);
        let first = claim_due(&mut connection, 1_000).unwrap().remove(0);
        complete_routine(
            &mut connection,
            finish(&first, Some(2_000), Some("다시 로그인해 주세요")),
            3_000,
        )
        .unwrap();
        let failed = read_routines(&connection, "Orchestration", &ids[0])
            .unwrap()
            .remove(0);
        assert_eq!(failed.checkpoint, 1_000);
        assert!(failed.mailbox_email.is_none());
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM agent_routine_seen_messages",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        let second = claim_due(&mut connection, failed.next_run_at)
            .unwrap()
            .remove(0);
        complete_routine(
            &mut connection,
            finish(&second, Some(failed.next_run_at), None),
            failed.next_run_at + 1,
        )
        .unwrap();
        let success = read_routines(&connection, "Orchestration", &ids[0])
            .unwrap()
            .remove(0);
        let third = claim_due(&mut connection, success.next_run_at)
            .unwrap()
            .remove(0);
        let seen = seen_message_ids(
            &connection,
            &third.routine.id,
            &third.lease_id,
            "OWNER@example.com",
            vec!["message-1".to_string(), "message-2".to_string()],
            success.next_run_at,
        )
        .unwrap();
        assert_eq!(seen, vec!["message-1".to_string()]);
        assert!(seen_message_ids(
            &connection,
            &third.routine.id,
            &third.lease_id,
            "another@example.com",
            Vec::new(),
            success.next_run_at
        )
        .is_err());
        let mut switched = finish(&third, Some(success.next_run_at), None);
        switched.mailbox_email = Some("another@example.com".to_string());
        assert!(complete_routine(&mut connection, switched, success.next_run_at + 1).is_err());
        assert_eq!(
            read_routines(&connection, "Orchestration", &ids[0]).unwrap()[0].checkpoint,
            failed.next_run_at
        );
    }

    #[test]
    fn paused_deleted_or_changed_agents_cannot_commit_old_runs() {
        let (mut connection, ids) = setup();
        let created = routine(&mut connection, &ids[0], 1_000);
        let first = claim_due(&mut connection, 1_000).unwrap().remove(0);
        assert!(update_routine_enabled(
            &connection,
            "Orchestration",
            &ids[1],
            &created.id,
            false,
            1_001
        )
        .is_err());
        update_routine_enabled(
            &connection,
            "Orchestration",
            &ids[0],
            &created.id,
            false,
            1_001,
        )
        .unwrap();
        assert!(
            complete_routine(&mut connection, finish(&first, Some(1_100), None), 1_200).is_err()
        );
        assert!(claim_due(&mut connection, 1_300).unwrap().is_empty());
        update_routine_enabled(
            &connection,
            "Orchestration",
            &ids[0],
            &created.id,
            true,
            1_300,
        )
        .unwrap();
        let second = claim_due(&mut connection, 1_300).unwrap().remove(0);
        connection
            .execute(
                "DELETE FROM operation_mode_agents WHERE agent_id = ?1",
                [&ids[0]],
            )
            .unwrap();
        assert!(
            complete_routine(&mut connection, finish(&second, Some(1_400), None), 1_500).is_err()
        );
        assert!(claim_due(&mut connection, 1_300 + LEASE_MILLIS)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn invalid_checkpoint_rolls_back_report_and_lease_state() {
        let (mut connection, ids) = setup();
        routine(&mut connection, &ids[0], 1_000);
        let first = claim_due(&mut connection, 1_000).unwrap().remove(0);
        assert!(complete_routine(&mut connection, finish(&first, Some(999), None), 1_200).is_err());
        assert!(
            complete_routine(&mut connection, finish(&first, Some(2_000), None), 1_200).is_err()
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM agent_reports", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        complete_routine(&mut connection, finish(&first, Some(1_100), None), 1_200).unwrap();
    }

    #[test]
    fn recalled_conversations_never_cross_agent_scope() {
        let (connection, ids) = setup();
        for (index, agent_id) in ids.iter().take(2).enumerate() {
            let session_id = format!("session-{index}");
            connection.execute("INSERT INTO chat_sessions (id, title, created_at, updated_at, mode_name, agent_id) VALUES (?1, '대화', 1, 1, 'Orchestration', ?2)", params![session_id, agent_id]).unwrap();
            connection.execute("INSERT INTO chat_messages (id, session_id, message_order, side, type, text, created_at) VALUES (?1, ?2, 0, 'user', 'text', ?3, 1)", params![format!("message-{index}"), session_id, format!("private-{index}")]).unwrap();
        }
        let context = recent_context(&connection, "Orchestration", &ids[0]).unwrap();
        assert!(context.contains("private-0"));
        assert!(!context.contains("private-1"));
        assert!(recent_context(&connection, "Missing", &ids[0]).is_err());
    }

    #[test]
    fn changing_routine_keeps_checkpoint_and_invalidates_previous_lease() {
        let (mut connection, ids) = setup();
        let original = routine(&mut connection, &ids[0], 1_000);
        let first = claim_due(&mut connection, 1_000).unwrap().remove(0);
        let updated = routine(&mut connection, &ids[0], 2_000);
        assert_eq!(original.id, updated.id);
        assert_eq!(updated.checkpoint, 1_000);
        assert!(
            complete_routine(&mut connection, finish(&first, Some(2_000), None), 2_100).is_err()
        );
        assert_eq!(claim_due(&mut connection, 2_100).unwrap().len(), 1);
    }
}
