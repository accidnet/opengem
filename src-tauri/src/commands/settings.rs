use crate::app_state::AppState;
use crate::commands::settings_types::{
    IdTokenClaims, LlmSettingsPayload, OAuthCodes, ResolvedLlmSettingsPayload, SaveLlmSettingsInput,
    StartChatgptLoginPayload, StoredLlmSettings, StoredProviderCredential, TokenResponse,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{distributions::Alphanumeric, Rng};
use reqwest::blocking::Client;
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::State;
use tracing::{debug, error, info};
use url::Url;

const DEFAULT_PROVIDER_ID: &str = "openai";
const DEFAULT_MODEL: &str = "gpt-4o-mini";
const DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_BASE_URL: &str = "https://api.anthropic.com/v1";
const DEFAULT_GEMINI_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
const CHATGPT_BASE_URL: &str = "https://chatgpt.com/backend-api/codex";
const CHATGPT_DEFAULT_MODEL: &str = "gpt-5.2";
const OPENAI_ISSUER: &str = "https://auth.openai.com";
const OPENAI_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const OAUTH_TIMEOUT_SECONDS: u64 = 300;
const OAUTH_PORT: u16 = 1455;

#[tauri::command]
pub fn get_llm_settings(state: State<AppState>) -> Result<LlmSettingsPayload, String> {
    let connection = state.open_connection()?;
    debug!("loading llm settings");
    Ok(to_payload(load_settings(&connection)?))
}

#[tauri::command]
pub fn save_llm_settings(
    state: State<AppState>,
    input: SaveLlmSettingsInput,
) -> Result<LlmSettingsPayload, String> {
    let connection = state.open_connection()?;
    let provider_id = normalize_provider_id(&input.provider_id);
    let provider_kind = normalize_provider_kind(&provider_id, &input.provider_kind);
    let model = normalize_text(&input.model).unwrap_or_else(|| default_model_for(&provider_id).to_string());
    let api_key = normalize_optional_secret(input.api_key);

    if provider_kind == "api_key" {
        save_credential(
            &connection,
            StoredProviderCredential {
                provider_id: provider_id.clone(),
                credential_type: provider_kind.clone(),
                api_key,
                ..StoredProviderCredential::default()
            },
        )?;
    }

    save_selection(&connection, &provider_id, &provider_kind, &model)?;
    info!(provider_id = %provider_id, provider_kind = %provider_kind, model = %model, "llm settings saved");
    Ok(to_payload(load_settings(&connection)?))
}

#[tauri::command]
pub fn resolve_llm_settings(state: State<AppState>) -> Result<ResolvedLlmSettingsPayload, String> {
    let connection = state.open_connection()?;
    let settings = resolve_settings(&connection)?;
    Ok(ResolvedLlmSettingsPayload {
        provider_id: settings.provider_id,
        provider_kind: settings.provider_kind,
        base_url: settings.base_url,
        model: settings.model,
        api_key: settings.api_key,
        access_token: settings.access_token,
        account_id: settings.account_id,
    })
}

#[tauri::command]
pub fn begin_chatgpt_login(state: State<AppState>) -> Result<StartChatgptLoginPayload, String> {
    let listener = TcpListener::bind(format!("127.0.0.1:{OAUTH_PORT}"))
        .map_err(|error| format!("OAuth 콜백 포트를 열지 못했습니다: {error}"))?;
    listener.set_nonblocking(true).map_err(|error| error.to_string())?;

    let redirect_uri = format!("http://localhost:{OAUTH_PORT}/auth/callback");
    let oauth = generate_oauth_codes();
    let state_code = generate_state();
    let auth_url = build_authorize_url(&redirect_uri, &oauth.challenge, &state_code);
    let db_path = state.db_path.clone();
    let redirect_uri_for_worker = redirect_uri.clone();

    thread::spawn(move || {
        if let Err(error) =
            run_chatgpt_login_flow(listener, &redirect_uri_for_worker, &oauth, &state_code, db_path)
        {
            error!("chatgpt oauth flow failed: {error}");
        }
    });

    Ok(StartChatgptLoginPayload { authorization_url: auth_url })
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|error| format!("잘못된 URL입니다: {error}"))?;
    match parsed.scheme() {
        "http" | "https" => open_url_with_system_browser(parsed.as_str()),
        _ => Err("http 또는 https 링크만 열 수 있습니다.".to_string()),
    }
}

#[tauri::command]
pub fn logout_chatgpt(state: State<AppState>) -> Result<LlmSettingsPayload, String> {
    let connection = state.open_connection()?;
    clear_credential(&connection, DEFAULT_PROVIDER_ID, "chatgpt_oauth")?;
    let current = load_settings(&connection)?;
    if current.provider_id == DEFAULT_PROVIDER_ID && current.provider_kind == "chatgpt_oauth" {
        save_selection(&connection, DEFAULT_PROVIDER_ID, "api_key", &current.model)?;
    }
    Ok(to_payload(load_settings(&connection)?))
}

fn open_url_with_system_browser(url: &str) -> Result<(), String> {
    let wsl_powershell_path = Path::new("/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe");
    if wsl_powershell_path.exists() {
        let escaped_url = url.replace('"', "`\"");
        let status = Command::new(wsl_powershell_path)
            .args(["-NoProfile", "-NonInteractive", "-Command", &format!("Start-Process \"{escaped_url}\"")])
            .status()
            .map_err(|error| format!("WSL에서 브라우저를 열지 못했습니다: {error}"))?;
        if status.success() {
            return Ok(());
        }
        return Err(format!("브라우저 실행이 실패했습니다. 종료 코드: {:?}", status.code()));
    }
    open::that(url).map(|_| ()).map_err(|error| format!("외부 브라우저를 열지 못했습니다: {error}"))
}

fn run_chatgpt_login_flow(
    listener: TcpListener,
    redirect_uri: &str,
    oauth: &OAuthCodes,
    expected_state: &str,
    db_path: PathBuf,
) -> Result<(), String> {
    let deadline = std::time::Instant::now() + Duration::from_secs(OAUTH_TIMEOUT_SECONDS);
    let tokens = loop {
        if std::time::Instant::now() > deadline {
            return Err("ChatGPT 로그인 시간이 초과되었습니다.".to_string());
        }
        match listener.accept() {
            Ok((mut stream, _)) => match handle_oauth_connection(&mut stream, redirect_uri, oauth, expected_state) {
                Ok(tokens) => break tokens,
                Err(error) => return Err(error),
            },
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(150)),
            Err(error) => return Err(error.to_string()),
        }
    };

    let connection = rusqlite::Connection::open(db_path).map_err(|error| error.to_string())?;
    let current = load_settings(&connection)?;
    let claims = extract_claims(tokens.id_token.as_deref(), Some(tokens.access_token.as_str()));
    let next_model = if current.provider_id == DEFAULT_PROVIDER_ID && current.provider_kind == "chatgpt_oauth" {
        current.model
    } else {
        CHATGPT_DEFAULT_MODEL.to_string()
    };

    save_credential(
        &connection,
        StoredProviderCredential {
            provider_id: DEFAULT_PROVIDER_ID.to_string(),
            credential_type: "chatgpt_oauth".to_string(),
            access_token: Some(tokens.access_token),
            refresh_token: Some(tokens.refresh_token),
            expires_at: Some(now_millis()? + tokens.expires_in.unwrap_or(3600) * 1000),
            account_id: extract_account_id(claims.as_ref()),
            email: claims.and_then(|item| item.email),
            ..StoredProviderCredential::default()
        },
    )?;

    if current.provider_id == DEFAULT_PROVIDER_ID && current.provider_kind == "chatgpt_oauth" {
        save_selection(&connection, DEFAULT_PROVIDER_ID, "chatgpt_oauth", &next_model)?;
    }
    Ok(())
}

fn handle_oauth_connection(
    stream: &mut std::net::TcpStream,
    redirect_uri: &str,
    oauth: &OAuthCodes,
    expected_state: &str,
) -> Result<TokenResponse, String> {
    stream.set_read_timeout(Some(Duration::from_secs(5))).map_err(|error| error.to_string())?;
    let mut buffer = [0u8; 4096];
    let read = stream.read(&mut buffer).map_err(|error| error.to_string())?;
    let request = String::from_utf8_lossy(&buffer[..read]);
    let target = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| "OAuth 콜백 요청을 해석하지 못했습니다.".to_string())?;
    let url = Url::parse(&format!("http://localhost{target}")).map_err(|error| error.to_string())?;

    if let Some(message) = url
        .query_pairs()
        .find(|(key, _)| key == "error")
        .map(|(_, value)| value.to_string())
    {
        write_html(stream, &oauth_error_html(&message))?;
        return Err(message);
    }

    let state = url
        .query_pairs()
        .find(|(key, _)| key == "state")
        .map(|(_, value)| value.to_string());
    if state.as_deref() != Some(expected_state) {
        let message = "OAuth state 검증에 실패했습니다.".to_string();
        write_html(stream, &oauth_error_html(&message))?;
        return Err(message);
    }

    let code = url
        .query_pairs()
        .find(|(key, _)| key == "code")
        .map(|(_, value)| value.to_string())
        .ok_or_else(|| "OAuth authorization code가 없습니다.".to_string())?;
    let tokens = exchange_code_for_tokens(&code, redirect_uri, &oauth.verifier)?;
    write_html(stream, OAUTH_SUCCESS_HTML)?;
    Ok(tokens)
}

fn exchange_code_for_tokens(code: &str, redirect_uri: &str, verifier: &str) -> Result<TokenResponse, String> {
    Client::new()
        .post(format!("{OPENAI_ISSUER}/oauth/token"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirect_uri),
            ("client_id", OPENAI_CLIENT_ID),
            ("code_verifier", verifier),
        ])
        .send()
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<TokenResponse>()
        .map_err(|error| error.to_string())
}

fn refresh_access_token(refresh_token: &str) -> Result<TokenResponse, String> {
    Client::new()
        .post(format!("{OPENAI_ISSUER}/oauth/token"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[("grant_type", "refresh_token"), ("refresh_token", refresh_token), ("client_id", OPENAI_CLIENT_ID)])
        .send()
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<TokenResponse>()
        .map_err(|error| error.to_string())
}

fn resolve_settings(connection: &rusqlite::Connection) -> Result<StoredLlmSettings, String> {
    let mut settings = load_settings(connection)?;
    if settings.provider_kind != "chatgpt_oauth" {
        return Ok(settings);
    }

    let refresh_token = settings
        .refresh_token
        .clone()
        .ok_or_else(|| "ChatGPT 로그인이 필요합니다.".to_string())?;
    let now = now_millis()?;
    if settings.access_token.is_none() || settings.expires_at.unwrap_or(0) <= now + 60_000 {
        let tokens = refresh_access_token(&refresh_token)?;
        let claims = extract_claims(tokens.id_token.as_deref(), Some(tokens.access_token.as_str()));
        save_credential(
            connection,
            StoredProviderCredential {
                provider_id: DEFAULT_PROVIDER_ID.to_string(),
                credential_type: "chatgpt_oauth".to_string(),
                access_token: Some(tokens.access_token),
                refresh_token: Some(tokens.refresh_token),
                expires_at: Some(now + tokens.expires_in.unwrap_or(3600) * 1000),
                account_id: extract_account_id(claims.as_ref()).or(settings.account_id.clone()),
                email: claims.and_then(|item| item.email).or(settings.chatgpt_email.clone()),
                ..StoredProviderCredential::default()
            },
        )?;
        settings = load_settings(connection)?;
    }
    Ok(settings)
}

fn load_settings(connection: &rusqlite::Connection) -> Result<StoredLlmSettings, String> {
    let (provider_id, provider_kind, model) = load_selection(connection)?;
    let selected = load_credential(connection, &provider_id, &provider_kind)?;
    let oauth = load_credential(connection, DEFAULT_PROVIDER_ID, "chatgpt_oauth")?;
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
        chatgpt_logged_in: oauth.refresh_token.as_ref().is_some_and(|value| !value.trim().is_empty()),
        chatgpt_email: oauth.email,
    })
}

fn load_selection(connection: &rusqlite::Connection) -> Result<(String, String, String), String> {
    connection
        .query_row("SELECT provider_id, provider_kind, model FROM llm_settings WHERE id = 1", [], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        })
        .optional()
        .map_err(|error| error.to_string())?
        .map(|(provider_id, provider_kind, model)| {
            let provider_id = normalize_provider_id(&provider_id);
            let provider_kind = normalize_provider_kind(&provider_id, &provider_kind);
            let model = normalize_text(&model).unwrap_or_else(|| default_model_for(&provider_id).to_string());
            Ok((provider_id, provider_kind, model))
        })
        .unwrap_or_else(|| Ok((DEFAULT_PROVIDER_ID.to_string(), "api_key".to_string(), DEFAULT_MODEL.to_string())))
}

fn save_selection(
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
            params![provider_id, provider_kind, resolve_base_url(provider_id, provider_kind), model],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn load_credential(
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

fn save_credential(connection: &rusqlite::Connection, credential: StoredProviderCredential) -> Result<(), String> {
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

fn clear_credential(connection: &rusqlite::Connection, provider_id: &str, credential_type: &str) -> Result<(), String> {
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

fn to_payload(settings: StoredLlmSettings) -> LlmSettingsPayload {
    LlmSettingsPayload {
        provider_id: settings.provider_id,
        provider_kind: settings.provider_kind,
        base_url: settings.base_url,
        model: settings.model,
        api_key: settings.api_key,
        chatgpt_logged_in: settings.chatgpt_logged_in,
        chatgpt_email: settings.chatgpt_email,
    }
}

fn normalize_provider_id(value: &str) -> String {
    match value.trim() {
        "anthropic" | "google" | "openrouter" | "custom_openai" => value.trim().to_string(),
        "" | "openai" | "chatgpt" => DEFAULT_PROVIDER_ID.to_string(),
        _ => DEFAULT_PROVIDER_ID.to_string(),
    }
}

fn normalize_provider_kind(provider_id: &str, value: &str) -> String {
    if provider_id == DEFAULT_PROVIDER_ID && value == "chatgpt_oauth" {
        return "chatgpt_oauth".to_string();
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
    if provider_id == DEFAULT_PROVIDER_ID && provider_kind == "chatgpt_oauth" {
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
    if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
}

fn normalize_optional_secret(value: Option<String>) -> Option<String> {
    value.and_then(|item| normalize_text(&item))
}

fn generate_oauth_codes() -> OAuthCodes {
    let verifier: String = rand::thread_rng().sample_iter(&Alphanumeric).take(96).map(char::from).collect();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    OAuthCodes { verifier, challenge }
}

fn generate_state() -> String {
    URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>())
}

fn build_authorize_url(redirect_uri: &str, challenge: &str, state: &str) -> String {
    let mut params = url::form_urlencoded::Serializer::new(String::new());
    params.append_pair("response_type", "code");
    params.append_pair("client_id", OPENAI_CLIENT_ID);
    params.append_pair("redirect_uri", redirect_uri);
    params.append_pair("scope", "openid profile email offline_access");
    params.append_pair("code_challenge", challenge);
    params.append_pair("code_challenge_method", "S256");
    params.append_pair("id_token_add_organizations", "true");
    params.append_pair("codex_cli_simplified_flow", "true");
    params.append_pair("state", state);
    params.append_pair("originator", "opengem");
    format!("{OPENAI_ISSUER}/oauth/authorize?{}", params.finish())
}

fn extract_claims(id_token: Option<&str>, access_token: Option<&str>) -> Option<IdTokenClaims> {
    if let Some(token) = id_token {
        if let Some(claims) = parse_jwt_claims(token) {
            return Some(claims);
        }
    }
    access_token.and_then(parse_jwt_claims)
}

fn parse_jwt_claims(token: &str) -> Option<IdTokenClaims> {
    let payload = token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD.decode(payload.as_bytes()).ok()?;
    serde_json::from_slice::<IdTokenClaims>(&decoded).ok()
}

fn extract_account_id(claims: Option<&IdTokenClaims>) -> Option<String> {
    let claims = claims?;
    claims.chatgpt_account_id.clone().or_else(|| {
        claims.auth.as_ref().and_then(|auth| auth.chatgpt_account_id.clone())
    }).or_else(|| {
        claims.organizations.as_ref().and_then(|items| items.first().map(|item| item.id.clone()))
    })
}

fn write_html(stream: &mut std::net::TcpStream, html: &str) -> Result<(), String> {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );
    stream.write_all(response.as_bytes()).map_err(|error| error.to_string())
}

fn now_millis() -> Result<i64, String> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_millis() as i64)
}

const OAUTH_SUCCESS_HTML: &str = r#"<!doctype html><html><head><meta charset="utf-8" /><title>OpenGem 로그인 완료</title></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#e2e8f0;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;"><main style="max-width:420px;padding:32px;border-radius:20px;background:rgba(15,23,42,.9);border:1px solid rgba(148,163,184,.2);text-align:center;"><h1 style="margin:0 0 12px;font-size:24px;">로그인 완료</h1><p style="margin:0;color:#cbd5e1;">이 창을 닫고 OpenGem으로 돌아가면 됩니다.</p></main><script>setTimeout(() => window.close(), 1800)</script></body></html>"#;

fn oauth_error_html(message: &str) -> String {
    format!("<!doctype html><html><head><meta charset=\"utf-8\" /><title>OpenGem 로그인 실패</title></head><body style=\"margin:0;min-height:100vh;display:grid;place-items:center;background:#111827;color:#f8fafc;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;\"><main style=\"max-width:440px;padding:32px;border-radius:20px;background:rgba(17,24,39,.92);border:1px solid rgba(248,113,113,.28);text-align:center;\"><h1 style=\"margin:0 0 12px;font-size:24px;color:#fca5a5;\">로그인 실패</h1><p style=\"margin:0;color:#d1d5db;\">{message}</p></main></body></html>")
}
