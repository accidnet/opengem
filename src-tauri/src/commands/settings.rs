use crate::app_state::AppState;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{distributions::Alphanumeric, Rng};
use reqwest::blocking::Client;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
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
use tracing::{debug, error, info, warn};
use url::Url;

const DEFAULT_API_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_MODEL: &str = "gpt-4o-mini";
const DEFAULT_PROVIDER_ID: &str = "openai";
const CHATGPT_BASE_URL: &str = "https://chatgpt.com/backend-api/codex";
const CHATGPT_DEFAULT_MODEL: &str = "gpt-5.2";
const OPENAI_ISSUER: &str = "https://auth.openai.com";
const OPENAI_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const OAUTH_TIMEOUT_SECONDS: u64 = 300;
const OAUTH_PORT: u16 = 1455;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmSettingsPayload {
    provider_id: String,
    provider_kind: String,
    base_url: String,
    model: String,
    api_key: Option<String>,
    chatgpt_logged_in: bool,
    chatgpt_email: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLlmSettingsInput {
    provider_id: String,
    provider_kind: String,
    base_url: String,
    model: String,
    api_key: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedLlmSettingsPayload {
    provider_id: String,
    provider_kind: String,
    base_url: String,
    model: String,
    api_key: Option<String>,
    access_token: Option<String>,
    account_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartChatgptLoginPayload {
    authorization_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatgptMessageInput {
    role: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatgptRequestInput {
    model: String,
    messages: Vec<ChatgptMessageInput>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsagePayload {
    prompt_tokens: Option<i64>,
    completion_tokens: Option<i64>,
    total_tokens: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatgptResponsePayload {
    text: String,
    usage: Option<UsagePayload>,
}

#[derive(Default)]
struct StoredLlmSettings {
    provider_id: String,
    provider_kind: String,
    base_url: String,
    model: String,
    api_key: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_at: Option<i64>,
    account_id: Option<String>,
    chatgpt_email: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: Option<i64>,
    id_token: Option<String>,
}

#[derive(Deserialize)]
struct IdTokenClaims {
    chatgpt_account_id: Option<String>,
    organizations: Option<Vec<OrganizationClaim>>,
    email: Option<String>,
    #[serde(rename = "https://api.openai.com/auth")]
    auth: Option<AuthClaim>,
}

#[derive(Deserialize)]
struct OrganizationClaim {
    id: String,
}

#[derive(Deserialize)]
struct AuthClaim {
    chatgpt_account_id: Option<String>,
}

struct OAuthCodes {
    verifier: String,
    challenge: String,
}

#[derive(Serialize, Deserialize)]
struct ResponsesInputTextItem {
    r#type: String,
    text: String,
}

#[derive(Serialize, Deserialize)]
struct ResponsesInputMessage {
    role: String,
    content: Vec<ResponsesInputTextItem>,
}

#[derive(Deserialize)]
struct ResponsesOutputTextItem {
    r#type: Option<String>,
    text: Option<String>,
}

#[derive(Deserialize)]
struct ResponsesOutputItem {
    content: Option<Vec<ResponsesOutputTextItem>>,
}

#[derive(Deserialize)]
struct ResponsesUsage {
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    total_tokens: Option<i64>,
}

#[derive(Deserialize)]
struct ResponsesApiResponse {
    output_text: Option<String>,
    output: Option<Vec<ResponsesOutputItem>>,
    usage: Option<ResponsesUsage>,
}

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
    let current = load_settings(&connection)?;
    let provider_kind = normalize_provider_kind(&input.provider_kind);
    let provider_id = normalize_provider_id(&input.provider_id, &provider_kind);
    let base_url =
        normalize_text(&input.base_url).unwrap_or_else(|| DEFAULT_API_BASE_URL.to_string());
    let model = normalize_text(&input.model).unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let api_key = normalize_optional_secret(input.api_key);
    let has_api_key = api_key.is_some();

    save_settings(
        &connection,
        StoredLlmSettings {
            provider_id: provider_id.clone(),
            provider_kind: provider_kind.clone(),
            base_url,
            model: model.clone(),
            api_key,
            access_token: current.access_token,
            refresh_token: current.refresh_token,
            expires_at: current.expires_at,
            account_id: current.account_id,
            chatgpt_email: current.chatgpt_email,
        },
    )?;

    info!(
        provider_id = %provider_id,
        provider_kind = %provider_kind,
        model = %model,
        has_api_key = has_api_key,
        "llm settings saved"
    );

    Ok(to_payload(load_settings(&connection)?))
}

#[tauri::command]
pub fn resolve_llm_settings(state: State<AppState>) -> Result<ResolvedLlmSettingsPayload, String> {
    let connection = state.open_connection()?;
    let settings = resolve_settings(&connection)?;
    debug!(
        provider_id = %settings.provider_id,
        provider_kind = %settings.provider_kind,
        model = %settings.model,
        has_access_token = settings.access_token.is_some(),
        "resolved llm settings"
    );

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
pub fn send_chatgpt_message(
    state: State<AppState>,
    input: ChatgptRequestInput,
) -> Result<ChatgptResponsePayload, String> {
    let connection = state.open_connection()?;
    let settings = resolve_settings(&connection)?;
    info!(
        model = %input.model,
        message_count = input.messages.len(),
        "sending chatgpt message"
    );

    if settings.provider_kind != "chatgpt_oauth" {
        warn!("chatgpt message requested without chatgpt_oauth provider");
        return Err("현재 프로바이더가 ChatGPT OAuth로 설정되어 있지 않습니다.".to_string());
    }

    let access_token = settings
        .access_token
        .ok_or_else(|| "ChatGPT 액세스 토큰이 없습니다. 다시 로그인해줘.".to_string())?;

    let mut request = Client::new()
        .post(format!("{CHATGPT_BASE_URL}/responses"))
        .bearer_auth(access_token)
        .header("Content-Type", "application/json")
        .header("originator", "opengem")
        .json(&build_chatgpt_request_body(&input));

    if let Some(account_id) = settings.account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }

    let response = request.send().map_err(|error| {
        error!("chatgpt request send failed: {error}");
        error.to_string()
    })?;
    let status = response.status();
    let body = response.text().map_err(|error| error.to_string())?;

    if !status.is_success() {
        error!(status = %status, body = %body, "chatgpt api returned error");
        return Err(format!("ChatGPT API 오류 ({}): {}", status, body));
    }

    let payload = parse_chatgpt_response_body(&body)?;
    info!(
        output_length = payload.text.len(),
        has_usage = payload.usage.is_some(),
        "chatgpt message completed"
    );

    Ok(payload)
}

#[tauri::command]
pub fn begin_chatgpt_login(state: State<AppState>) -> Result<StartChatgptLoginPayload, String> {
    info!("starting chatgpt oauth login flow");
    let listener = TcpListener::bind(format!("127.0.0.1:{OAUTH_PORT}"))
        .map_err(|error| format!("OAuth 콜백 포트({OAUTH_PORT})를 열지 못했습니다: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;

    let redirect_uri = format!("http://localhost:{OAUTH_PORT}/auth/callback");
    let oauth = generate_oauth_codes();
    let state_code = generate_state();
    let auth_url = build_authorize_url(&redirect_uri, &oauth.challenge, &state_code);

    let db_path = state.db_path.clone();
    let redirect_uri_for_worker = redirect_uri.clone();
    thread::spawn(move || {
        if let Err(error) = run_chatgpt_login_flow(
            listener,
            &redirect_uri_for_worker,
            &oauth,
            &state_code,
            db_path,
        ) {
            error!("chatgpt oauth flow failed: {error}");
        }
    });

    Ok(StartChatgptLoginPayload {
        authorization_url: auth_url,
    })
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let parsed =
        Url::parse(&url).map_err(|error| format!("외부 링크 형식이 올바르지 않습니다: {error}"))?;

    match parsed.scheme() {
        "http" | "https" => open_url_with_system_browser(parsed.as_str()),
        _ => Err("http 또는 https 링크만 열 수 있습니다.".to_string()),
    }
}

fn open_url_with_system_browser(url: &str) -> Result<(), String> {
    let wsl_powershell_path =
        Path::new("/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe");

    if wsl_powershell_path.exists() {
        let escaped_url = url.replace('"', "`\"");
        let status = Command::new(wsl_powershell_path)
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &format!("Start-Process \"{escaped_url}\""),
            ])
            .status()
            .map_err(|error| format!("WSL에서 Windows 브라우저를 열지 못했습니다: {error}"))?;

        if status.success() {
            return Ok(());
        }

        return Err(format!(
            "WSL에서 Windows 브라우저 실행이 실패했습니다. 종료 코드: {:?}",
            status.code()
        ));
    }

    open::that(url)
        .map(|_| ())
        .map_err(|error| format!("외부 브라우저를 열지 못했습니다: {error}"))
}

#[tauri::command]
pub fn logout_chatgpt(state: State<AppState>) -> Result<LlmSettingsPayload, String> {
    let connection = state.open_connection()?;
    let current = load_settings(&connection)?;
    save_settings(
        &connection,
        StoredLlmSettings {
            provider_id: if current.provider_id == "chatgpt" {
                "openai".to_string()
            } else {
                current.provider_id
            },
            provider_kind: if current.provider_kind == "chatgpt_oauth" {
                "api_key".to_string()
            } else {
                current.provider_kind
            },
            base_url: current.base_url,
            model: current.model,
            api_key: current.api_key,
            access_token: None,
            refresh_token: None,
            expires_at: None,
            account_id: None,
            chatgpt_email: None,
        },
    )?;
    info!("chatgpt oauth logged out");
    Ok(to_payload(load_settings(&connection)?))
}

fn run_chatgpt_login_flow(
    listener: TcpListener,
    redirect_uri: &str,
    oauth: &OAuthCodes,
    expected_state: &str,
    db_path: PathBuf,
) -> Result<(), String> {
    info!("waiting for oauth callback");
    let deadline = std::time::Instant::now() + Duration::from_secs(OAUTH_TIMEOUT_SECONDS);
    let tokens = loop {
        if std::time::Instant::now() > deadline {
            return Err("ChatGPT 로그인 시간이 초과되었습니다.".to_string());
        }

        match listener.accept() {
            Ok((mut stream, _)) => {
                match handle_oauth_connection(&mut stream, redirect_uri, oauth, expected_state) {
                    Ok(tokens) => break tokens,
                    Err(error) => return Err(error),
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(150));
            }
            Err(error) => return Err(error.to_string()),
        }
    };

    let connection = rusqlite::Connection::open(db_path).map_err(|error| error.to_string())?;
    let current = load_settings(&connection)?;
    let claims = extract_claims(
        tokens.id_token.as_deref(),
        Some(tokens.access_token.as_str()),
    );
    let account_id = extract_account_id(claims.as_ref());
    let email = claims.and_then(|item| item.email);
    let has_account_id = account_id.is_some();
    let has_email = email.is_some();
    let next_model = if current.provider_kind == "chatgpt_oauth" {
        current.model
    } else {
        CHATGPT_DEFAULT_MODEL.to_string()
    };

    save_settings(
        &connection,
        StoredLlmSettings {
            provider_id: "chatgpt".to_string(),
            provider_kind: "chatgpt_oauth".to_string(),
            base_url: CHATGPT_BASE_URL.to_string(),
            model: next_model,
            api_key: current.api_key,
            access_token: Some(tokens.access_token),
            refresh_token: Some(tokens.refresh_token),
            expires_at: Some(now_millis()? + tokens.expires_in.unwrap_or(3600) * 1000),
            account_id,
            chatgpt_email: email,
        },
    )?;

    info!(
        has_account_id = has_account_id,
        has_email = has_email,
        "chatgpt oauth flow completed"
    );

    Ok(())
}

fn handle_oauth_connection(
    stream: &mut std::net::TcpStream,
    redirect_uri: &str,
    oauth: &OAuthCodes,
    expected_state: &str,
) -> Result<TokenResponse, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;

    let mut buffer = [0u8; 4096];
    let read = stream
        .read(&mut buffer)
        .map_err(|error| error.to_string())?;
    let request = String::from_utf8_lossy(&buffer[..read]);
    let target = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| "OAuth 콜백 요청을 해석하지 못했습니다.".to_string())?;
    let url =
        Url::parse(&format!("http://localhost{target}")).map_err(|error| error.to_string())?;
    let error = url
        .query_pairs()
        .find(|(key, _)| key == "error")
        .map(|(_, value)| value.to_string());
    let error_description = url
        .query_pairs()
        .find(|(key, _)| key == "error_description")
        .map(|(_, value)| value.to_string());

    if let Some(error) = error {
        let message = error_description.unwrap_or(error);
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
        .map(|(_, value)| value.to_string());
    let code = code.ok_or_else(|| "OAuth authorization code가 없습니다.".to_string())?;
    let tokens = exchange_code_for_tokens(&code, redirect_uri, &oauth.verifier)?;
    write_html(stream, OAUTH_SUCCESS_HTML)?;
    Ok(tokens)
}

fn exchange_code_for_tokens(
    code: &str,
    redirect_uri: &str,
    verifier: &str,
) -> Result<TokenResponse, String> {
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
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", OPENAI_CLIENT_ID),
        ])
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
    let expires_at = settings.expires_at.unwrap_or(0);

    if settings.access_token.is_none() || expires_at <= now + 60_000 {
        info!("refreshing chatgpt access token");
        let tokens = refresh_access_token(&refresh_token)?;
        let claims = extract_claims(
            tokens.id_token.as_deref(),
            Some(tokens.access_token.as_str()),
        );
        settings.access_token = Some(tokens.access_token);
        settings.refresh_token = Some(tokens.refresh_token);
        settings.expires_at = Some(now + tokens.expires_in.unwrap_or(3600) * 1000);
        settings.account_id = extract_account_id(claims.as_ref()).or(settings.account_id);
        settings.chatgpt_email = claims
            .and_then(|item| item.email)
            .or(settings.chatgpt_email);
        save_settings(connection, settings)?;
        return load_settings(connection);
    }

    Ok(settings)
}

fn build_chatgpt_request_body(input: &ChatgptRequestInput) -> serde_json::Value {
    let messages = input
        .messages
        .iter()
        .map(|message| ResponsesInputMessage {
            role: if message.role == "assistant" {
                "assistant".to_string()
            } else {
                "user".to_string()
            },
            content: vec![ResponsesInputTextItem {
                r#type: if message.role == "assistant" {
                    "output_text".to_string()
                } else {
                    "input_text".to_string()
                },
                text: message.content.clone(),
            }],
        })
        .collect::<Vec<_>>();

    let (instructions, rest) = match input.messages.first() {
        Some(first) if first.role == "system" => (
            first.content.clone(),
            messages.into_iter().skip(1).collect::<Vec<_>>(),
        ),
        _ => ("You are a helpful assistant.".to_string(), messages),
    };

    serde_json::json!({
        "model": input.model,
        "instructions": instructions,
        "input": rest,
        "store": false,
        "stream": true,
    })
}

fn parse_chatgpt_response_body(body: &str) -> Result<ChatgptResponsePayload, String> {
    if body.lines().any(|line| line.starts_with("data:")) {
        return parse_chatgpt_sse_response(body);
    }

    let parsed: ResponsesApiResponse = serde_json::from_str(body)
        .map_err(|error| format!("ChatGPT 응답을 해석하지 못했습니다: {error}"))?;

    Ok(ChatgptResponsePayload {
        text: get_responses_text(&parsed),
        usage: parsed.usage.map(|usage| UsagePayload {
            prompt_tokens: usage.input_tokens,
            completion_tokens: usage.output_tokens,
            total_tokens: usage.total_tokens,
        }),
    })
}

fn parse_chatgpt_sse_response(body: &str) -> Result<ChatgptResponsePayload, String> {
    let mut text = String::new();
    let mut usage: Option<UsagePayload> = None;

    for line in body.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("data:") {
            continue;
        }

        let raw = trimmed.trim_start_matches("data:").trim();
        if raw.is_empty() || raw == "[DONE]" {
            continue;
        }

        let parsed: serde_json::Value = serde_json::from_str(raw)
            .map_err(|error| format!("ChatGPT SSE 응답을 해석하지 못했습니다: {error}"))?;

        if let Some(delta) = parsed.get("delta").and_then(|value| value.as_str()) {
            text.push_str(delta);
        }

        if usage.is_none() {
            usage = extract_usage_from_value(&parsed);
        }

        if text.is_empty() {
            if let Some(output_text) = parsed
                .get("response")
                .and_then(|value| value.get("output_text"))
                .and_then(|value| value.as_str())
            {
                text = output_text.to_string();
            } else if let Some(output_text) =
                parsed.get("output_text").and_then(|value| value.as_str())
            {
                text = output_text.to_string();
            }
        }
    }

    Ok(ChatgptResponsePayload { text, usage })
}

fn extract_usage_from_value(value: &serde_json::Value) -> Option<UsagePayload> {
    let usage = value
        .get("usage")
        .or_else(|| value.get("response").and_then(|item| item.get("usage")))?;

    Some(UsagePayload {
        prompt_tokens: usage.get("input_tokens").and_then(|item| item.as_i64()),
        completion_tokens: usage.get("output_tokens").and_then(|item| item.as_i64()),
        total_tokens: usage.get("total_tokens").and_then(|item| item.as_i64()),
    })
}

fn get_responses_text(response: &ResponsesApiResponse) -> String {
    if let Some(text) = &response.output_text {
        return text.clone();
    }

    response
        .output
        .as_ref()
        .into_iter()
        .flat_map(|items| items.iter())
        .flat_map(|item| {
            item.content
                .as_ref()
                .into_iter()
                .flat_map(|content| content.iter())
        })
        .filter(|item| item.r#type.as_deref() == Some("output_text"))
        .filter_map(|item| item.text.clone())
        .collect::<Vec<_>>()
        .join("")
}

fn load_settings(connection: &rusqlite::Connection) -> Result<StoredLlmSettings, String> {
    connection
        .query_row(
            "SELECT provider_id, provider_kind, base_url, model, api_key, access_token, refresh_token, expires_at, account_id, chatgpt_email FROM llm_settings WHERE id = 1",
            [],
            |row| {
                Ok(StoredLlmSettings {
                    provider_id: row.get(0)?,
                    provider_kind: row.get(1)?,
                    base_url: row.get(2)?,
                    model: row.get(3)?,
                    api_key: row.get(4)?,
                    access_token: row.get(5)?,
                    refresh_token: row.get(6)?,
                    expires_at: row.get(7)?,
                    account_id: row.get(8)?,
                    chatgpt_email: row.get(9)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .map(Ok)
        .unwrap_or_else(|| {
            Ok(StoredLlmSettings {
                provider_id: DEFAULT_PROVIDER_ID.to_string(),
                provider_kind: "api_key".to_string(),
                base_url: DEFAULT_API_BASE_URL.to_string(),
                model: DEFAULT_MODEL.to_string(),
                ..StoredLlmSettings::default()
            })
        })
}

fn save_settings(
    connection: &rusqlite::Connection,
    settings: StoredLlmSettings,
) -> Result<(), String> {
    connection
        .execute(
            "
            INSERT INTO llm_settings (
              id, provider_id, provider_kind, base_url, model, api_key, access_token, refresh_token, expires_at, account_id, chatgpt_email, updated_at
            ) VALUES (
              1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, CURRENT_TIMESTAMP
            )
            ON CONFLICT(id) DO UPDATE SET
              provider_id = excluded.provider_id,
              provider_kind = excluded.provider_kind,
              base_url = excluded.base_url,
              model = excluded.model,
              api_key = excluded.api_key,
              access_token = excluded.access_token,
              refresh_token = excluded.refresh_token,
              expires_at = excluded.expires_at,
              account_id = excluded.account_id,
              chatgpt_email = excluded.chatgpt_email,
              updated_at = CURRENT_TIMESTAMP
            ",
            params![
                settings.provider_id,
                settings.provider_kind,
                settings.base_url,
                settings.model,
                settings.api_key,
                settings.access_token,
                settings.refresh_token,
                settings.expires_at,
                settings.account_id,
                settings.chatgpt_email,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn to_payload(settings: StoredLlmSettings) -> LlmSettingsPayload {
    let chatgpt_logged_in = settings.refresh_token.is_some();
    LlmSettingsPayload {
        provider_id: settings.provider_id,
        provider_kind: settings.provider_kind,
        base_url: settings.base_url,
        model: settings.model,
        api_key: settings.api_key,
        chatgpt_logged_in,
        chatgpt_email: settings.chatgpt_email,
    }
}

fn normalize_provider_kind(value: &str) -> String {
    if value == "chatgpt_oauth" {
        return "chatgpt_oauth".to_string();
    }
    "api_key".to_string()
}

fn normalize_provider_id(value: &str, provider_kind: &str) -> String {
    let trimmed = value.trim();
    if provider_kind == "chatgpt_oauth" || trimmed == "chatgpt" {
        return "chatgpt".to_string();
    }

    match trimmed {
        "anthropic" | "google" | "openrouter" | "custom_openai" => trimmed.to_string(),
        _ => "openai".to_string(),
    }
}

fn normalize_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

fn normalize_optional_secret(value: Option<String>) -> Option<String> {
    value.and_then(|item| normalize_text(&item))
}

fn generate_oauth_codes() -> OAuthCodes {
    let verifier: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(96)
        .map(char::from)
        .collect();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    OAuthCodes {
        verifier,
        challenge,
    }
}

fn generate_state() -> String {
    let random: [u8; 32] = rand::random();
    URL_SAFE_NO_PAD.encode(random)
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
    claims
        .chatgpt_account_id
        .clone()
        .or_else(|| {
            claims
                .auth
                .as_ref()
                .and_then(|auth| auth.chatgpt_account_id.clone())
        })
        .or_else(|| {
            claims
                .organizations
                .as_ref()
                .and_then(|items| items.first().map(|item| item.id.clone()))
        })
}

fn write_html(stream: &mut std::net::TcpStream, html: &str) -> Result<(), String> {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|error| error.to_string())
}

fn now_millis() -> Result<i64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as i64)
}

const OAUTH_SUCCESS_HTML: &str = r#"<!doctype html>
<html>
  <head>
    <meta charset=\"utf-8\" />
    <title>OpenGem 로그인 완료</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0f172a;
        color: #e2e8f0;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      }
      main {
        max-width: 420px;
        padding: 32px;
        border-radius: 20px;
        background: rgba(15, 23, 42, 0.9);
        border: 1px solid rgba(148, 163, 184, 0.2);
        text-align: center;
      }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { margin: 0; color: #cbd5e1; }
    </style>
  </head>
  <body>
    <main>
      <h1>로그인 완료</h1>
      <p>이 창을 닫고 OpenGem으로 돌아가면 됩니다.</p>
    </main>
    <script>setTimeout(() => window.close(), 1800)</script>
  </body>
</html>"#;

fn oauth_error_html(message: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\" /><title>OpenGem 로그인 실패</title></head><body style=\"margin:0;min-height:100vh;display:grid;place-items:center;background:#111827;color:#f8fafc;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;\"><main style=\"max-width:440px;padding:32px;border-radius:20px;background:rgba(17,24,39,.92);border:1px solid rgba(248,113,113,.28);text-align:center;\"><h1 style=\"margin:0 0 12px;font-size:24px;color:#fca5a5;\">로그인 실패</h1><p style=\"margin:0;color:#d1d5db;\">{message}</p></main></body></html>"
    )
}
