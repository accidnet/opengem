use crate::repositories::settings_repository::default_base_url_for;
use rusqlite::{params, Connection, OptionalExtension};

const SETTINGS_SCHEMA: &str = include_str!("../sql/migrations/002_llm_settings.sql");
const AUTH_PREFERENCES: &str = include_str!("../sql/migrations/016_openai_auth_preferences.sql");
const REPAIR_PROVIDER_SETTINGS: &str = "022_repair_legacy_provider_settings";

const MIGRATIONS: [(&str, &str); 23] = [
    ("001_init", include_str!("../sql/migrations/001_init.sql")),
    ("002_llm_settings", SETTINGS_SCHEMA),
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
    (
        "015_provider_settings",
        include_str!("../sql/migrations/015_provider_settings.sql"),
    ),
    ("016_openai_auth_preferences", AUTH_PREFERENCES),
    (
        "017_agent_chat_identity",
        include_str!("../sql/migrations/017_agent_chat_identity.sql"),
    ),
    (
        "018_characters",
        include_str!("../sql/migrations/018_characters.sql"),
    ),
    (
        "019_agent_workspace",
        include_str!("../sql/migrations/019_agent_workspace.sql"),
    ),
    (
        "020_google_integrations",
        include_str!("../sql/migrations/020_google_integrations.sql"),
    ),
    (
        "021_app_settings",
        include_str!("../sql/migrations/021_app_settings.sql"),
    ),
    (REPAIR_PROVIDER_SETTINGS, ""),
    (
        "023_chat_message_agent",
        include_str!("../sql/migrations/023_chat_message_agent.sql"),
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

        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;

        if name == REPAIR_PROVIDER_SETTINGS {
            repair_legacy_provider_settings(&transaction).map_err(|error| error.to_string())?;
        } else {
            transaction
                .execute_batch(sql)
                .map_err(|error| error.to_string())?;
        }

        transaction
            .execute("INSERT INTO schema_migrations (name) VALUES (?1)", [name])
            .map_err(|error| error.to_string())?;

        transaction.commit().map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn repair_legacy_provider_settings(db: &Connection) -> rusqlite::Result<()> {
    // 기존 개발 DB는 002번이 적용된 뒤 해당 마이그레이션의 정의가 바뀌었습니다.
    let single_row: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('llm_settings') WHERE name='refresh_token')",
        [],
        |row| row.get(0),
    )?;
    if !single_row {
        return Ok(());
    }
    db.execute_batch("ALTER TABLE llm_settings RENAME TO legacy_llm_settings")?;
    db.execute_batch(SETTINGS_SCHEMA)?;
    db.execute_batch(AUTH_PREFERENCES)?;
    let separate_credentials: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='provider_credentials')",
        [], |row| row.get(0),
    )?;
    let has_provider_id: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('legacy_llm_settings') WHERE name='provider_id')",
        [], |row| row.get(0),
    )?;
    if !has_provider_id {
        // 012번의 현재 SQL은 구버전 단일 행에 공급자 열을 추가하지 않습니다.
        db.execute_batch(
            "ALTER TABLE legacy_llm_settings ADD COLUMN provider_id TEXT DEFAULT 'openai'",
        )?;
    }
    let old = db
        .query_row(
            "SELECT provider_id, provider_kind, base_url FROM legacy_llm_settings WHERE id=1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    let mut selected_api_source = None;
    if let Some((original_provider, kind, base)) = old {
        let provider = original_provider.as_str();
        let oauth = kind == "chatgpt_oauth" || kind == "oauth" || provider == "chatgpt";
        let mut provider = match provider {
            _ if oauth => "openai",
            "custom_openai" | "custom" => "custom",
            "openai" | "anthropic" | "google" | "openrouter" => provider,
            _ => "custom",
        };
        let kind = if oauth { "oauth" } else { "api-key" };
        let default_url = default_base_url_for(provider, kind);
        if !oauth && !base.is_empty() && provider != "custom" {
            let old_origin = url::Url::parse(&base).ok().map(|url| url.origin());
            let default_origin = url::Url::parse(default_url).ok().map(|url| url.origin());
            if old_origin != default_origin {
                provider = "custom";
            }
        }
        // 주소를 편집할 수 있던 구버전의 API 키는 저장 당시 서버로만 연결합니다.
        let api_url = if oauth || base.is_empty() {
            default_url
        } else {
            &base
        };
        if !oauth && !base.trim().is_empty() {
            selected_api_source = Some((
                original_provider.clone(),
                provider.to_owned(),
                api_url.to_owned(),
            ));
        }
        db.execute(
            "INSERT INTO provider_settings(provider_id, credential_type, api_url)
             VALUES ((SELECT id FROM providers WHERE key=?1), ?2, ?3)
             ON CONFLICT(provider_id, credential_type) DO UPDATE SET api_url=excluded.api_url",
            params![provider, kind, api_url],
        )?;
        db.execute(
            "UPDATE llm_settings SET provider_settings_id=(
               SELECT s.id FROM provider_settings s JOIN providers p ON p.id=s.provider_id
               WHERE p.key=?1 AND s.credential_type=?2
             ), (model, openai_oauth_enabled, openai_oauth_priority, openai_api_key_enabled,
                 openai_api_key_priority, updated_at)=(
               SELECT model, openai_oauth_enabled, openai_oauth_priority, openai_api_key_enabled,
                      openai_api_key_priority, updated_at FROM legacy_llm_settings WHERE id=1
             ) WHERE id=1",
            params![provider, kind],
        )?;
        if !separate_credentials {
            db.execute_batch(
                "INSERT INTO provider_settings(provider_id, credential_type, api_url)
                 SELECT id, 'oauth', 'https://chatgpt.com/backend-api/codex' FROM providers
                 WHERE key='openai' AND EXISTS(
                   SELECT 1 FROM legacy_llm_settings WHERE access_token IS NOT NULL OR refresh_token IS NOT NULL
                 ) ON CONFLICT(provider_id, credential_type) DO NOTHING;
                 UPDATE provider_settings SET (access_token,refresh_token,expires_at,account_id,email)=(
                   SELECT access_token,refresh_token,expires_at,account_id,chatgpt_email FROM legacy_llm_settings WHERE id=1
                 ) WHERE provider_id=(SELECT id FROM providers WHERE key='openai') AND credential_type='oauth';"
            )?;
            if oauth || base.trim().is_empty() {
                // 구버전 OAuth 로그인은 직전 서버 주소만 덮고 API 키를 유지했습니다.
                let unassigned: bool = db.query_row(
                    "SELECT EXISTS(SELECT 1 FROM legacy_llm_settings WHERE TRIM(api_key) != '')",
                    [],
                    |row| row.get(0),
                )?;
                if unassigned {
                    db.execute_batch("CREATE TABLE legacy_unassigned_api_key AS SELECT api_key FROM legacy_llm_settings WHERE id=1")?;
                }
            } else {
                db.execute_batch("UPDATE provider_settings SET api_key=(SELECT api_key FROM legacy_llm_settings WHERE id=1)
                    WHERE id=(SELECT provider_settings_id FROM llm_settings WHERE id=1)")?;
            }
        }
    }
    if separate_credentials {
        // 별도 자격 증명 테이블을 사용한 버전은 해당 테이블의 로그아웃·갱신 상태가 최신입니다.
        let unbound_custom_key: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM provider_credentials WHERE provider_id IN ('custom','custom_openai')
              AND TRIM(api_key) != '' AND NOT EXISTS(
                SELECT 1 FROM legacy_llm_settings WHERE provider_id IN ('custom','custom_openai')
                AND provider_kind IN ('api_key','api-key') AND TRIM(base_url) != ''))",
            [], |row| row.get(0),
        )?;
        if unbound_custom_key {
            db.execute_batch(
                "CREATE TABLE legacy_unassigned_api_key AS SELECT api_key FROM provider_credentials
                WHERE provider_id IN ('custom','custom_openai') AND TRIM(api_key) != ''",
            )?;
        }
        for (provider, legacy) in [
            ("openai", "openai"),
            ("anthropic", "anthropic"),
            ("google", "google"),
            ("openrouter", "openrouter"),
            ("custom", "custom_openai"),
        ] {
            for kind in ["oauth", "api-key"] {
                if (kind == "oauth" && provider != "openai")
                    || (provider == "custom" && unbound_custom_key)
                {
                    continue;
                }
                // 분리형 자격 증명 버전은 비선택 표준 공급자의 주소를 고정했습니다.
                let (destination, api_url) = selected_api_source
                    .as_ref()
                    .filter(|(source, _, _)| {
                        kind == "api-key" && (source == provider || source == legacy)
                    })
                    .map(|(_, id, url)| (id.as_str(), url.as_str()))
                    .unwrap_or((provider, default_base_url_for(provider, kind)));
                db.execute(
                    "INSERT INTO provider_settings(provider_id, credential_type, api_url, api_key,
                      access_token,refresh_token,expires_at,account_id,email)
                     SELECT (SELECT id FROM providers WHERE key=?5), ?3, ?4, api_key,access_token,
                       refresh_token,expires_at,account_id,email FROM provider_credentials
                     WHERE provider_id IN (?1,?2) AND (
                       (?3='oauth' AND credential_type IN ('oauth','chatgpt_oauth')) OR
                       (?3='api-key' AND credential_type IN ('api_key','api-key')))
                     ORDER BY updated_at, credential_id
                     ON CONFLICT(provider_id,credential_type) DO UPDATE SET
                       api_key=excluded.api_key, access_token=excluded.access_token, refresh_token=excluded.refresh_token,
                       expires_at=excluded.expires_at, account_id=excluded.account_id, email=excluded.email",
                    params![provider, legacy, kind, api_url, destination],
                )?;
            }
        }
        db.execute_batch("DROP TABLE provider_credentials")?;
    }
    db.execute_batch("DROP TABLE legacy_llm_settings")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repositories::settings_repository::{load_credential, load_settings};

    fn legacy_settings_db() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE schema_migrations(name TEXT PRIMARY KEY);
            CREATE TABLE llm_settings(id INTEGER PRIMARY KEY, provider_id TEXT, provider_kind TEXT,
              base_url TEXT, model TEXT, api_key TEXT, access_token TEXT, refresh_token TEXT,
              expires_at INTEGER, account_id TEXT, chatgpt_email TEXT, updated_at TEXT);
            INSERT INTO llm_settings VALUES(1, 'chatgpt','chatgpt_oauth','https://chatgpt.com/backend-api/codex',
              'my-model','unbound-key','access','refresh',123,'account','test@example.com','2026-01-01');").unwrap();
        db.execute_batch(AUTH_PREFERENCES).unwrap();
        db.execute_batch("UPDATE llm_settings SET openai_api_key_enabled=0")
            .unwrap();
        // 이 픽스처는 공급자 복구만 대상으로 하며 다른 기능의 테이블을 생성하지 않습니다.
        for (name, _) in MIGRATIONS
            .iter()
            .filter(|(name, _)| *name != REPAIR_PROVIDER_SETTINGS)
        {
            db.execute("INSERT INTO schema_migrations(name) VALUES(?1)", [name])
                .unwrap();
        }
        db
    }

    #[test]
    fn upgrades_recorded_single_row_schema_without_losing_the_chatgpt_account() {
        let mut db = legacy_settings_db();
        run_migrations(&mut db).unwrap();
        run_migrations(&mut db).unwrap();
        let selected = load_settings(&db).unwrap();
        assert!(selected.logged_in && !selected.openai_api_key_enabled);
        assert_eq!(selected.provider_kind, "oauth");
        assert_eq!(selected.model, "my-model");
        let credential = load_credential(&db, "openai", "oauth").unwrap();
        assert_eq!(credential.refresh_token.as_deref(), Some("refresh"));
        assert_eq!(credential.access_token.as_deref(), Some("access"));
        assert_eq!(credential.expires_at, Some(123));
        assert_eq!(credential.account_id.as_deref(), Some("account"));
        assert_eq!(credential.email.as_deref(), Some("test@example.com"));
        assert!(load_credential(&db, "openai", "api-key")
            .unwrap()
            .api_key
            .is_none());
        assert_eq!(
            db.query_row("SELECT api_key FROM legacy_unassigned_api_key", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
            "unbound-key"
        );
        assert!(db.prepare("SELECT * FROM legacy_llm_settings").is_err());
    }

    #[test]
    fn keeps_legacy_custom_keys_with_their_configured_server() {
        let mut db = legacy_settings_db();
        db.execute_batch(
            "UPDATE llm_settings SET provider_id='openai', provider_kind='api_key',
           base_url='https://my-server.example/v1', api_key='custom-key'",
        )
        .unwrap();
        run_migrations(&mut db).unwrap();
        let selected = load_settings(&db).unwrap();
        assert_eq!(selected.provider_id, "custom");
        assert_eq!(selected.base_url, "https://my-server.example/v1");
        assert_eq!(selected.api_key.as_deref(), Some("custom-key"));
        assert!(load_credential(&db, "openai", "api-key")
            .unwrap()
            .api_key
            .is_none());
    }

    #[test]
    fn preserves_separately_stored_keys_and_respects_legacy_logout() {
        let mut db = legacy_settings_db();
        db.execute_batch("CREATE TABLE provider_credentials(credential_id INTEGER PRIMARY KEY,
            provider_id TEXT, credential_type TEXT, api_key TEXT, access_token TEXT, refresh_token TEXT,
            expires_at INTEGER, account_id TEXT, email TEXT, updated_at TEXT);
            INSERT INTO provider_credentials(provider_id, credential_type, api_key) VALUES
              ('openai','api_key','api-key'),('custom_openai','api_key','old-custom-key')").unwrap();
        run_migrations(&mut db).unwrap();
        assert!(!load_settings(&db).unwrap().logged_in);
        assert_eq!(
            load_credential(&db, "openai", "api-key")
                .unwrap()
                .api_key
                .as_deref(),
            Some("api-key")
        );
        assert!(load_credential(&db, "custom", "api-key")
            .unwrap()
            .api_key
            .is_none());
        assert_eq!(
            db.query_row("SELECT api_key FROM legacy_unassigned_api_key", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
            "old-custom-key"
        );
        assert!(db.prepare("SELECT * FROM provider_credentials").is_err());
    }

    #[test]
    fn binds_a_separate_key_to_the_selected_legacy_server() {
        let mut db = legacy_settings_db();
        db.execute_batch("UPDATE llm_settings SET provider_id='openai', provider_kind='api_key',
                base_url='https://my-server.example/v1';
            CREATE TABLE provider_credentials(credential_id INTEGER PRIMARY KEY,
                provider_id TEXT, credential_type TEXT, api_key TEXT, access_token TEXT, refresh_token TEXT,
                expires_at INTEGER, account_id TEXT, email TEXT, updated_at TEXT);
            INSERT INTO provider_credentials(provider_id, credential_type, api_key) VALUES
                ('openai','api_key','custom-server-key')").unwrap();
        run_migrations(&mut db).unwrap();
        let selected = load_settings(&db).unwrap();
        assert_eq!(selected.base_url, "https://my-server.example/v1");
        assert_eq!(selected.api_key.as_deref(), Some("custom-server-key"));
        assert!(load_credential(&db, "openai", "api-key")
            .unwrap()
            .api_key
            .is_none());
    }

    #[test]
    fn migration_preserves_legacy_sessions_and_assigns_stable_agent_ids() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").unwrap();
        for (name, sql) in &MIGRATIONS[..16] {
            connection.execute_batch(sql).unwrap();
            connection
                .execute("INSERT INTO schema_migrations (name) VALUES (?1)", [name])
                .unwrap();
        }
        connection.execute("INSERT INTO chat_sessions (id, title, created_at, updated_at, mode_name) VALUES ('legacy', '이전 대화', 1, 1, 'Orchestration')", []).unwrap();
        connection.execute("INSERT INTO chat_messages (id, session_id, message_order, side, type, sender, text, created_at)
            VALUES ('reply', 'legacy', 0, 'agent', 'text', '이전 이름', '기존 답변', 1)", []).unwrap();
        run_migrations(&mut connection).unwrap();
        let ids = |db: &Connection| {
            let mut statement = db
                .prepare("SELECT agent_id FROM operation_mode_agents ORDER BY id")
                .unwrap();
            let result = statement
                .query_map([], |row| row.get::<_, String>(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            result
        };
        let original_ids = ids(&connection);
        assert!(!original_ids.is_empty());
        assert!(original_ids.iter().all(|id| !id.is_empty()));
        let target: Option<String> = connection
            .query_row(
                "SELECT agent_id FROM chat_sessions WHERE id = 'legacy'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(target.is_none());
        let legacy_message: (Option<String>, String, String) = connection
            .query_row(
                "SELECT agent_id, sender, text FROM chat_messages WHERE id = 'reply'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            legacy_message,
            (None, "이전 이름".into(), "기존 답변".into())
        );
        run_migrations(&mut connection).unwrap();
        assert_eq!(ids(&connection), original_ids);
    }
}
