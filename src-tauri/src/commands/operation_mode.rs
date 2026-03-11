use crate::app_state::AppState;
use rusqlite::{params, OptionalExtension};
use tauri::State;

const SQL_SELECT_OPERATION_MODES: &str =
    include_str!("../../sql/queries/operation_mode/select_all.sql");
const SQL_INSERT_OPERATION_MODE: &str = include_str!("../../sql/queries/operation_mode/insert.sql");
const SQL_DELETE_OPERATION_MODES: &str =
    include_str!("../../sql/queries/operation_mode/delete_all.sql");
const SQL_UPDATE_SELECTED_OPERATION_MODE: &str =
    include_str!("../../sql/queries/operation_mode/update_selected.sql");
const SQL_DELETE_OPERATION_MODE: &str =
    include_str!("../../sql/queries/operation_mode/delete_by_name.sql");
const SQL_SELECT_FIRST_OPERATION_MODE: &str =
    include_str!("../../sql/queries/operation_mode/select_first.sql");

const DEFAULT_OPERATION_MODES: [&str; 1] = ["Orchestrator"];

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationModeState {
    modes: Vec<String>,
    selected_mode: String,
}

fn ensure_default_operation_mode(
    connection: &rusqlite::Connection,
) -> Result<OperationModeState, String> {
    let default_mode = DEFAULT_OPERATION_MODES[0].to_string();

    connection
        .execute(SQL_DELETE_OPERATION_MODES, [])
        .map_err(|error| error.to_string())?;

    connection
        .execute(
            SQL_INSERT_OPERATION_MODE,
            params![&default_mode, 0_i64, 1_i64],
        )
        .map_err(|error| error.to_string())?;

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

    Ok(OperationModeState {
        modes,
        selected_mode: resolved_selected_mode,
    })
}

#[tauri::command]
pub fn save_operation_mode(
    state: State<AppState>,
    modes: Vec<String>,
    selected_mode: String,
) -> Result<(), String> {
    let mut normalized_modes = Vec::<String>::new();
    for mode in modes {
        let trimmed = mode.trim();
        if trimmed.is_empty() {
            continue;
        }

        if normalized_modes
            .iter()
            .any(|saved_mode| saved_mode == trimmed)
        {
            continue;
        }

        normalized_modes.push(trimmed.to_string());
    }

    if normalized_modes.is_empty() {
        return Err("저장할 operation mode가 비어있습니다.".to_string());
    }

    let selected_mode = selected_mode.trim().to_string();
    if selected_mode.is_empty() {
        return Err("선택된 operation mode가 비어있습니다.".to_string());
    }

    if !normalized_modes.iter().any(|mode| mode == &selected_mode) {
        return Err("선택된 operation mode가 목록에 없습니다.".to_string());
    }

    let mut connection = state.open_connection()?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;

    transaction
        .execute(SQL_DELETE_OPERATION_MODES, [])
        .map_err(|error| error.to_string())?;

    for (index, mode) in normalized_modes.iter().enumerate() {
        let is_selected = if mode == &selected_mode { 1 } else { 0 };

        transaction
            .execute(
                SQL_INSERT_OPERATION_MODE,
                params![mode, index as i64, is_selected],
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
