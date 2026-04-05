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

struct StoredSelection {
    provider_id: String,
    provider_kind: String,
    model: String,
    base_url: String,
    openai_oauth_enabled: bool,
    openai_oauth_priority: i64,
    openai_api_key_enabled: bool,
    openai_api_key_priority: i64,
}

pub fn load_settings(connection: &rusqlite::Connection) -> Result<StoredLlmSettings, String> {
    let selection = load_selection(connection)?;
    let oauth = load_credential(connection, DEFAULT_PROVIDER_KEY, "oauth")?;
    let (provider_kind, selected) = if selection.provider_id == DEFAULT_PROVIDER_KEY {
        let api_key = load_credential(connection, DEFAULT_PROVIDER_KEY, "api-key")?;
        resolve_active_provider_credential(&selection, &oauth, &api_key)
    } else {
        let provider_kind = normalize_provider_kind(&selection.provider_id, &selection.provider_kind);
        let selected = load_credential(connection, &selection.provider_id, &provider_kind)?;
        (provider_kind, selected)
    };
    let base_url = if selection.provider_id == DEFAULT_PROVIDER_KEY {
        default_base_url_for(&selection.provider_id, &provider_kind).to_string()
    } else {
        selection.base_url.clone()
    };

    Ok(StoredLlmSettings {
        provider_id: selection.provider_id,
        provider_kind,
        model: selection.model,
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
        openai_oauth_enabled: selection.openai_oauth_enabled,
        openai_oauth_priority: selection.openai_oauth_priority,
        openai_api_key_enabled: selection.openai_api_key_enabled,
        openai_api_key_priority: selection.openai_api_key_priority,
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
              provider_settings.credential_type,
              provider_settings.api_url,
              provider_settings.api_key,
              provider_settings.refresh_token,
              provider_settings.email
            FROM providers
            LEFT JOIN provider_settings ON provider_settings.provider_id = providers.id
            ORDER BY providers.id, provider_settings.credential_type
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
                row.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(|error| error.to_string())?;

    let mut grouped = std::collections::BTreeMap::<String, AvailableProviderPayload>::new();

    for row in rows {
        let (provider_id, credential_type, api_url, api_key, refresh_token, email) =
            row.map_err(|error| error.to_string())?;
        let entry = grouped
            .entry(provider_id.clone())
            .or_insert_with(|| AvailableProviderPayload {
                provider_id: provider_id.clone(),
                credential_types: Vec::new(),
                api_url: None,
                api_urls: std::collections::BTreeMap::new(),
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
        if let Some(api_url) = api_url.filter(|value| !value.trim().is_empty()) {
            if entry.api_url.is_none() {
                entry.api_url = Some(api_url.clone());
            }
            entry.api_urls.insert(credential_type.clone(), api_url);
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
    openai_oauth_enabled: bool,
    openai_oauth_priority: i64,
    openai_api_key_enabled: bool,
    openai_api_key_priority: i64,
) -> Result<(), String> {
    let provider_settings_id =
        resolve_or_create_provider_setting_id(connection, provider_id, credential_type)?;
    let (openai_oauth_priority, openai_api_key_priority) =
        normalize_openai_priorities(openai_oauth_priority, openai_api_key_priority);

    connection
        .execute(
            "INSERT INTO llm_settings (
               id,
               provider_settings_id,
               model,
               openai_oauth_enabled,
               openai_oauth_priority,
               openai_api_key_enabled,
               openai_api_key_priority,
               updated_at
             )
             VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET
               provider_settings_id = excluded.provider_settings_id,
               model = excluded.model,
               openai_oauth_enabled = excluded.openai_oauth_enabled,
               openai_oauth_priority = excluded.openai_oauth_priority,
               openai_api_key_enabled = excluded.openai_api_key_enabled,
               openai_api_key_priority = excluded.openai_api_key_priority,
               updated_at = CURRENT_TIMESTAMP",
            params![
                provider_settings_id,
                model,
                if openai_oauth_enabled { 1 } else { 0 },
                openai_oauth_priority,
                if openai_api_key_enabled { 1 } else { 0 },
                openai_api_key_priority,
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
            "
            SELECT
              providers.key,
              provider_settings.credential_type,
              provider_settings.api_key,
              provider_settings.access_token,
              provider_settings.refresh_token,
              provider_settings.expires_at,
              provider_settings.account_id,
              provider_settings.email
            FROM provider_settings
            INNER JOIN providers ON providers.id = provider_settings.provider_id
            WHERE providers.key = ?1 AND provider_settings.credential_type = ?2
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
        resolve_or_create_provider_setting_id(connection, provider_id, credential_type)?;

    connection
        .execute(
            "UPDATE provider_settings
             SET name = ?1, api_url = ?2, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?3",
            params![name, api_url, provider_settings_id],
        )
        .map_err(|error| error.to_string())?;

    load_provider_settings(connection, provider_id, credential_type)?
        .ok_or_else(|| "provider settings瑜?李얠쓣 ???놁뒿?덈떎.".to_string())
}

pub fn save_credential(
    connection: &rusqlite::Connection,
    credential: StoredProviderCredential,
) -> Result<(), String> {
    let provider_settings_id = resolve_or_create_provider_setting_id(
        connection,
        &credential.provider_id,
        &credential.credential_type,
    )?;

    connection
        .execute(
            "UPDATE provider_settings
             SET api_key = ?1,
                 access_token = ?2,
                 refresh_token = ?3,
                 expires_at = ?4,
                 account_id = ?5,
                 email = ?6,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?7",
            params![
                credential.api_key,
                credential.access_token,
                credential.refresh_token,
                credential.expires_at,
                credential.account_id,
                credential.email,
                provider_settings_id,
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

fn load_selection(connection: &rusqlite::Connection) -> Result<StoredSelection, String> {
    connection
        .query_row(
            "
            SELECT
              providers.key,
              provider_settings.credential_type,
              llm_settings.model,
              provider_settings.api_url,
              llm_settings.openai_oauth_enabled,
              llm_settings.openai_oauth_priority,
              llm_settings.openai_api_key_enabled,
              llm_settings.openai_api_key_priority
            FROM llm_settings
            INNER JOIN provider_settings ON provider_settings.id = llm_settings.provider_settings_id
            INNER JOIN providers ON providers.id = provider_settings.provider_id
            WHERE llm_settings.id = 1
            ",
            [],
            |row| {
                Ok(StoredSelection {
                    provider_id: row.get::<_, String>(0)?,
                    provider_kind: row.get::<_, String>(1)?,
                    model: row.get::<_, String>(2)?,
                    base_url: row.get::<_, String>(3)?,
                    openai_oauth_enabled: row.get::<_, i64>(4)? != 0,
                    openai_oauth_priority: row.get::<_, i64>(5)?,
                    openai_api_key_enabled: row.get::<_, i64>(6)? != 0,
                    openai_api_key_priority: row.get::<_, i64>(7)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .map(|selection| {
            let provider_id = normalize_provider_id(&selection.provider_id);
            let provider_kind = normalize_provider_kind(&provider_id, &selection.provider_kind);
            let (openai_oauth_priority, openai_api_key_priority) = normalize_openai_priorities(
                selection.openai_oauth_priority,
                selection.openai_api_key_priority,
            );
            Ok(StoredSelection {
                provider_id: provider_id.clone(),
                provider_kind,
                model: normalize_text(&selection.model)
                    .unwrap_or_else(|| default_model_for(&provider_id).to_string()),
                base_url: normalize_text(&selection.base_url).unwrap_or_else(|| {
                    default_base_url_for(&provider_id, &selection.provider_kind).to_string()
                }),
                openai_oauth_enabled: selection.openai_oauth_enabled,
                openai_oauth_priority,
                openai_api_key_enabled: selection.openai_api_key_enabled,
                openai_api_key_priority,
            })
        })
        .unwrap_or_else(|| {
            Ok(StoredSelection {
                provider_id: DEFAULT_PROVIDER_KEY.to_string(),
                provider_kind: "api-key".to_string(),
                model: DEFAULT_MODEL.to_string(),
                base_url: DEFAULT_OPENAI_BASE_URL.to_string(),
                openai_oauth_enabled: true,
                openai_oauth_priority: 1,
                openai_api_key_enabled: true,
                openai_api_key_priority: 2,
            })
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
              provider_settings.credential_type,
              provider_settings.name,
              provider_settings.api_url
            FROM provider_settings
            INNER JOIN providers ON providers.id = provider_settings.provider_id
            WHERE providers.key = ?1 AND provider_settings.credential_type = ?2
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
        .ok_or_else(|| "provider瑜?李얠쓣 ???놁뒿?덈떎.".to_string())
}

fn resolve_or_create_provider_setting_id(
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
            "INSERT INTO provider_settings (
               provider_id,
               credential_type,
               api_url,
               updated_at
             ) VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)",
            params![provider_row_id, credential_type, default_api_url],
        )
        .map_err(|error| error.to_string())?;

    Ok(connection.last_insert_rowid())
}

fn normalize_openai_priorities(oauth_priority: i64, api_key_priority: i64) -> (i64, i64) {
    let oauth_priority = if oauth_priority == 2 { 2 } else { 1 };
    let api_key_priority = if api_key_priority == 2 { 2 } else { 1 };

    if oauth_priority == api_key_priority {
        if oauth_priority == 1 {
            (1, 2)
        } else {
            (2, 1)
        }
    } else {
        (oauth_priority, api_key_priority)
    }
}

fn credential_available(credential: &StoredProviderCredential) -> bool {
    credential
        .api_key
        .as_ref()
        .is_some_and(|value| !value.trim().is_empty())
        || credential
            .refresh_token
            .as_ref()
            .is_some_and(|value| !value.trim().is_empty())
}

fn resolve_active_provider_credential(
    selection: &StoredSelection,
    oauth: &StoredProviderCredential,
    api_key: &StoredProviderCredential,
) -> (String, StoredProviderCredential) {
    let mut candidates = vec![
        (
            "oauth".to_string(),
            selection.openai_oauth_enabled,
            selection.openai_oauth_priority,
            oauth.clone(),
        ),
        (
            "api-key".to_string(),
            selection.openai_api_key_enabled,
            selection.openai_api_key_priority,
            api_key.clone(),
        ),
    ];

    candidates.sort_by_key(|(_, _, priority, _)| *priority);

    if let Some((provider_kind, _, _, credential)) = candidates
        .iter()
        .find(|(_, enabled, _, credential)| *enabled && credential_available(credential))
    {
        return (provider_kind.clone(), credential.clone());
    }

    if let Some((provider_kind, _, _, credential)) =
        candidates.iter().find(|(_, enabled, _, _)| *enabled)
    {
        return (provider_kind.clone(), credential.clone());
    }

    ("api-key".to_string(), api_key.clone())
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
