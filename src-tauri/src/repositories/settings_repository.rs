use crate::commands::settings_types::{
    AvailableProviderPayload, StoredLlmSettings, StoredProvider, StoredProviderCredential,
    StoredProviderSettings,
};
use rusqlite::{params, OptionalExtension};

const DEFAULT_PROVIDER_KEY: &str = "openai";
const DEFAULT_MODEL: &str = "gpt-4o-mini";
const DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_BASE_URL: &str = "https://api.anthropic.com/v1";
const DEFAULT_GEMINI_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
const CHATGPT_BASE_URL: &str = "https://chatgpt.com/backend-api/codex";

pub fn load_settings(connection: &rusqlite::Connection) -> Result<StoredLlmSettings, String> {
    let (provider_id, provider_kind, model, base_url) = load_selection(connection)?;
    let selected = load_credential(connection, &provider_id, &provider_kind)?;
    let oauth = load_credential(connection, DEFAULT_PROVIDER_KEY, "oauth")?;

    Ok(StoredLlmSettings {
        provider_id,
        provider_kind,
        model,
        base_url,
        api_key: selected.api_key,
        access_token: selected.access_token,
        refresh_token: selected.refresh_token,
        expires_at: selected.expires_at,
        account_id: selected.account_id,
        logged_in: oauth
            .refresh_token
            .as_ref()
            .is_some_and(|value| !value.trim().is_empty()),
        email: oauth.email,
    })
}

pub fn load_available_providers(
    connection: &rusqlite::Connection,
) -> Result<Vec<AvailableProviderPayload>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT
              providers.key,
              provider_credentials.credential_type,
              provider_credentials.api_key,
              provider_credentials.refresh_token,
              provider_credentials.email
            FROM providers
            LEFT JOIN provider_settings ON provider_settings.provider_id = providers.id
            LEFT JOIN provider_credentials ON provider_credentials.provider_settings_id = provider_settings.id
            ORDER BY providers.id, provider_credentials.credential_type
            ",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(|error| error.to_string())?;

    let mut grouped = std::collections::BTreeMap::<String, AvailableProviderPayload>::new();

    for row in rows {
        let (provider_id, credential_type, api_key, refresh_token, email) =
            row.map_err(|error| error.to_string())?;
        let entry =
            grouped
                .entry(provider_id.clone())
                .or_insert_with(|| AvailableProviderPayload {
                    provider_id: provider_id.clone(),
                    credential_types: Vec::new(),
                    has_api_key: false,
                    logged_in: false,
                    email: None,
                });

        let Some(credential_type) = credential_type else {
            continue;
        };

        let has_api_key = api_key
            .as_ref()
            .is_some_and(|value: &String| !value.trim().is_empty());
        let has_refresh_token = refresh_token
            .as_ref()
            .is_some_and(|value| !value.trim().is_empty());

        if has_api_key || has_refresh_token {
            entry.credential_types.push(credential_type.clone());
        }
        if credential_type == "api-key" && has_api_key {
            entry.has_api_key = true;
        }
        if credential_type == "oauth" && has_refresh_token {
            entry.logged_in = true;
            entry.email = email;
        }
    }

    Ok(grouped
        .into_values()
        .filter(|item| item.has_api_key || item.logged_in || !item.credential_types.is_empty())
        .collect())
}

pub fn load_providers(connection: &rusqlite::Connection) -> Result<Vec<StoredProvider>, String> {
    let mut statement = connection
        .prepare("SELECT key, label, protocol FROM providers ORDER BY id")
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok(StoredProvider {
                key: row.get(0)?,
                label: row.get(1)?,
                protocol: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn save_selection(
    connection: &rusqlite::Connection,
    provider_id: &str,
    credential_type: &str,
    model: &str,
) -> Result<(), String> {
    let provider_settings_id =
        resolve_or_create_provider_settings_id(connection, provider_id, credential_type)?;

    connection
        .execute(
            "INSERT INTO llm_settings (id, provider_settings_id, model, updated_at)
             VALUES (1, ?1, ?2, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET
               provider_settings_id = excluded.provider_settings_id,
               model = excluded.model,
               updated_at = CURRENT_TIMESTAMP",
            params![provider_settings_id, model],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

pub fn load_credential(
    connection: &rusqlite::Connection,
    provider_id: &str,
    credential_type: &str,
) -> Result<StoredProviderCredential, String> {
    connection
        .query_row(
            "
            SELECT
              providers.key,
              provider_credentials.credential_type,
              provider_credentials.api_key,
              provider_credentials.access_token,
              provider_credentials.refresh_token,
              provider_credentials.expires_at,
              provider_credentials.account_id,
              provider_credentials.email
            FROM provider_settings
            INNER JOIN providers ON providers.id = provider_settings.provider_id
            INNER JOIN provider_credentials ON provider_credentials.provider_settings_id = provider_settings.id
            WHERE providers.key = ?1 AND provider_credentials.credential_type = ?2
            ORDER BY provider_settings.id
            LIMIT 1
            ",
            params![provider_id, credential_type],
            |row| {
                Ok(StoredProviderCredential {
                    provider_id: row.get(0)?,
                    credential_type: row.get(1)?,
                    api_key: row.get(2)?,
                    access_token: row.get(3)?,
                    refresh_token: row.get(4)?,
                    expires_at: row.get(5)?,
                    account_id: row.get(6)?,
                    email: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .map(Ok)
        .unwrap_or_else(|| {
            Ok(StoredProviderCredential {
                provider_id: provider_id.to_string(),
                credential_type: credential_type.to_string(),
                ..StoredProviderCredential::default()
            })
        })
}

pub fn save_provider_settings(
    connection: &rusqlite::Connection,
    provider_id: &str,
    credential_type: &str,
    name: Option<&str>,
    api_url: &str,
) -> Result<StoredProviderSettings, String> {
    let provider_settings_id =
        resolve_or_create_provider_settings_id(connection, provider_id, credential_type)?;

    connection
        .execute(
            "UPDATE provider_settings
             SET name = ?1, api_url = ?2, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?3",
            params![name, api_url, provider_settings_id],
        )
        .map_err(|error| error.to_string())?;

    load_provider_settings(connection, provider_id, credential_type)?
        .ok_or_else(|| "provider settings를 찾을 수 없습니다.".to_string())
}

pub fn save_credential(
    connection: &rusqlite::Connection,
    credential: StoredProviderCredential,
) -> Result<(), String> {
    let provider_settings_id = resolve_or_create_provider_settings_id(
        connection,
        &credential.provider_id,
        &credential.credential_type,
    )?;

    connection
        .execute(
            "INSERT INTO provider_credentials (
               provider_settings_id, credential_type, api_key, access_token, refresh_token, expires_at, account_id, email, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CURRENT_TIMESTAMP)
             ON CONFLICT(provider_settings_id) DO UPDATE SET
               credential_type = excluded.credential_type,
               api_key = excluded.api_key,
               access_token = excluded.access_token,
               refresh_token = excluded.refresh_token,
               expires_at = excluded.expires_at,
               account_id = excluded.account_id,
               email = excluded.email,
               updated_at = CURRENT_TIMESTAMP",
            params![
                provider_settings_id,
                credential.credential_type,
                credential.api_key,
                credential.access_token,
                credential.refresh_token,
                credential.expires_at,
                credential.account_id,
                credential.email,
            ],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

pub fn clear_credential(
    connection: &rusqlite::Connection,
    provider_id: &str,
    credential_type: &str,
) -> Result<(), String> {
    save_credential(
        connection,
        StoredProviderCredential {
            provider_id: provider_id.to_string(),
            credential_type: credential_type.to_string(),
            ..StoredProviderCredential::default()
        },
    )
}

fn load_selection(
    connection: &rusqlite::Connection,
) -> Result<(String, String, String, String), String> {
    connection
        .query_row(
            "
            SELECT
              providers.key,
              provider_credentials.credential_type,
              llm_settings.model,
              provider_settings.api_url
            FROM llm_settings
            INNER JOIN provider_settings ON provider_settings.id = llm_settings.provider_settings_id
            INNER JOIN providers ON providers.id = provider_settings.provider_id
            INNER JOIN provider_credentials ON provider_credentials.provider_settings_id = provider_settings.id
            WHERE llm_settings.id = 1
            ",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .map(|(provider_id, credential_type, model, api_url)| {
            let provider_id = normalize_provider_id(&provider_id);
            let credential_type = normalize_provider_kind(&provider_id, &credential_type);
            let model = normalize_text(&model)
                .unwrap_or_else(|| default_model_for(&provider_id).to_string());
            let base_url = normalize_text(&api_url).unwrap_or_else(|| {
                default_base_url_for(&provider_id, &credential_type).to_string()
            });
            Ok((provider_id, credential_type, model, base_url))
        })
        .unwrap_or_else(|| {
            Ok((
                DEFAULT_PROVIDER_KEY.to_string(),
                "api-key".to_string(),
                DEFAULT_MODEL.to_string(),
                DEFAULT_OPENAI_BASE_URL.to_string(),
            ))
        })
}

fn load_provider_settings(
    connection: &rusqlite::Connection,
    provider_id: &str,
    credential_type: &str,
) -> Result<Option<StoredProviderSettings>, String> {
    connection
        .query_row(
            "
            SELECT
              provider_settings.id,
              providers.key,
              provider_credentials.credential_type,
              provider_settings.name,
              provider_settings.api_url
            FROM provider_settings
            INNER JOIN providers ON providers.id = provider_settings.provider_id
            INNER JOIN provider_credentials ON provider_credentials.provider_settings_id = provider_settings.id
            WHERE providers.key = ?1 AND provider_credentials.credential_type = ?2
            ORDER BY provider_settings.id
            LIMIT 1
            ",
            params![provider_id, credential_type],
            |row| {
                Ok(StoredProviderSettings {
                    id: row.get(0)?,
                    provider_id: row.get(1)?,
                    credential_type: row.get(2)?,
                    name: row.get(3)?,
                    api_url: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn resolve_provider_row_id(
    connection: &rusqlite::Connection,
    provider_id: &str,
) -> Result<i64, String> {
    let provider_key = normalize_provider_id(provider_id);

    connection
        .query_row(
            "SELECT id FROM providers WHERE key = ?1",
            [provider_key],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "provider를 찾을 수 없습니다.".to_string())
}

fn resolve_or_create_provider_settings_id(
    connection: &rusqlite::Connection,
    provider_id: &str,
    credential_type: &str,
) -> Result<i64, String> {
    if let Some(settings) = load_provider_settings(connection, provider_id, credential_type)? {
        return Ok(settings.id);
    }

    let provider_row_id = resolve_provider_row_id(connection, provider_id)?;
    let default_api_url = default_base_url_for(provider_id, credential_type);

    connection
        .execute(
            "INSERT INTO provider_settings (provider_id, api_url, updated_at)
             VALUES (?1, ?2, CURRENT_TIMESTAMP)",
            params![provider_row_id, default_api_url],
        )
        .map_err(|error| error.to_string())?;

    let provider_settings_id = connection.last_insert_rowid();

    connection
        .execute(
            "INSERT INTO provider_credentials (provider_settings_id, credential_type, updated_at)
             VALUES (?1, ?2, CURRENT_TIMESTAMP)",
            params![provider_settings_id, credential_type],
        )
        .map_err(|error| error.to_string())?;

    Ok(provider_settings_id)
}

fn normalize_provider_id(value: &str) -> String {
    match value.trim() {
        "anthropic" | "google" | "openrouter" | "custom" => value.trim().to_string(),
        "custom_openai" => "custom".to_string(),
        "" | "openai" | "chatgpt" => DEFAULT_PROVIDER_KEY.to_string(),
        _ => DEFAULT_PROVIDER_KEY.to_string(),
    }
}

fn normalize_provider_kind(provider_id: &str, value: &str) -> String {
    if provider_id == DEFAULT_PROVIDER_KEY && value == "oauth" {
        return "oauth".to_string();
    }
    "api-key".to_string()
}

fn default_model_for(provider_id: &str) -> &'static str {
    match provider_id {
        "anthropic" => "claude-3-5-sonnet-latest",
        "google" => "gemini-2.5-pro",
        "openrouter" => "openai/gpt-4o-mini",
        _ => DEFAULT_MODEL,
    }
}

fn default_base_url_for(provider_id: &str, credential_type: &str) -> &'static str {
    if provider_id == DEFAULT_PROVIDER_KEY && credential_type == "oauth" {
        return CHATGPT_BASE_URL;
    }

    match provider_id {
        "anthropic" => DEFAULT_ANTHROPIC_BASE_URL,
        "google" => DEFAULT_GEMINI_BASE_URL,
        "openrouter" => DEFAULT_OPENROUTER_BASE_URL,
        "custom" => DEFAULT_OPENAI_BASE_URL,
        _ => DEFAULT_OPENAI_BASE_URL,
    }
}

fn normalize_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}
