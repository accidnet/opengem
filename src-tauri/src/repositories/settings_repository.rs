use crate::commands::settings_types::{
    AvailableProviderPayload, StoredLlmSettings, StoredProviderCredential,
};
use rusqlite::{params, OptionalExtension};

const DEFAULT_PROVIDER_ID: &str = "openai";
const DEFAULT_MODEL: &str = "gpt-4o-mini";
const DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_BASE_URL: &str = "https://api.anthropic.com/v1";
const DEFAULT_GEMINI_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
const CHATGPT_BASE_URL: &str = "https://chatgpt.com/backend-api/codex";

pub fn load_settings(connection: &rusqlite::Connection) -> Result<StoredLlmSettings, String> {
    let (provider_id, provider_kind, model) = load_selection(connection)?;
    let selected = load_credential(connection, &provider_id, &provider_kind)?;
    let oauth = load_credential(connection, DEFAULT_PROVIDER_ID, "oauth")?;
    Ok(StoredLlmSettings {
        provider_id: provider_id.clone(),
        provider_kind: provider_kind.clone(),
        model,
        base_url: resolve_base_url(&provider_id, &provider_kind),
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
              provider_id,
              credential_type,
              api_key,
              refresh_token,
              email
            FROM provider_credentials
            ORDER BY provider_id, credential_type
            ",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
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

        let has_api_key = api_key
            .as_ref()
            .is_some_and(|value: &String| !value.trim().is_empty());
        let has_refresh_token = refresh_token
            .as_ref()
            .is_some_and(|value| !value.trim().is_empty());

        if has_api_key || has_refresh_token {
            entry.credential_types.push(credential_type.clone());
        }
        if credential_type == "api_key" && has_api_key {
            entry.has_api_key = true;
        }
        if credential_type == "oauth" && has_refresh_token {
            entry.logged_in = true;
            entry.email = email.clone();
        }
    }

    Ok(grouped
        .into_values()
        .filter(|item| item.has_api_key || item.logged_in || !item.credential_types.is_empty())
        .collect())
}

pub fn save_selection(
    connection: &rusqlite::Connection,
    provider_id: &str,
    provider_kind: &str,
    model: &str,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO llm_settings (id, provider_id, provider_kind, base_url, model, updated_at)
             VALUES (1, ?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET
               provider_id = excluded.provider_id,
               provider_kind = excluded.provider_kind,
               base_url = excluded.base_url,
               model = excluded.model,
               updated_at = CURRENT_TIMESTAMP",
            params![
                provider_id,
                provider_kind,
                resolve_base_url(provider_id, provider_kind),
                model
            ],
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
            "SELECT provider_id, credential_type, api_key, access_token, refresh_token, expires_at, account_id, email
             FROM provider_credentials WHERE provider_id = ?1 AND credential_type = ?2",
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

pub fn save_credential(
    connection: &rusqlite::Connection,
    credential: StoredProviderCredential,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO provider_credentials (
               provider_id, credential_type, api_key, access_token, refresh_token, expires_at, account_id, email, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CURRENT_TIMESTAMP)
             ON CONFLICT(provider_id, credential_type) DO UPDATE SET
               api_key = excluded.api_key,
               access_token = excluded.access_token,
               refresh_token = excluded.refresh_token,
               expires_at = excluded.expires_at,
               account_id = excluded.account_id,
               email = excluded.email,
               updated_at = CURRENT_TIMESTAMP",
            params![
                credential.provider_id,
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
    let current = load_credential(connection, provider_id, credential_type)?;
    save_credential(
        connection,
        StoredProviderCredential {
            provider_id: provider_id.to_string(),
            credential_type: credential_type.to_string(),
            api_key: current.api_key.filter(|_| credential_type == "api_key"),
            ..StoredProviderCredential::default()
        },
    )
}

fn load_selection(connection: &rusqlite::Connection) -> Result<(String, String, String), String> {
    connection
        .query_row(
            "SELECT provider_id, provider_kind, model FROM llm_settings WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .map(|(provider_id, provider_kind, model)| {
            let provider_id = normalize_provider_id(&provider_id);
            let provider_kind = normalize_provider_kind(&provider_id, &provider_kind);
            let model = normalize_text(&model)
                .unwrap_or_else(|| default_model_for(&provider_id).to_string());
            Ok((provider_id, provider_kind, model))
        })
        .unwrap_or_else(|| {
            Ok((
                DEFAULT_PROVIDER_ID.to_string(),
                "api_key".to_string(),
                DEFAULT_MODEL.to_string(),
            ))
        })
}

fn normalize_provider_id(value: &str) -> String {
    match value.trim() {
        "anthropic" | "google" | "openrouter" | "custom_openai" => value.trim().to_string(),
        "" | "openai" | "chatgpt" => DEFAULT_PROVIDER_ID.to_string(),
        _ => DEFAULT_PROVIDER_ID.to_string(),
    }
}

fn normalize_provider_kind(provider_id: &str, value: &str) -> String {
    if provider_id == DEFAULT_PROVIDER_ID && value == "oauth" {
        return "oauth".to_string();
    }
    "api_key".to_string()
}

fn default_model_for(provider_id: &str) -> &'static str {
    match provider_id {
        "anthropic" => "claude-3-5-sonnet-latest",
        "google" => "gemini-2.5-pro",
        "openrouter" => "openai/gpt-4o-mini",
        _ => DEFAULT_MODEL,
    }
}

fn resolve_base_url(provider_id: &str, provider_kind: &str) -> String {
    if provider_id == DEFAULT_PROVIDER_ID && provider_kind == "oauth" {
        return CHATGPT_BASE_URL.to_string();
    }
    match provider_id {
        "anthropic" => DEFAULT_ANTHROPIC_BASE_URL.to_string(),
        "google" => DEFAULT_GEMINI_BASE_URL.to_string(),
        "openrouter" => DEFAULT_OPENROUTER_BASE_URL.to_string(),
        _ => DEFAULT_OPENAI_BASE_URL.to_string(),
    }
}

fn normalize_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}
