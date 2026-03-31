use crate::app_state::AppState;
use rand::{distributions::Alphanumeric, Rng};
use rusqlite::{params, OptionalExtension};
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
            SELECT id, title, updated_at, mode_name, project_paths
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
    let connection = state.open_connection()?;
    let title = normalize_title(input.as_ref().and_then(|value| value.title.clone()));
    let mode_name = normalize_mode_name(
        input
            .as_ref()
            .map(|value| value.mode_name.as_str())
            .unwrap_or_default(),
    )?;
    let project_paths = load_mode_project_paths(&connection, &mode_name)?;
    let now = now_millis();
    let session = SessionSummaryPayload {
        id: generate_id("session"),
        title,
        updated_at: now,
        mode_name,
        project_paths,
    };

    connection
        .execute(
            "
            INSERT INTO chat_sessions (id, title, created_at, updated_at, mode_name, project_paths)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ",
            params![
                &session.id,
                &session.title,
                now,
                session.updated_at,
                &session.mode_name,
                serialize_json_vec(&session.project_paths)?
            ],
        )
        .map_err(|error| error.to_string())?;

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
    let transaction = connection.transaction().map_err(|error| error.to_string())?;

    let exists: Option<String> = transaction
        .query_row(
            "SELECT id FROM chat_sessions WHERE id = ?1",
            params![&session_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    if exists.is_none() {
        return Err("채팅 세션을 찾을 수 없습니다.".to_string());
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
              icon_color, text, status_text, plan_title, steps_json, logs_json, created_at
            ) VALUES (
              ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
              ?10, ?11, ?12, ?13, ?14, ?15, ?16
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
            SELECT id, title, updated_at, mode_name, project_paths
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
                   status_text, plan_title, steps_json, logs_json
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
            })
        })
        .map_err(|error| error.to_string())?;

    let mut messages = Vec::new();
    for row in rows {
        messages.push(row.map_err(|error| error.to_string())?);
    }

    Ok(messages)
}

fn load_mode_project_paths(
    connection: &rusqlite::Connection,
    mode_name: &str,
) -> Result<Vec<String>, String> {
    let raw_paths = connection
        .query_row(
            "SELECT project_paths FROM operation_modes WHERE mode_name = ?1",
            params![mode_name],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .flatten();

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

    if message.side.trim().is_empty() {
        return Err("메시지 방향이 비어 있습니다.".to_string());
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
