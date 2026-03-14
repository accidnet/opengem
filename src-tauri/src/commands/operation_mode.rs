use crate::app_state::AppState;
use rusqlite::{params, OptionalExtension};
use std::collections::HashSet;
use tauri::State;

const SQL_SELECT_OPERATION_MODES: &str =
    include_str!("../../sql/queries/operation_mode/select_all.sql");
const SQL_INSERT_OPERATION_MODE: &str = include_str!("../../sql/queries/operation_mode/insert.sql");
const SQL_UPDATE_SELECTED_OPERATION_MODE: &str =
    include_str!("../../sql/queries/operation_mode/update_selected.sql");
const SQL_DELETE_OPERATION_MODE: &str =
    include_str!("../../sql/queries/operation_mode/delete_by_name.sql");
const SQL_SELECT_FIRST_OPERATION_MODE: &str =
    include_str!("../../sql/queries/operation_mode/select_first.sql");

const DEFAULT_OPERATION_MODES: [&str; 1] = ["Orchestration"];

fn default_agent_role() -> String {
    "sub".to_string()
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentPayload {
    name: String,
    icon: String,
    color: String,
    active: bool,
    #[serde(default = "default_agent_role")]
    role: String,
    model: Option<String>,
    prompt: Option<String>,
    tools: Option<Vec<String>>,
    mcp_servers: Option<Vec<String>>,
    skills: Option<Vec<String>>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationModeInput {
    name: String,
    original_name: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationModeState {
    modes: Vec<String>,
    selected_mode: String,
}

fn default_orchestration_agents() -> Vec<AgentPayload> {
    vec![
        AgentPayload {
            name: "오케스트레이터".to_string(),
            icon: "account_tree".to_string(),
            color: "indigo".to_string(),
            active: true,
            role: "main".to_string(),
            model: Some("gpt-5.4".to_string()),
            prompt: Some("전체 작업을 조율하고 필요한 에이전트에게 역할을 분배해.".to_string()),
            tools: Some(vec!["웹 브라우저".to_string(), "파일 시스템".to_string()]),
            mcp_servers: Some(vec!["linear".to_string()]),
            skills: Some(vec!["task-routing".to_string()]),
        },
        AgentPayload {
            name: "프론트엔드 개발자".to_string(),
            icon: "travel_explore".to_string(),
            color: "emerald".to_string(),
            active: true,
            role: "sub".to_string(),
            model: Some("gpt-5.4".to_string()),
            prompt: Some("프론트엔드 UI와 상호작용을 구현하고 시각 완성도를 높여.".to_string()),
            tools: Some(vec!["웹 브라우저".to_string(), "파일 시스템".to_string()]),
            mcp_servers: Some(vec!["figma".to_string()]),
            skills: Some(vec!["design-review".to_string()]),
        },
        AgentPayload {
            name: "백엔드 개발자".to_string(),
            icon: "code".to_string(),
            color: "amber".to_string(),
            active: true,
            role: "sub".to_string(),
            model: Some("gpt-5.4-mini".to_string()),
            prompt: Some("서버 로직, API, 데이터 흐름을 설계하고 구현해.".to_string()),
            tools: Some(vec!["파일 시스템".to_string()]),
            mcp_servers: Some(vec!["postgres".to_string()]),
            skills: Some(vec!["api-design".to_string()]),
        },
    ]
}

fn default_mode_agents() -> Vec<AgentPayload> {
    vec![AgentPayload {
        name: "오케스트레이터".to_string(),
        icon: "account_tree".to_string(),
        color: "indigo".to_string(),
        active: true,
        role: "main".to_string(),
        model: Some("gpt-5.4".to_string()),
        prompt: Some("전체 작업을 조율하고 필요한 에이전트에게 역할을 분배해.".to_string()),
        tools: Some(vec!["웹 브라우저".to_string(), "파일 시스템".to_string()]),
        mcp_servers: Some(vec!["linear".to_string()]),
        skills: Some(vec!["task-routing".to_string()]),
    }]
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_optional_list(value: Option<Vec<String>>) -> Option<Vec<String>> {
    let normalized: Vec<String> = value
        .unwrap_or_default()
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();

    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn serialize_json(value: &Option<Vec<String>>) -> Result<Option<String>, String> {
    value
        .as_ref()
        .map(|items| serde_json::to_string(items).map_err(|error| error.to_string()))
        .transpose()
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

fn seed_agents_for_mode(
    connection: &rusqlite::Connection,
    mode_id: i64,
    mode_name: &str,
) -> Result<(), String> {
    let default_agents = if mode_name == DEFAULT_OPERATION_MODES[0] {
        default_orchestration_agents()
    } else {
        default_mode_agents()
    };

    for (index, agent) in default_agents.iter().enumerate() {
        let tools = serialize_json(&agent.tools)?;
        let mcp_servers = serialize_json(&agent.mcp_servers)?;
        let skills = serialize_json(&agent.skills)?;

        connection
            .execute(
                "
                INSERT INTO operation_mode_agents (
                    mode_id,
                    agent_name,
                    icon,
                    color,
                    is_active,
                    model,
                    prompt,
                    tools,
                    mcp_servers,
                    skills,
                    agent_role,
                    display_order
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                ",
                params![
                    mode_id,
                    agent.name,
                    agent.icon,
                    agent.color,
                    if agent.active { 1_i64 } else { 0_i64 },
                    agent.model,
                    agent.prompt,
                    tools,
                    mcp_servers,
                    skills,
                    agent.role,
                    index as i64
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn resolve_mode_id(connection: &rusqlite::Connection, mode_name: &str) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT id FROM operation_modes WHERE mode_name = ?1",
            params![mode_name],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

fn ensure_default_operation_mode(
    connection: &rusqlite::Connection,
) -> Result<OperationModeState, String> {
    let default_mode = DEFAULT_OPERATION_MODES[0].to_string();

    connection
        .execute(
            SQL_INSERT_OPERATION_MODE,
            params![&default_mode, 0_i64, 1_i64],
        )
        .map_err(|error| error.to_string())?;

    let mode_id = resolve_mode_id(connection, &default_mode)?;
    let agent_count: i64 = connection
        .query_row(
            "SELECT COUNT(1) FROM operation_mode_agents WHERE mode_id = ?1",
            params![mode_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    if agent_count == 0 {
        seed_agents_for_mode(connection, mode_id, &default_mode)?;
    }

    Ok(OperationModeState {
        modes: vec![default_mode.clone()],
        selected_mode: default_mode,
    })
}

#[tauri::command]
pub fn load_operation_mode(state: State<AppState>) -> Result<OperationModeState, String> {
    let connection = state.open_connection()?;
    let mut statement = connection
        .prepare(SQL_SELECT_OPERATION_MODES)
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            let mode_name: String = row.get(0)?;
            let is_selected: i64 = row.get(1)?;
            Ok((mode_name, is_selected))
        })
        .map_err(|error| error.to_string())?;

    let mut modes = Vec::new();
    let mut selected_mode: Option<String> = None;

    for row in rows {
        let (mode_name, is_selected) = row.map_err(|error| error.to_string())?;
        if is_selected == 1 {
            selected_mode = Some(mode_name.clone());
        }
        modes.push(mode_name);
    }

    if modes.is_empty() {
        return ensure_default_operation_mode(&connection);
    }

    let resolved_selected_mode = selected_mode.unwrap_or_else(|| modes[0].clone());
    let mode_id = resolve_mode_id(&connection, &resolved_selected_mode)?;
    let agent_count: i64 = connection
        .query_row(
            "SELECT COUNT(1) FROM operation_mode_agents WHERE mode_id = ?1",
            params![mode_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    if agent_count == 0 {
        seed_agents_for_mode(&connection, mode_id, &resolved_selected_mode)?;
    }

    Ok(OperationModeState {
        modes,
        selected_mode: resolved_selected_mode,
    })
}

#[tauri::command]
pub fn save_operation_mode(
    state: State<AppState>,
    modes: Vec<OperationModeInput>,
    selected_mode: String,
) -> Result<(), String> {
    let mut normalized_modes = Vec::<OperationModeInput>::new();
    let mut seen_names = HashSet::<String>::new();

    for mode in modes {
        let trimmed = mode.name.trim();
        if trimmed.is_empty() {
            continue;
        }

        let normalized_name = trimmed.to_lowercase();
        if seen_names.contains(&normalized_name) {
            continue;
        }

        seen_names.insert(normalized_name);
        normalized_modes.push(OperationModeInput {
            name: trimmed.to_string(),
            original_name: normalize_optional_text(mode.original_name),
        });
    }

    if normalized_modes.is_empty() {
        return Err("저장할 operation mode가 비어있습니다.".to_string());
    }

    let selected_mode = selected_mode.trim().to_string();
    if selected_mode.is_empty() {
        return Err("선택된 operation mode가 비어있습니다.".to_string());
    }

    if !normalized_modes
        .iter()
        .any(|mode| mode.name == selected_mode)
    {
        return Err("선택된 operation mode가 목록에 없습니다.".to_string());
    }

    let mut connection = state.open_connection()?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;

    let mut existing_statement = transaction
        .prepare("SELECT id, mode_name FROM operation_modes ORDER BY id ASC")
        .map_err(|error| error.to_string())?;
    let existing_rows = existing_statement
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;

    let mut existing_modes = Vec::<(i64, String)>::new();
    for row in existing_rows {
        existing_modes.push(row.map_err(|error| error.to_string())?);
    }
    drop(existing_statement);

    let mut kept_mode_ids = Vec::<i64>::new();

    for (index, mode) in normalized_modes.iter().enumerate() {
        let existing_match = mode.original_name.as_ref().and_then(|original_name| {
            existing_modes
                .iter()
                .find(|(_, saved_name)| saved_name == original_name)
                .map(|(id, _)| *id)
        });

        if let Some(mode_id) = existing_match {
            let original_name = mode.original_name.as_deref().unwrap_or(&mode.name);

            transaction
                .execute(
                    "
                    UPDATE operation_modes
                    SET mode_name = ?1,
                        display_order = ?2,
                        is_selected = ?3
                    WHERE id = ?4
                    ",
                    params![
                        mode.name,
                        index as i64,
                        if mode.name == selected_mode {
                            1_i64
                        } else {
                            0_i64
                        },
                        mode_id
                    ],
                )
                .map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "UPDATE chat_sessions SET mode_name = ?1 WHERE mode_name = ?2",
                    params![mode.name, original_name],
                )
                .map_err(|error| error.to_string())?;
            kept_mode_ids.push(mode_id);
            continue;
        }

        transaction
            .execute(
                SQL_INSERT_OPERATION_MODE,
                params![
                    mode.name,
                    index as i64,
                    if mode.name == selected_mode {
                        1_i64
                    } else {
                        0_i64
                    }
                ],
            )
            .map_err(|error| error.to_string())?;

        let mode_id = transaction.last_insert_rowid();
        seed_agents_for_mode(&transaction, mode_id, &mode.name)?;
        kept_mode_ids.push(mode_id);
    }

    for (mode_id, saved_name) in existing_modes {
        if kept_mode_ids.contains(&mode_id) {
            continue;
        }

        transaction
            .execute(
                "DELETE FROM operation_modes WHERE id = ?1",
                params![mode_id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM chat_sessions WHERE mode_name = ?1",
                params![saved_name],
            )
            .map_err(|error| error.to_string())?;
    }

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn select_operation_mode(state: State<AppState>, selected_mode: String) -> Result<(), String> {
    let selected_mode = selected_mode.trim().to_string();
    if selected_mode.is_empty() {
        return Err("선택된 operation mode가 비어있습니다.".to_string());
    }

    let mut connection = state.open_connection()?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;

    let affected_rows = transaction
        .execute(SQL_UPDATE_SELECTED_OPERATION_MODE, params![selected_mode])
        .map_err(|error| error.to_string())?;

    if affected_rows == 0 {
        return Err("선택할 operation mode를 찾을 수 없습니다.".to_string());
    }

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_operation_mode(state: State<AppState>, mode_name: String) -> Result<(), String> {
    let mode_name = mode_name.trim().to_string();
    if mode_name.is_empty() {
        return Err("삭제할 operation mode가 비어있습니다.".to_string());
    }

    let mut connection = state.open_connection()?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;

    let deleted_mode_is_selected: Option<i64> = transaction
        .query_row(
            "SELECT is_selected FROM operation_modes WHERE mode_name = ?1",
            params![&mode_name],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    let Some(is_selected) = deleted_mode_is_selected else {
        return Err("삭제할 operation mode를 찾을 수 없습니다.".to_string());
    };

    let mode_count: i64 = transaction
        .query_row("SELECT COUNT(1) FROM operation_modes", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;

    if mode_count <= 1 {
        return Err("마지막 operation mode는 삭제할 수 없습니다.".to_string());
    }

    transaction
        .execute(SQL_DELETE_OPERATION_MODE, params![&mode_name])
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM chat_sessions WHERE mode_name = ?1",
            params![&mode_name],
        )
        .map_err(|error| error.to_string())?;

    if is_selected == 1 {
        let fallback_mode: String = transaction
            .query_row(SQL_SELECT_FIRST_OPERATION_MODE, [], |row| row.get(0))
            .map_err(|error| error.to_string())?;

        transaction
            .execute(SQL_UPDATE_SELECTED_OPERATION_MODE, params![fallback_mode])
            .map_err(|error| error.to_string())?;
    }

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_mode_agents(
    state: State<AppState>,
    mode_name: String,
) -> Result<Vec<AgentPayload>, String> {
    let connection = state.open_connection()?;
    let mode_id = resolve_mode_id(&connection, mode_name.trim())?;

    let mut statement = connection
        .prepare(
            "
            SELECT
                agent_name,
                icon,
                color,
                is_active,
                model,
                prompt,
                tools,
                mcp_servers,
                skills,
                agent_role
            FROM operation_mode_agents
            WHERE mode_id = ?1
            ORDER BY display_order ASC, id ASC
            ",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map(params![mode_id], |row| {
            let active: i64 = row.get(3)?;
            Ok(AgentPayload {
                name: row.get(0)?,
                icon: row.get(1)?,
                color: row.get(2)?,
                active: active == 1,
                model: row.get(4)?,
                prompt: row.get(5)?,
                tools: deserialize_json(row.get(6)?)?,
                mcp_servers: deserialize_json(row.get(7)?)?,
                skills: deserialize_json(row.get(8)?)?,
                role: row
                    .get::<_, Option<String>>(9)?
                    .unwrap_or_else(|| "sub".to_string()),
            })
        })
        .map_err(|error| error.to_string())?;

    let mut agents = Vec::new();
    for row in rows {
        agents.push(row.map_err(|error| error.to_string())?);
    }

    Ok(agents)
}

#[tauri::command]
pub fn save_mode_agents(
    state: State<AppState>,
    mode_name: String,
    agents: Vec<AgentPayload>,
) -> Result<(), String> {
    let mode_name = mode_name.trim().to_string();
    if mode_name.is_empty() {
        return Err("저장할 operation mode가 비어있습니다.".to_string());
    }

    let mut normalized_agents = Vec::<AgentPayload>::new();
    let mut seen_names = HashSet::<String>::new();
    for agent in agents {
        let trimmed_name = agent.name.trim();
        if trimmed_name.is_empty() {
            continue;
        }

        let normalized_name = trimmed_name.to_lowercase();
        if seen_names.contains(&normalized_name) {
            continue;
        }

        seen_names.insert(normalized_name);
        normalized_agents.push(AgentPayload {
            name: trimmed_name.to_string(),
            icon: agent.icon.trim().to_string(),
            color: agent.color.trim().to_string(),
            active: agent.active,
            role: if agent.role == "main" {
                "main".to_string()
            } else {
                "sub".to_string()
            },
            model: normalize_optional_text(agent.model),
            prompt: normalize_optional_text(agent.prompt),
            tools: normalize_optional_list(agent.tools),
            mcp_servers: normalize_optional_list(agent.mcp_servers),
            skills: normalize_optional_list(agent.skills),
        });
    }

    // role 정규화: main이 없으면 첫 번째를 main으로, 두 개 이상이면 첫 번째만 유지
    let has_main = normalized_agents.iter().any(|a| a.role == "main");
    if !has_main {
        if let Some(first) = normalized_agents.first_mut() {
            first.role = "main".to_string();
        }
    } else {
        let mut found_main = false;
        for agent in normalized_agents.iter_mut() {
            if agent.role == "main" {
                if found_main {
                    agent.role = "sub".to_string();
                } else {
                    found_main = true;
                }
            }
        }
    }

    let mut connection = state.open_connection()?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let mode_id = resolve_mode_id(&transaction, &mode_name)?;

    transaction
        .execute(
            "DELETE FROM operation_mode_agents WHERE mode_id = ?1",
            params![mode_id],
        )
        .map_err(|error| error.to_string())?;

    for (index, agent) in normalized_agents.iter().enumerate() {
        let tools = serialize_json(&agent.tools)?;
        let mcp_servers = serialize_json(&agent.mcp_servers)?;
        let skills = serialize_json(&agent.skills)?;

        transaction
            .execute(
                "
                INSERT INTO operation_mode_agents (
                    mode_id,
                    agent_name,
                    icon,
                    color,
                    is_active,
                    model,
                    prompt,
                    tools,
                    mcp_servers,
                    skills,
                    agent_role,
                    display_order
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                ",
                params![
                    mode_id,
                    agent.name,
                    agent.icon,
                    agent.color,
                    if agent.active { 1_i64 } else { 0_i64 },
                    agent.model,
                    agent.prompt,
                    tools,
                    mcp_servers,
                    skills,
                    agent.role,
                    index as i64
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}
