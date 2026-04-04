#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_state;
mod commands;
mod migrations;
mod repositories;

use app_state::AppState;
use dotenvy::from_path_override;
use rusqlite::{Connection, OptionalExtension, params};
use migrations::run_migrations;
use std::{
    env,
    path::{Path, PathBuf},
    sync::OnceLock,
};
use tauri::{
    Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewWindow, Window, WindowEvent,
};
use tracing::{error, info, warn};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::fmt::writer::MakeWriterExt;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

static LOG_GUARD: OnceLock<WorkerGuard> = OnceLock::new();

const MAIN_WINDOW_LABEL: &str = "main";
const INITIAL_WIDTH_RATIO: f64 = 0.9;
const INITIAL_HEIGHT_RATIO: f64 = 0.9;
const MIN_WINDOW_WIDTH: u32 = 960;
const MIN_WINDOW_HEIGHT: u32 = 720;

#[derive(Clone, Debug)]
struct StoredWindowState {
    x: Option<i32>,
    y: Option<i32>,
    width: u32,
    height: u32,
    is_maximized: bool,
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

fn resolve_log_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(project_root_dir()?.join("logs"));
    }

    Ok(resolve_sqlite_dir(app)?.join("logs"))
}

fn init_logging(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let log_dir = resolve_log_dir(app)?;
    std::fs::create_dir_all(&log_dir).map_err(|error| error.to_string())?;

    let file_appender = tracing_appender::rolling::never(&log_dir, "opengem.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    let _ = LOG_GUARD.set(guard);

    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,opengem=debug"));

    let file_layer = tracing_subscriber::fmt::layer()
        .with_ansi(false)
        .with_writer(non_blocking);
    let console_layer = tracing_subscriber::fmt::layer()
        .with_ansi(true)
        .with_writer(std::io::stdout.with_max_level(tracing::Level::TRACE));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(file_layer)
        .with(console_layer)
        .try_init()
        .map_err(|error| error.to_string())?;

    Ok(log_dir.join("opengem.log"))
}

fn load_window_state(connection: &Connection) -> Result<Option<StoredWindowState>, String> {
    connection
        .query_row(
            "SELECT x, y, width, height, is_maximized FROM app_window_state WHERE id = 1",
            [],
            |row| {
                Ok(StoredWindowState {
                    x: row.get(0)?,
                    y: row.get(1)?,
                    width: row.get(2)?,
                    height: row.get(3)?,
                    is_maximized: row.get::<_, i64>(4)? != 0,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn save_window_state(connection: &Connection, state: &StoredWindowState) -> Result<(), String> {
    connection
        .execute(
            "
            INSERT INTO app_window_state (id, x, y, width, height, is_maximized, updated_at)
            VALUES (1, ?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
              x = excluded.x,
              y = excluded.y,
              width = excluded.width,
              height = excluded.height,
              is_maximized = excluded.is_maximized,
              updated_at = CURRENT_TIMESTAMP
            ",
            params![
                state.x,
                state.y,
                state.width,
                state.height,
                if state.is_maximized { 1 } else { 0 },
            ],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn build_initial_window_state(window: &WebviewWindow) -> Result<StoredWindowState, String> {
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        return Ok(StoredWindowState {
            x: None,
            y: None,
            width: 1280,
            height: 900,
            is_maximized: false,
        });
    };

    let work_area = monitor.work_area();
    let width = (((work_area.size.width as f64) * INITIAL_WIDTH_RATIO)
        .round()
        .max(MIN_WINDOW_WIDTH as f64) as u32)
        .min(work_area.size.width);
    let height = (((work_area.size.height as f64) * INITIAL_HEIGHT_RATIO)
        .round()
        .max(MIN_WINDOW_HEIGHT as f64) as u32)
        .min(work_area.size.height);
    let x = work_area.position.x + ((work_area.size.width.saturating_sub(width)) / 2) as i32;
    let y = work_area.position.y + ((work_area.size.height.saturating_sub(height)) / 2) as i32;

    Ok(StoredWindowState {
        x: Some(x),
        y: Some(y),
        width,
        height,
        is_maximized: false,
    })
}

fn apply_window_state(window: &WebviewWindow, state: &StoredWindowState) -> Result<(), String> {
    window
        .set_min_size(Some(Size::Physical(PhysicalSize::new(
            MIN_WINDOW_WIDTH,
            MIN_WINDOW_HEIGHT,
        ))))
        .map_err(|error| error.to_string())?;

    window
        .set_size(Size::Physical(PhysicalSize::new(state.width, state.height)))
        .map_err(|error| error.to_string())?;

    if let (Some(x), Some(y)) = (state.x, state.y) {
        let has_monitor = window
            .monitor_from_point(x as f64, y as f64)
            .map_err(|error| error.to_string())?
            .is_some();

        if has_monitor {
            window
                .set_position(Position::Physical(PhysicalPosition::new(x, y)))
                .map_err(|error| error.to_string())?;
        } else {
            window.center().map_err(|error| error.to_string())?;
        }
    } else {
        window.center().map_err(|error| error.to_string())?;
    }

    if state.is_maximized {
        window.maximize().map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn restore_or_initialize_main_window(app: &tauri::App) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "메인 창을 찾지 못했습니다.".to_string())?;
    let connection = app.state::<AppState>().open_connection()?;
    let state = load_window_state(&connection)?
        .map(Ok)
        .unwrap_or_else(|| build_initial_window_state(&window))?;

    apply_window_state(&window, &state)
}

fn persist_main_window_state(window: &Window) -> Result<(), String> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Ok(());
    }

    let app_state = window.state::<AppState>();
    let connection = app_state.open_connection()?;
    let existing = load_window_state(&connection)?;
    let is_minimized = window.is_minimized().map_err(|error| error.to_string())?;

    if is_minimized {
        return Ok(());
    }

    let is_maximized = window.is_maximized().map_err(|error| error.to_string())?;
    let next_state = if is_maximized {
        existing.unwrap_or(StoredWindowState {
            x: None,
            y: None,
            width: window.inner_size().map_err(|error| error.to_string())?.width,
            height: window.inner_size().map_err(|error| error.to_string())?.height,
            is_maximized: true,
        })
    } else {
        let position = window.outer_position().map_err(|error| error.to_string())?;
        let size = window.inner_size().map_err(|error| error.to_string())?;

        StoredWindowState {
            x: Some(position.x),
            y: Some(position.y),
            width: size.width,
            height: size.height,
            is_maximized: false,
        }
    };

    save_window_state(
        &connection,
        &StoredWindowState {
            is_maximized,
            ..next_state
        },
    )
}

fn handle_main_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != MAIN_WINDOW_LABEL {
        return;
    }

    let should_save = matches!(
        event,
        WindowEvent::Moved(_)
            | WindowEvent::Resized(_)
            | WindowEvent::CloseRequested { .. }
            | WindowEvent::Destroyed
            | WindowEvent::ScaleFactorChanged { .. }
    );

    if !should_save {
        return;
    }

    if let Err(error) = persist_main_window_state(window) {
        warn!("window state save failed: {error}");
    }
}

fn main() {
    if let Err(error) = load_env_files() {
        eprintln!("환경변수 파일 로드 실패: {error}");
    }

    tauri::Builder::default()
        .on_window_event(handle_main_window_event)
        .setup(|app| {
            let app_handle = app.handle();
            if let Ok(log_path) = init_logging(&app_handle) {
                info!("logging initialized: {}", log_path.to_string_lossy());
            }
            let db_path = init_sqlite(&app_handle).map_err(|error| {
                error!("SQLite init failed: {error}");
                Box::<dyn std::error::Error>::from(error)
            })?;

            app_handle.manage(AppState {
                db_path: db_path.clone(),
            });

            restore_or_initialize_main_window(app).map_err(|error| {
                error!("window restore failed: {error}");
                Box::<dyn std::error::Error>::from(error)
            })?;

            info!("SQLite initialized: {}", db_path.to_string_lossy());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::operation_mode::load_operation_mode,
            commands::operation_mode::save_operation_mode,
            commands::operation_mode::select_operation_mode,
            commands::operation_mode::delete_operation_mode,
            commands::operation_mode::pick_project_folder,
            commands::operation_mode::load_mode_agents,
            commands::operation_mode::save_mode_agents,
            commands::session::list_chat_sessions,
            commands::session::create_chat_session,
            commands::session::get_chat_session,
            commands::session::delete_chat_session,
            commands::session::append_chat_message,
            commands::session::update_chat_session_project_paths,
            commands::session::open_folder_in_explorer,
            commands::settings::get_llm_settings,
            commands::settings::get_available_providers,
            commands::settings::save_llm_settings,
            commands::settings::resolve_llm_settings,
            commands::settings::begin_chatgpt_login,
            commands::settings::open_external_url,
            commands::settings::logout_chatgpt,
            commands::workspace::list_workspace_files,
            commands::workspace::search_workspace_text,
            commands::workspace::read_workspace_file,
            commands::workspace::list_workspace_skills,
            commands::workspace::load_workspace_skill,
            commands::workspace::list_workspace_commands,
            commands::workspace::load_workspace_command,
            commands::workspace::run_command_line
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
