#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_state;
mod commands;

use app_state::AppState;
use dotenvy::from_path_override;
use rusqlite::Connection;
use std::{
    env,
    path::{Path, PathBuf},
};
use tauri::Manager;

const MIGRATIONS: [(&str, &str); 8] = [
    ("001_init", include_str!("../sql/migrations/001_init.sql")),
    (
        "002_llm_settings",
        include_str!("../sql/migrations/002_llm_settings.sql"),
    ),
    (
        "003_operation_mode_default",
        include_str!("../sql/migrations/003_operation_mode_default.sql"),
    ),
    (
        "004_chat_session",
        include_str!("../sql/migrations/004_chat_session.sql"),
    ),
    (
        "005_operation_mode_agents",
        include_str!("../sql/migrations/005_operation_mode_agents.sql"),
    ),
    (
        "006_seed_default_mode_agents",
        include_str!("../sql/migrations/006_seed_default_mode_agents.sql"),
    ),
    (
        "007_chat_sessions_mode_name",
        include_str!("../sql/migrations/007_chat_sessions_mode_name.sql"),
    ),
    (
        "008_agent_role",
        include_str!("../sql/migrations/008_agent_role.sql"),
    ),
];

fn run_migrations(connection: &mut Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      ",
        )
        .map_err(|error| error.to_string())?;

    for (name, sql) in MIGRATIONS {
        let applied_count: i64 = connection
            .query_row(
                "SELECT COUNT(1) FROM schema_migrations WHERE name = ?1",
                [name],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;

        if applied_count > 0 {
            continue;
        }

        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;

        transaction
            .execute_batch(sql)
            .map_err(|error| error.to_string())?;

        transaction
            .execute("INSERT INTO schema_migrations (name) VALUES (?1)", [name])
            .map_err(|error| error.to_string())?;

        transaction.commit().map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn init_sqlite(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = resolve_sqlite_dir(app)?;

    std::fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;

    let db_path = app_data_dir.join("opengem.sqlite3");
    let mut connection = Connection::open(&db_path).map_err(|error| error.to_string())?;

    run_migrations(&mut connection)?;

    let ping: i64 = connection
        .query_row("SELECT 1", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;

    if ping != 1 {
        return Err("SQLite 연결 확인에 실패했습니다.".to_string());
    }

    Ok(db_path)
}

fn project_root_dir() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "프로젝트 루트 경로를 찾지 못했습니다.".to_string())
}

fn load_env_files() -> Result<(), String> {
    let project_root = project_root_dir()?;
    let common_env_path = project_root.join(".env");

    if common_env_path.exists() {
        from_path_override(&common_env_path).map_err(|error| error.to_string())?;
    }

    let profile_env_path = if cfg!(debug_assertions) {
        project_root.join(".env.development")
    } else {
        project_root.join(".env.production")
    };

    if profile_env_path.exists() {
        from_path_override(&profile_env_path).map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn resolve_sqlite_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        if let Ok(custom_dir) = env::var("OPENGEM_DB_DIR") {
            let trimmed = custom_dir.trim();
            if !trimmed.is_empty() {
                let path = PathBuf::from(trimmed);
                if path.is_absolute() {
                    return Ok(path);
                }

                return Ok(project_root_dir()?.join(path));
            }
        }

        return Ok(project_root_dir()?.join("data"));
    }

    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn main() {
    if let Err(error) = load_env_files() {
        eprintln!("환경변수 파일 로드 실패: {error}");
    }

    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle();
            let db_path = init_sqlite(&app_handle).map_err(|error| {
                eprintln!("SQLite 초기화 실패: {error}");
                Box::<dyn std::error::Error>::from(error)
            })?;

            app_handle.manage(AppState {
                db_path: db_path.clone(),
            });

            println!("SQLite 초기화 완료: {}", db_path.to_string_lossy());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::operation_mode::load_operation_mode,
            commands::operation_mode::save_operation_mode,
            commands::operation_mode::select_operation_mode,
            commands::operation_mode::delete_operation_mode,
            commands::operation_mode::load_mode_agents,
            commands::operation_mode::save_mode_agents,
            commands::session::list_chat_sessions,
            commands::session::create_chat_session,
            commands::session::get_chat_session,
            commands::session::delete_chat_session,
            commands::session::append_chat_message,
            commands::settings::get_llm_settings,
            commands::settings::save_llm_settings,
            commands::settings::resolve_llm_settings,
            commands::settings::begin_chatgpt_login,
            commands::settings::open_external_url,
            commands::settings::send_chatgpt_message,
            commands::settings::logout_chatgpt
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
