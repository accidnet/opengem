use rusqlite::Connection;

const MIGRATIONS: [(&str, &str); 14] = [
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
    (
        "009_app_window_state",
        include_str!("../sql/migrations/009_app_window_state.sql"),
    ),
    (
        "010_operation_mode_project_paths",
        include_str!("../sql/migrations/010_operation_mode_project_paths.sql"),
    ),
    (
        "011_chat_session_project_paths",
        include_str!("../sql/migrations/011_chat_session_project_paths.sql"),
    ),
    (
        "012_llm_provider_id",
        include_str!("../sql/migrations/003_llm_provider_id.sql"),
    ),
    (
        "013_operation_mode_default_model",
        include_str!("../sql/migrations/013_operation_mode_default_model.sql"),
    ),
    (
        "014_provider_credentials",
        include_str!("../sql/migrations/014_provider_credentials.sql"),
    ),
];

pub fn run_migrations(connection: &mut Connection) -> Result<(), String> {
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

        let transaction = connection.transaction().map_err(|error| error.to_string())?;

        transaction
            .execute_batch(sql)
            .map_err(|error| error.to_string())?;

        transaction
            .execute("INSERT INTO schema_migrations (name) VALUES (?1)", [name])
            .map_err(|error| error.to_string())?;

        transaction.commit().map_err(|error| error.to_string())?;
    }

    ensure_llm_settings_provider_id_column(connection)?;

    Ok(())
}

fn ensure_llm_settings_provider_id_column(connection: &Connection) -> Result<(), String> {
    let has_provider_id = connection
        .prepare("PRAGMA table_info(llm_settings)")
        .map_err(|error| error.to_string())?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?
        .into_iter()
        .any(|column_name| column_name == "provider_id");

    if has_provider_id {
        return Ok(());
    }

    connection
        .execute_batch(include_str!("../sql/migrations/003_llm_provider_id.sql"))
        .map_err(|error| error.to_string())?;

    connection
        .execute(
            "INSERT OR IGNORE INTO schema_migrations (name) VALUES (?1)",
            ["012_llm_provider_id"],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}
