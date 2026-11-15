use crate::app_state::AppState;
use rand::{distributions::Alphanumeric, Rng};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use tauri::State;
use tracing::{debug, info, warn};

const DEFAULT_SESSION_TITLE: &str = "새 채팅";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummaryPayload {
    id: String,
    title: String,
    updated_at: i64,
    mode_name: String,
    project_paths: Vec<String>,
    agent_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetailPayload {
    session: SessionSummaryPayload,
    messages: Vec<ChatMessagePayload>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessagePayload {
    id: String,
    agent_id: Option<String>,
    side: String,
    r#type: String,
    sender: Option<String>,
    byline: Option<String>,
    avatar_text: Option<String>,
    icon: Option<String>,
    icon_color: Option<String>,
    text: Option<String>,
    status_text: Option<String>,
    plan_title: Option<String>,
    steps: Option<Vec<String>>,
    logs: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionInput {
    title: Option<String>,
    mode_name: String,
    #[serde(default)]
    agent_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendMessageInput {
    session_id: String,
    message: ChatMessagePayload,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionProjectPathsInput {
    session_id: String,
    project_paths: Vec<String>,
}

#[tauri::command]
pub fn list_chat_sessions(state: State<AppState>) -> Result<Vec<SessionSummaryPayload>, String> {
    let connection = state.open_connection()?;
    let mut statement = connection
        .prepare(
            "
            SELECT id, title, updated_at, mode_name, project_paths, agent_id
            FROM chat_sessions
            ORDER BY mode_name ASC, updated_at DESC, id DESC
            ",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok(SessionSummaryPayload {
                id: row.get(0)?,
                title: row.get(1)?,
                updated_at: row.get(2)?,
                mode_name: row.get(3)?,
                project_paths: deserialize_json(row.get(4)?)?.unwrap_or_default(),
                agent_id: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?;

    let mut sessions = Vec::new();
    for row in rows {
        sessions.push(row.map_err(|error| error.to_string())?);
    }

    debug!(count = sessions.len(), "listed chat sessions");

    Ok(sessions)
}

#[tauri::command]
pub fn create_chat_session(
    state: State<AppState>,
    input: Option<CreateSessionInput>,
) -> Result<SessionSummaryPayload, String> {
    let mut connection = state.open_connection()?;
    create_session_in_connection(&mut connection, input)
}

fn create_session_in_connection(
    connection: &mut rusqlite::Connection,
    input: Option<CreateSessionInput>,
) -> Result<SessionSummaryPayload, String> {
    let title = normalize_title(input.as_ref().and_then(|value| value.title.clone()));
    let mode_name = normalize_mode_name(
        input
            .as_ref()
            .map(|value| value.mode_name.as_str())
            .unwrap_or_default(),
    )?;
    let agent_id = input.and_then(|value| value.agent_id.map(|id| id.trim().to_owned()));
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let project_paths = load_target_project_paths(&transaction, &mode_name, agent_id.as_deref())?;
    let now = now_millis();
    let session = SessionSummaryPayload {
        id: generate_id("session"),
        title,
        updated_at: now,
        mode_name,
        project_paths,
        agent_id,
    };

    transaction
        .execute(
            "
            INSERT INTO chat_sessions (id, title, created_at, updated_at, mode_name, project_paths, agent_id)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ",
            params![
                &session.id,
                &session.title,
                now,
                session.updated_at,
                &session.mode_name,
                serialize_json_vec(&session.project_paths)?,
                &session.agent_id
            ],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;

    info!(
        session_id = %session.id,
        mode_name = %session.mode_name,
        title = %session.title,
        "chat session created"
    );

    Ok(session)
}

#[tauri::command]
pub fn get_chat_session(
    state: State<AppState>,
    session_id: String,
) -> Result<SessionDetailPayload, String> {
    let connection = state.open_connection()?;
    let normalized_session_id = normalize_session_id(&session_id)?;
    let session = load_session_summary(&connection, &normalized_session_id)?;
    let messages = load_session_messages(&connection, &normalized_session_id)?;

    debug!(
        session_id = %normalized_session_id,
        message_count = messages.len(),
        "loaded chat session"
    );

    Ok(SessionDetailPayload { session, messages })
}

#[tauri::command]
pub fn delete_chat_session(state: State<AppState>, session_id: String) -> Result<(), String> {
    let connection = state.open_connection()?;
    let normalized_session_id = normalize_session_id(&session_id)?;

    let deleted_count = connection
        .execute(
            "DELETE FROM chat_sessions WHERE id = ?1",
            params![&normalized_session_id],
        )
        .map_err(|error| error.to_string())?;

    if deleted_count == 0 {
        warn!(session_id = %normalized_session_id, "chat session delete missed");
        return Err("채팅 세션을 찾을 수 없습니다.".to_string());
    }

    info!(session_id = %normalized_session_id, "chat session deleted");
    Ok(())
}

#[tauri::command]
pub fn append_chat_message(
    state: State<AppState>,
    input: AppendMessageInput,
) -> Result<ChatMessagePayload, String> {
    let mut connection = state.open_connection()?;
    append_message_in_connection(&mut connection, input)
}

fn append_message_in_connection(
    connection: &mut rusqlite::Connection,
    input: AppendMessageInput,
) -> Result<ChatMessagePayload, String> {
    let session_id = normalize_session_id(&input.session_id)?;
    let message = normalize_message(input.message)?;
    debug!(
        session_id = %session_id,
        message_id = %message.id,
        side = %message.side,
        message_type = %message.r#type,
        "appending chat message"
    );
    let now = now_millis();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;

    // 현재 모드의 활성 멤버만 발신할 수 있고, 개별 대화는 세션 대상까지 일치해야 합니다.
    let has_participant: Option<bool> = transaction
        .query_row(
            "SELECT EXISTS (
                SELECT 1 FROM operation_modes m
                JOIN operation_mode_agents a ON a.mode_id = m.id
                WHERE m.mode_name = s.mode_name AND a.is_active = 1
                  AND (s.agent_id IS NULL OR s.agent_id = a.agent_id)
                  AND (?2 IS NULL OR ?2 = a.agent_id)
             ) FROM chat_sessions s WHERE s.id = ?1",
            params![&session_id, &message.agent_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    if !has_participant.ok_or("채팅 세션을 찾을 수 없습니다.")? {
        return Err("이 대화에 참여할 수 있는 에이전트를 찾을 수 없습니다.".to_string());
    }

    let next_order: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(message_order), -1) + 1 FROM chat_messages WHERE session_id = ?1",
            params![&session_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    transaction
        .execute(
            "
            INSERT INTO chat_messages (
              id, session_id, message_order, side, type, sender, byline, avatar_text, icon,
              icon_color, text, status_text, plan_title, steps_json, logs_json, created_at, agent_id
            ) VALUES (
              ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
              ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17
            )
            ",
            params![
                &message.id,
                &session_id,
                next_order,
                &message.side,
                &message.r#type,
                &message.sender,
                &message.byline,
                &message.avatar_text,
                &message.icon,
                &message.icon_color,
                &message.text,
                &message.status_text,
                &message.plan_title,
                serialize_json(&message.steps)?,
                serialize_json(&message.logs)?,
                now,
                &message.agent_id,
            ],
        )
        .map_err(|error| error.to_string())?;

    transaction
        .execute(
            "UPDATE chat_sessions SET updated_at = ?2 WHERE id = ?1",
            params![&session_id, now],
        )
        .map_err(|error| error.to_string())?;

    transaction.commit().map_err(|error| error.to_string())?;
    info!(
        session_id = %session_id,
        message_id = %message.id,
        "chat message appended"
    );
    Ok(message)
}

#[tauri::command]
pub fn update_chat_session_project_paths(
    state: State<AppState>,
    input: UpdateSessionProjectPathsInput,
) -> Result<SessionSummaryPayload, String> {
    let connection = state.open_connection()?;
    let session_id = normalize_session_id(&input.session_id)?;
    let project_paths = normalize_string_list(input.project_paths);
    let now = now_millis();

    let updated = connection
        .execute(
            "
            UPDATE chat_sessions
            SET project_paths = ?2, updated_at = ?3
            WHERE id = ?1
            ",
            params![&session_id, serialize_json_vec(&project_paths)?, now],
        )
        .map_err(|error| error.to_string())?;

    if updated == 0 {
        return Err("채팅 세션을 찾을 수 없습니다.".to_string());
    }

    load_session_summary(&connection, &session_id)
}

#[tauri::command]
pub fn open_folder_in_explorer(path: String) -> Result<(), String> {
    let normalized_path = normalize_path(&path);
    if normalized_path.is_empty() {
        return Err("폴더 경로가 비어 있습니다.".to_string());
    }

    let path_ref = Path::new(&normalized_path);
    if !path_ref.exists() {
        return Err("폴더 경로를 찾을 수 없습니다.".to_string());
    }

    open::that(path_ref).map_err(|error| error.to_string())
}

fn load_session_summary(
    connection: &rusqlite::Connection,
    session_id: &str,
) -> Result<SessionSummaryPayload, String> {
    connection
        .query_row(
            "
            SELECT id, title, updated_at, mode_name, project_paths, agent_id
            FROM chat_sessions
            WHERE id = ?1
            ",
            params![session_id],
            |row| {
                Ok(SessionSummaryPayload {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    updated_at: row.get(2)?,
                    mode_name: row.get(3)?,
                    project_paths: deserialize_json(row.get(4)?)?.unwrap_or_default(),
                    agent_id: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "채팅 세션을 찾을 수 없습니다.".to_string())
}

fn load_session_messages(
    connection: &rusqlite::Connection,
    session_id: &str,
) -> Result<Vec<ChatMessagePayload>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT id, side, type, sender, byline, avatar_text, icon, icon_color, text,
                   status_text, plan_title, steps_json, logs_json, agent_id
            FROM chat_messages
            WHERE session_id = ?1
            ORDER BY message_order ASC, created_at ASC, id ASC
            ",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map(params![session_id], |row| {
            Ok(ChatMessagePayload {
                id: row.get(0)?,
                side: row.get(1)?,
                r#type: row.get(2)?,
                sender: row.get(3)?,
                byline: row.get(4)?,
                avatar_text: row.get(5)?,
                icon: row.get(6)?,
                icon_color: row.get(7)?,
                text: row.get(8)?,
                status_text: row.get(9)?,
                plan_title: row.get(10)?,
                steps: deserialize_json(row.get::<_, Option<String>>(11)?)?,
                logs: deserialize_json(row.get::<_, Option<String>>(12)?)?,
                agent_id: row.get(13)?,
            })
        })
        .map_err(|error| error.to_string())?;

    let mut messages = Vec::new();
    for row in rows {
        messages.push(row.map_err(|error| error.to_string())?);
    }

    Ok(messages)
}

fn load_target_project_paths(
    connection: &rusqlite::Connection,
    mode_name: &str,
    agent_id: Option<&str>,
) -> Result<Vec<String>, String> {
    let raw_paths = connection
        .query_row(
            "SELECT project_paths FROM operation_modes m WHERE m.mode_name = ?1
             AND (?2 IS NULL OR EXISTS (
                SELECT 1 FROM operation_mode_agents a WHERE a.mode_id = m.id AND a.agent_id = ?2
             ))",
            params![mode_name, agent_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or("선택한 모드 또는 에이전트를 찾을 수 없습니다.")?;

    deserialize_json(raw_paths)
        .map(|paths| normalize_string_list(paths.unwrap_or_default()))
        .map_err(|error| error.to_string())
}

fn normalize_session_id(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("세션 ID가 비어 있습니다.".to_string());
    }
    Ok(trimmed.to_string())
}

fn normalize_title(value: Option<String>) -> String {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .unwrap_or_else(|| DEFAULT_SESSION_TITLE.to_string())
}

fn normalize_mode_name(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("모드 이름이 비어 있습니다.".to_string());
    }
    Ok(trimmed.to_string())
}

fn normalize_path(value: &str) -> String {
    value.trim().trim_end_matches(['\\', '/']).to_string()
}

fn normalize_string_list(values: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::<String>::new();
    let mut seen = HashSet::<String>::new();

    for value in values {
        let normalized_value = normalize_path(&value);
        if normalized_value.is_empty() {
            continue;
        }

        let key = normalized_value.to_lowercase();
        if seen.contains(&key) {
            continue;
        }

        seen.insert(key);
        normalized.push(normalized_value);
    }

    normalized
}

fn normalize_message(message: ChatMessagePayload) -> Result<ChatMessagePayload, String> {
    if message.id.trim().is_empty() {
        return Err("메시지 ID가 비어 있습니다.".to_string());
    }

    match (message.side.as_str(), message.agent_id.as_deref()) {
        ("agent", None) => return Err("메시지를 작성한 에이전트 ID가 필요합니다.".to_string()),
        ("user", Some(_)) => return Err("사용자 메시지에 에이전트 ID가 있습니다.".to_string()),
        ("agent" | "user" | "status", _) => {}
        _ => return Err("메시지 방향이 올바르지 않습니다.".to_string()),
    }

    if message.r#type.trim().is_empty() {
        return Err("메시지 타입이 비어 있습니다.".to_string());
    }

    Ok(message)
}

fn serialize_json(value: &Option<Vec<String>>) -> Result<Option<String>, String> {
    value
        .as_ref()
        .map(|item| serde_json::to_string(item).map_err(|error| error.to_string()))
        .transpose()
}

fn serialize_json_vec(value: &Vec<String>) -> Result<Option<String>, String> {
    if value.is_empty() {
        Ok(None)
    } else {
        serde_json::to_string(value)
            .map(Some)
            .map_err(|error| error.to_string())
    }
}

fn deserialize_json(value: Option<String>) -> Result<Option<Vec<String>>, rusqlite::Error> {
    match value {
        Some(raw) => serde_json::from_str::<Vec<String>>(&raw)
            .map(Some)
            .map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            }),
        None => Ok(None),
    }
}

fn generate_id(prefix: &str) -> String {
    let suffix: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(16)
        .map(char::from)
        .collect();
    format!("{prefix}-{suffix}")
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod agent_session_tests {
    use super::*;
    use crate::migrations::run_migrations;

    #[test]
    fn replies_stay_with_their_participants_and_keep_the_original_sender() {
        let mut db = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut db).unwrap();
        db.execute_batch(
            "UPDATE operation_mode_agents SET agent_id = 'main';
             INSERT INTO operation_modes (mode_name, display_order) VALUES ('Other', 1);
             INSERT INTO operation_mode_agents (mode_id, agent_id, agent_name, icon, color)
               SELECT id, 'sub', '동료', '', '' FROM operation_modes WHERE mode_name = 'Orchestration';
             INSERT INTO operation_mode_agents (mode_id, agent_id, agent_name, icon, color)
               SELECT id, 'outsider', '외부', '', '' FROM operation_modes WHERE mode_name = 'Other';",
        ).unwrap();
        let new_session = |db: &mut rusqlite::Connection, mode: &str, agent: Option<&str>| {
            create_session_in_connection(
                db,
                Some(CreateSessionInput {
                    title: None,
                    mode_name: mode.into(),
                    agent_id: agent.map(str::to_string),
                }),
            )
        };
        assert!(new_session(&mut db, "Missing", None).is_err());
        let group = new_session(&mut db, "Orchestration", None).unwrap().id;
        let direct = new_session(&mut db, "Orchestration", Some("sub"))
            .unwrap()
            .id;
        let append = |db: &mut rusqlite::Connection,
                      session: &str,
                      id: &str,
                      side: &str,
                      agent: Option<&str>| {
            let input = serde_json::from_value(serde_json::json!({
                "sessionId": session,
                "message": { "id": id, "side": side, "type": "text", "sender": "동료", "agentId": agent }
            })).unwrap();
            append_message_in_connection(db, input)
        };
        append(&mut db, &group, "g1", "agent", Some("main")).unwrap();
        append(&mut db, &group, "g2", "agent", Some("sub")).unwrap();
        append(&mut db, &direct, "d1", "user", None).unwrap();
        append(&mut db, &direct, "d2", "agent", Some("sub")).unwrap();
        assert!(append(&mut db, &direct, "wrong-target", "agent", Some("main")).is_err());
        assert!(append(&mut db, &group, "wrong-mode", "agent", Some("outsider")).is_err());
        assert!(append(&mut db, &group, "missing-author", "agent", None).is_err());
        assert!(append(&mut db, &group, "invalid-author", "user", Some("sub")).is_err());
        db.execute(
            "UPDATE operation_mode_agents SET is_active = 0 WHERE agent_id = 'sub'",
            [],
        )
        .unwrap();
        assert!(append(&mut db, &group, "inactive", "agent", Some("sub")).is_err());
        db.execute(
            "DELETE FROM operation_mode_agents WHERE agent_id = 'sub'",
            [],
        )
        .unwrap();
        assert!(append(&mut db, &direct, "removed", "user", None).is_err());

        let history = load_session_messages(&db, &group).unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].agent_id.as_deref(), Some("main"));
        assert_eq!(history[1].agent_id.as_deref(), Some("sub"));
        assert_eq!(history[1].sender.as_deref(), Some("동료"));
        assert_eq!(load_session_messages(&db, &direct).unwrap().len(), 2);
    }

    #[test]
    fn direct_session_validates_mode_and_survives_agent_removal() {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut connection).unwrap();
        let agent_id: String = connection
            .query_row(
                "SELECT agent_id FROM operation_mode_agents LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO operation_modes (mode_name, display_order) VALUES ('Other', 1)",
                [],
            )
            .unwrap();
        let invalid = create_session_in_connection(
            &mut connection,
            Some(CreateSessionInput {
                title: None,
                mode_name: "Other".to_string(),
                agent_id: Some(agent_id.clone()),
            }),
        );
        assert!(invalid.is_err());
        let session = create_session_in_connection(
            &mut connection,
            Some(CreateSessionInput {
                title: Some("대화".to_string()),
                mode_name: "Orchestration".to_string(),
                agent_id: Some(agent_id.clone()),
            }),
        )
        .unwrap();
        let loaded = load_session_summary(&connection, &session.id).unwrap();
        assert_eq!(loaded.agent_id.as_deref(), Some(agent_id.as_str()));
        connection
            .execute(
                "DELETE FROM operation_mode_agents WHERE agent_id = ?1",
                [&agent_id],
            )
            .unwrap();
        assert_eq!(
            load_session_summary(&connection, &session.id)
                .unwrap()
                .agent_id,
            Some(agent_id)
        );

        let legacy = create_session_in_connection(
            &mut connection,
            Some(CreateSessionInput {
                title: None,
                mode_name: "Orchestration".to_string(),
                agent_id: None,
            }),
        )
        .unwrap();
        assert!(load_session_summary(&connection, &legacy.id)
            .unwrap()
            .agent_id
            .is_none());
    }
}
