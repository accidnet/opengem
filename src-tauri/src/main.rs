#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_state;
mod commands;

use app_state::AppState;
use rusqlite::Connection;
use std::path::PathBuf;
use tauri::Manager;

const MIGRATIONS: [(&str, &str); 1] =
    [("001_init", include_str!("../sql/migrations/001_init.sql"))];

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
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;

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

fn main() {
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
            commands::operation_mode::delete_operation_mode
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
