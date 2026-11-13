use crate::app_state::AppState;
use rand::{distributions::Alphanumeric, Rng};
use rfd::FileDialog;
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
    #[serde(default)]
    agent_id: Option<String>,
    #[serde(default)]
    character_id: Option<String>,
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
    project_paths: Option<Vec<String>>,
    default_model: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationModeItem {
    name: String,
    project_paths: Vec<String>,
    default_model: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationModeState {
    modes: Vec<String>,
    selected_mode: String,
    items: Vec<OperationModeItem>,
}

// 모든 모드는 다른 에이전트 없이도 작업할 수 있는 기본 에이전트 한 명으로 시작합니다.
fn default_mode_agents() -> Vec<AgentPayload> {
    vec![AgentPayload {
        agent_id: None,
        character_id: None,
        name: "젬".to_string(),
        icon: "account_tree".to_string(),
        color: "indigo".to_string(),
        active: true,
        role: "main".to_string(),
        model: Some("gpt-5.4".to_string()),
        prompt: Some("사용자의 요청을 이해하고 조사, 계획, 구현 등 필요한 작업을 직접 수행해. 다른 에이전트가 있으면 필요에 따라 협업해.".to_string()),
        tools: Some(vec!["웹 브라우저".to_string(), "파일 시스템".to_string()]),
        mcp_servers: Some(vec![]),
        skills: Some(vec![]),
    }]
}

fn default_mode_model() -> String {
    "gpt-5.4".to_string()
}

fn generate_agent_id() -> String {
    let suffix: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(24)
        .map(char::from)
        .collect();
    format!("agent-{suffix}")
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
        .map(|item| item.trim().trim_end_matches(['\\', '/']).to_string())
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

fn seed_agents_for_mode(connection: &rusqlite::Connection, mode_id: i64) -> Result<(), String> {
    let default_agents = default_mode_agents();

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
                    display_order,
                    agent_id
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
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
                    index as i64,
                    generate_agent_id()
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
            params![
                &default_mode,
                0_i64,
                1_i64,
                Option::<String>::None,
                Some(default_mode_model())
            ],
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
        seed_agents_for_mode(connection, mode_id)?;
    }

    Ok(OperationModeState {
        modes: vec![default_mode.clone()],
        selected_mode: default_mode.clone(),
        items: vec![OperationModeItem {
            name: default_mode,
            project_paths: Vec::new(),
            default_model: Some(default_mode_model()),
        }],
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
            let project_paths = deserialize_json(row.get(2)?)?.unwrap_or_default();
            let default_model = normalize_optional_text(row.get(3)?);
            Ok((mode_name, is_selected, project_paths, default_model))
        })
        .map_err(|error| error.to_string())?;

    let mut modes = Vec::new();
    let mut items = Vec::new();
    let mut selected_mode: Option<String> = None;

    for row in rows {
        let (mode_name, is_selected, project_paths, default_model) =
            row.map_err(|error| error.to_string())?;
        if is_selected == 1 {
            selected_mode = Some(mode_name.clone());
        }

        items.push(OperationModeItem {
            name: mode_name.clone(),
            project_paths,
            default_model,
        });
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
        seed_agents_for_mode(&connection, mode_id)?;
    }

    Ok(OperationModeState {
        modes,
        selected_mode: resolved_selected_mode,
        items,
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
            project_paths: normalize_optional_list(mode.project_paths),
            default_model: normalize_optional_text(mode.default_model),
        });
    }

    if normalized_modes.is_empty() {
        return Err("저장할 operation mode가 비어 있습니다.".to_string());
    }

    let selected_mode = selected_mode.trim().to_string();
    if selected_mode.is_empty() {
        return Err("선택된 operation mode가 비어 있습니다.".to_string());
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

        let serialized_project_paths = serialize_json(&mode.project_paths)?;
        let default_model = mode
            .default_model
            .clone()
            .unwrap_or_else(default_mode_model);

        if let Some(mode_id) = existing_match {
            let original_name = mode.original_name.as_deref().unwrap_or(&mode.name);

            transaction
                .execute(
                    "
                    UPDATE operation_modes
                    SET mode_name = ?1,
                        display_order = ?2,
                        is_selected = ?3,
                        project_paths = ?4,
                        default_model = ?5
                    WHERE id = ?6
                    ",
                    params![
                        mode.name,
                        index as i64,
                        if mode.name == selected_mode {
                            1_i64
                        } else {
                            0_i64
                        },
                        serialized_project_paths,
                        default_model,
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
                    },
                    serialized_project_paths,
                    default_model
                ],
            )
            .map_err(|error| error.to_string())?;

        let mode_id = transaction.last_insert_rowid();
        seed_agents_for_mode(&transaction, mode_id)?;
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
        return Err("선택된 operation mode가 비어 있습니다.".to_string());
    }

    let mut connection = state.open_connection()?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;

    let affected_rows = transaction
        .execute(SQL_UPDATE_SELECTED_OPERATION_MODE, params![selected_mode])
        .map_err(|error| error.to_string())?;

    if affected_rows == 0 {
        return Err("선택된 operation mode를 찾을 수 없습니다.".to_string());
    }

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_operation_mode(state: State<AppState>, mode_name: String) -> Result<(), String> {
    let mode_name = mode_name.trim().to_string();
    if mode_name.is_empty() {
        return Err("삭제할 operation mode가 비어 있습니다.".to_string());
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
pub fn pick_project_folder() -> Result<Option<String>, String> {
    let selected = FileDialog::new()
        .set_title("프로젝트 폴더 선택")
        .pick_folder();

    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn load_mode_agents(
    state: State<AppState>,
    mode_name: String,
) -> Result<Vec<AgentPayload>, String> {
    let connection = state.open_connection()?;
    load_mode_agents_from_connection(&connection, &mode_name)
}

fn load_mode_agents_from_connection(
    connection: &rusqlite::Connection,
    mode_name: &str,
) -> Result<Vec<AgentPayload>, String> {
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
                agent_role,
                agent_id,
                character_id
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
                agent_id: row.get(10)?,
                character_id: row.get(11)?,
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
    let mut connection = state.open_connection()?;
    save_mode_agents_in_connection(&mut connection, &mode_name, agents)
}

fn save_mode_agents_in_connection(
    connection: &mut rusqlite::Connection,
    mode_name: &str,
    agents: Vec<AgentPayload>,
) -> Result<(), String> {
    let mode_name = mode_name.trim().to_string();
    if mode_name.is_empty() {
        return Err("저장할 operation mode가 비어 있습니다.".to_string());
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
            agent_id: Some(
                normalize_optional_text(agent.agent_id).unwrap_or_else(generate_agent_id),
            ),
            character_id: normalize_optional_text(agent.character_id),
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

    let has_main = normalized_agents.iter().any(|agent| agent.role == "main");
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

    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let mode_id = resolve_mode_id(&transaction, &mode_name)?;

    // 삭제된 캐릭터를 이전 화면 상태로 다시 연결하지 않습니다.
    for agent in &mut normalized_agents {
        if let Some(id) = &agent.character_id {
            let exists: bool = transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM characters WHERE id = ?1)",
                    [id],
                    |row| row.get(0),
                )
                .map_err(|error| error.to_string())?;
            if !exists {
                agent.character_id = None;
            }
        }
    }

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
                    display_order,
                    agent_id,
                    character_id
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
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
                    index as i64,
                    agent.agent_id,
                    agent.character_id
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    // 설정 저장은 에이전트 행을 재생성하므로 재삽입 후 실제로 삭제된 에이전트의 개인 자료만 지웁니다.
    transaction
        .execute(
            "DELETE FROM agent_routines WHERE mode_id = ?1 AND NOT EXISTS (SELECT 1 FROM operation_mode_agents a WHERE a.mode_id = agent_routines.mode_id AND a.agent_id = agent_routines.agent_id)",
            params![mode_id],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM agent_memories WHERE mode_id = ?1 AND NOT EXISTS (SELECT 1 FROM operation_mode_agents a WHERE a.mode_id = agent_memories.mode_id AND a.agent_id = agent_memories.agent_id)",
            params![mode_id],
        )
        .map_err(|error| error.to_string())?;

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod agent_identity_tests {
    use super::*;
    use crate::migrations::run_migrations;

    // 여러 에이전트가 필요한 테스트는 설치 기본값에 의존하지 않고 직접 추가합니다.
    fn add_second_agent(connection: &mut rusqlite::Connection) -> Vec<AgentPayload> {
        let mut agents = load_mode_agents_from_connection(connection, "Orchestration").unwrap();
        let mut second_agent = agents[0].clone();
        second_agent.agent_id = None;
        second_agent.name = "추가 에이전트".to_string();
        second_agent.role = "sub".to_string();
        second_agent.character_id = Some("hachiware".to_string());
        agents.push(second_agent);
        save_mode_agents_in_connection(connection, "Orchestration", agents).unwrap();
        load_mode_agents_from_connection(connection, "Orchestration").unwrap()
    }

    #[test]
    fn fresh_install_starts_with_one_main_agent() {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut connection).unwrap();
        let agents = load_mode_agents_from_connection(&connection, "Orchestration").unwrap();
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].name, "젬");
        assert_eq!(agents[0].role, "main");
        assert!(agents[0].active);
        assert!(agents[0].agent_id.as_ref().is_some_and(|id| !id.is_empty()));

        // 초기 SQL 시드와 실행 중 초기화가 동일한 기본 설정을 사용해야 합니다.
        let mut seeded = serde_json::to_value(&agents[0]).unwrap();
        seeded["agentId"] = serde_json::Value::Null;
        seeded["characterId"] = serde_json::Value::Null;
        assert_eq!(
            seeded,
            serde_json::to_value(&default_mode_agents()[0]).unwrap()
        );
    }

    #[test]
    fn empty_workspace_starts_with_one_main_agent() {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys = ON")
            .unwrap();
        run_migrations(&mut connection).unwrap();
        connection
            .execute("DELETE FROM operation_modes", [])
            .unwrap();

        ensure_default_operation_mode(&connection).unwrap();
        let agents = load_mode_agents_from_connection(&connection, "Orchestration").unwrap();
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].name, "젬");
        assert_eq!(agents[0].role, "main");
        assert!(agents[0].active);
        assert!(agents[0].agent_id.as_ref().is_some_and(|id| !id.is_empty()));
    }

    #[test]
    fn agent_ids_survive_rename_save_and_new_agent_creation() {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut connection).unwrap();
        let mut agents = load_mode_agents_from_connection(&connection, "Orchestration").unwrap();
        let original_id = agents[0].agent_id.clone().unwrap();
        agents[0].name = "새 이름".to_string();
        let mut new_agent = agents[0].clone();
        new_agent.name = "새 에이전트".to_string();
        new_agent.agent_id = None;
        agents.push(new_agent);

        save_mode_agents_in_connection(&mut connection, "Orchestration", agents).unwrap();
        let saved = load_mode_agents_from_connection(&connection, "Orchestration").unwrap();
        assert_eq!(saved[0].agent_id.as_deref(), Some(original_id.as_str()));
        assert_eq!(saved[0].name, "새 이름");
        let new_id = saved.last().unwrap().agent_id.as_ref().unwrap();
        assert_ne!(new_id, &original_id);
        let stable_ids: Vec<_> = saved.iter().map(|agent| agent.agent_id.clone()).collect();

        save_mode_agents_in_connection(&mut connection, "Orchestration", saved).unwrap();
        run_migrations(&mut connection).unwrap();
        let reloaded = load_mode_agents_from_connection(&connection, "Orchestration").unwrap();
        assert_eq!(reloaded.len(), 2);
        assert_eq!(reloaded[0].name, "새 이름");
        assert_eq!(reloaded[1].name, "새 에이전트");
        assert_eq!(
            stable_ids,
            reloaded
                .iter()
                .map(|agent| agent.agent_id.clone())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn newly_seeded_mode_has_one_main_agent_with_id() {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut connection).unwrap();
        connection
            .execute(
                "INSERT INTO operation_modes (mode_name, display_order) VALUES ('New mode', 1)",
                [],
            )
            .unwrap();
        let mode_id = connection.last_insert_rowid();
        seed_agents_for_mode(&connection, mode_id).unwrap();
        let agents = load_mode_agents_from_connection(&connection, "New mode").unwrap();
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].name, "젬");
        assert_eq!(agents[0].role, "main");
        assert!(agents[0].active);
        assert!(agents[0].agent_id.as_ref().is_some_and(|id| !id.is_empty()));
    }

    #[test]
    fn stale_deleted_character_is_cleared_when_agents_are_saved() {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut connection).unwrap();
        let agents = add_second_agent(&mut connection);
        assert_eq!(agents[0].character_id.as_deref(), Some("chiikawa"));
        connection
            .execute("DELETE FROM characters WHERE id = 'chiikawa'", [])
            .unwrap();
        save_mode_agents_in_connection(&mut connection, "Orchestration", agents).unwrap();
        let reloaded = load_mode_agents_from_connection(&connection, "Orchestration").unwrap();
        assert!(reloaded[0].character_id.is_none());
        assert_eq!(reloaded[1].character_id.as_deref(), Some("hachiware"));
    }

    #[test]
    fn removing_agent_cleans_only_its_memories_routines_and_reports() {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        connection
            .execute_batch("PRAGMA foreign_keys = ON")
            .unwrap();
        run_migrations(&mut connection).unwrap();
        let mut agents = add_second_agent(&mut connection);
        let mode_id = resolve_mode_id(&connection, "Orchestration").unwrap();
        let kept_id = agents[0].agent_id.clone().unwrap();
        let removed_id = agents[1].agent_id.clone().unwrap();
        for (index, agent_id) in [&kept_id, &removed_id].into_iter().enumerate() {
            let routine_id = format!("routine-{index}");
            connection.execute("INSERT INTO agent_memories (mode_id, agent_id, content, updated_at) VALUES (?1, ?2, '기억', 1)", params![mode_id, agent_id]).unwrap();
            connection.execute("INSERT INTO agent_routines (id, mode_id, agent_id, instruction, interval_minutes, checkpoint, next_run_at) VALUES (?1, ?2, ?3, '이메일 요약', 60, 1, 1)", params![routine_id, mode_id, agent_id]).unwrap();
            connection.execute("INSERT INTO agent_reports (id, routine_id, content, status, created_at) VALUES (?1, ?2, '보고', 'success', 1)", params![format!("report-{index}"), routine_id]).unwrap();
            connection.execute("INSERT INTO agent_routine_seen_messages (routine_id, mailbox_email, message_id, checked_until) VALUES (?1, 'owner@example.com', 'message', 1)", [&routine_id]).unwrap();
        }
        agents.remove(1);
        save_mode_agents_in_connection(&mut connection, "Orchestration", agents).unwrap();
        let kept_memory: String = connection
            .query_row("SELECT agent_id FROM agent_memories", [], |row| row.get(0))
            .unwrap();
        assert_eq!(kept_memory, kept_id);
        let kept_routine: String = connection
            .query_row("SELECT agent_id FROM agent_routines", [], |row| row.get(0))
            .unwrap();
        assert_eq!(kept_routine, kept_id);
        for table in [
            "agent_memories",
            "agent_routines",
            "agent_reports",
            "agent_routine_seen_messages",
        ] {
            assert_eq!(
                connection
                    .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row
                        .get::<_, i64>(0))
                    .unwrap(),
                1
            );
        }
    }
}
