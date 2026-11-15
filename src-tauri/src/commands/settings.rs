use crate::app_state::AppState;
use crate::commands::settings_types::{
    AvailableProviderPayload, GetProviderCredentialInput, IdTokenClaims, LlmSettingsPayload,
    OAuthCodes, ProviderCredentialPayload, ProviderPayload, ProviderSettingsPayload,
    ResolvedLlmSettingsPayload, SaveLlmSettingsInput, SaveProviderSettingsInput,
    StartChatgptLoginPayload, StoredLlmSettings, StoredProvider, StoredProviderCredential,
    StoredProviderSettings, TokenResponse,
};
use crate::repositories::settings_repository::{
    clear_credential, load_available_providers, load_credential, load_providers, load_settings,
    save_credential, save_provider_settings, save_refreshed_oauth_credential, save_selection,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{distributions::Alphanumeric, Rng};
use reqwest::blocking::Client;
use rusqlite::OptionalExtension;
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::State;
use tracing::{debug, error, info};
use url::Url;

const DEFAULT_PROVIDER_ID: &str = "openai";
const OPENAI_ISSUER: &str = "https://auth.openai.com";
const OPENAI_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const OAUTH_TIMEOUT_SECONDS: u64 = 300;
const OAUTH_PORT: u16 = 1455;

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

fn resolve_preferred_provider_kind(input: &SaveLlmSettingsInput) -> String {
    let provider_id = normalize_provider_id(&input.provider_id);
    if provider_id != DEFAULT_PROVIDER_ID {
        return normalize_provider_kind(&provider_id, &input.provider_kind);
    }

    let (oauth_priority, api_key_priority) =
        normalize_openai_priorities(input.openai_oauth_priority, input.openai_api_key_priority);

    if input.openai_oauth_enabled
        && (!input.openai_api_key_enabled || oauth_priority < api_key_priority)
    {
        "oauth".to_string()
    } else {
        "api-key".to_string()
    }
}

#[tauri::command]
pub fn get_global_prompt(state: State<AppState>) -> Result<Option<String>, String> {
    state
        .open_connection()?
        .query_row(
            "SELECT global_prompt FROM app_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_global_prompt(state: State<AppState>, prompt: String) -> Result<(), String> {
    state
        .open_connection()?
        .execute(
            "INSERT INTO app_settings (id, global_prompt) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET global_prompt = excluded.global_prompt",
            [prompt],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_llm_settings(state: State<AppState>) -> Result<LlmSettingsPayload, String> {
    let connection = state.open_connection()?;
    debug!("loading llm settings");
    load_settings_for_editing(&connection)
}

#[tauri::command]
pub fn get_available_providers(
    state: State<AppState>,
) -> Result<Vec<AvailableProviderPayload>, String> {
    let connection = state.open_connection()?;
    load_available_providers(&connection)
}

#[tauri::command]
pub fn get_providers(state: State<AppState>) -> Result<Vec<ProviderPayload>, String> {
    let connection = state.open_connection()?;
    let providers = load_providers(&connection)?;
    Ok(providers.into_iter().map(to_provider_payload).collect())
}

#[tauri::command]
pub fn get_provider_credential(
    state: State<AppState>,
    input: GetProviderCredentialInput,
) -> Result<ProviderCredentialPayload, String> {
    let connection = state.open_connection()?;
    let provider_id = normalize_provider_id(&input.provider_id);
    let credential_type = normalize_provider_kind(&provider_id, &input.credential_type);
    let credential = if provider_id == DEFAULT_PROVIDER_ID && credential_type == "oauth" {
        resolve_oauth_credential(&connection)?
    } else {
        load_credential(&connection, &provider_id, &credential_type)?
    };

    Ok(ProviderCredentialPayload {
        provider_id: credential.provider_id,
        credential_type: credential.credential_type,
        base_url: credential.base_url,
        api_key: credential.api_key,
        access_token: credential.access_token,
        account_id: credential.account_id,
    })
}

#[tauri::command]
pub fn save_llm_settings(
    state: State<AppState>,
    input: SaveLlmSettingsInput,
) -> Result<LlmSettingsPayload, String> {
    let mut connection = state.open_connection()?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let settings = save_settings(&transaction, input)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(settings)
}

fn save_settings(
    connection: &rusqlite::Connection,
    input: SaveLlmSettingsInput,
) -> Result<LlmSettingsPayload, String> {
    let provider_id = normalize_provider_id(&input.provider_id);
    let provider_kind = resolve_preferred_provider_kind(&input);
    let model = normalize_text(&input.model).unwrap_or_default();
    let (openai_oauth_priority, openai_api_key_priority) =
        normalize_openai_priorities(input.openai_oauth_priority, input.openai_api_key_priority);

    // 주소가 바뀌면 이전 서버 키를 먼저 폐기하고 같은 트랜잭션에서 새 키를 저장합니다.
    if provider_id == "custom" {
        if let Some(api_url) = &input.api_url {
            save_provider_settings(
                connection,
                &provider_id,
                &provider_kind,
                None,
                api_url.trim(),
            )?;
        }
    }
    if let Some(key) = input.api_key {
        save_credential(
            connection,
            StoredProviderCredential {
                provider_id: provider_id.clone(),
                credential_type: "api-key".to_string(),
                api_key: normalize_text(&key),
                ..StoredProviderCredential::default()
            },
        )?;
    }

    save_selection(
        connection,
        &provider_id,
        &provider_kind,
        &model,
        input.openai_oauth_enabled,
        openai_oauth_priority,
        input.openai_api_key_enabled,
        openai_api_key_priority,
    )?;
    info!(
        provider_id = %provider_id,
        provider_kind = %provider_kind,
        model = %model,
        "llm settings saved"
    );
    load_settings_for_editing(connection)
}

#[tauri::command]
pub fn save_provider_settings_command(
    state: State<AppState>,
    input: SaveProviderSettingsInput,
) -> Result<ProviderSettingsPayload, String> {
    let mut db = state.open_connection()?;
    let connection = db.transaction().map_err(|error| error.to_string())?;
    let provider_id = normalize_provider_id(&input.provider_id);
    let provider_kind = normalize_provider_kind(&provider_id, &input.provider_kind);
    let name = input.name.and_then(|value| normalize_text(&value));
    let api_url = normalize_text(&input.api_url)
        .ok_or_else(|| "api_url은 비워둘 수 없습니다.".to_string())?;
    let settings = save_provider_settings(
        &connection,
        &provider_id,
        &provider_kind,
        name.as_deref(),
        &api_url,
    )?;
    let current = load_settings(&connection)?;

    if current.provider_id == provider_id && current.provider_kind == provider_kind {
        save_selection(
            &connection,
            &current.provider_id,
            &current.provider_kind,
            &current.model,
            current.openai_oauth_enabled,
            current.openai_oauth_priority,
            current.openai_api_key_enabled,
            current.openai_api_key_priority,
        )?;
    }

    info!(
        provider_id = %provider_id,
        provider_kind = %provider_kind,
        "provider settings saved"
    );

    connection.commit().map_err(|error| error.to_string())?;
    Ok(to_provider_settings_payload(settings))
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
        openai_oauth_enabled: settings.openai_oauth_enabled,
        openai_oauth_priority: settings.openai_oauth_priority,
        openai_api_key_enabled: settings.openai_api_key_enabled,
        openai_api_key_priority: settings.openai_api_key_priority,
    })
}

#[derive(Default)]
pub struct ChatgptLogin(Mutex<Option<LoginAttempt>>);

struct LoginAttempt {
    request: StartChatgptLoginPayload,
    result: Arc<OnceLock<Result<(), String>>>,
}

#[tauri::command]
pub fn begin_chatgpt_login(
    state: State<AppState>,
    login: State<ChatgptLogin>,
) -> Result<StartChatgptLoginPayload, String> {
    let mut active = login
        .0
        .lock()
        .map_err(|_| "로그인 상태를 읽지 못했습니다.")?;
    // 브라우저를 다시 열 때는 현재 리스너와 짝을 이루는 인증 주소를 돌려줍니다.
    if let Some(attempt) = active.as_ref() {
        if attempt.result.get().is_none() {
            return Ok(attempt.request.clone());
        }
    }
    let listener = TcpListener::bind(format!("127.0.0.1:{OAUTH_PORT}")).map_err(|error| {
        format!("ChatGPT 로그인용 로컬 포트 {OAUTH_PORT}를 열지 못했습니다. {error}")
    })?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;

    let redirect_uri = format!("http://localhost:{OAUTH_PORT}/auth/callback");
    let oauth = generate_oauth_codes();
    let state_code = generate_state();
    let request = StartChatgptLoginPayload {
        attempt_id: state_code.clone(),
        authorization_url: build_authorize_url(&redirect_uri, &oauth.challenge, &state_code),
    };
    let db_path = state.db_path.clone();
    let result = Arc::new(OnceLock::new());
    let worker_result = Arc::clone(&result);
    thread::Builder::new()
        .spawn(move || {
            let outcome =
                run_chatgpt_login_flow(listener, &redirect_uri, &oauth, &state_code, db_path);
            if let Err(error) = &outcome {
                error!("chatgpt oauth flow failed: {error}");
            }
            let _ = worker_result.set(outcome);
        })
        .map_err(|error| format!("ChatGPT 로그인 대기를 시작하지 못했습니다. {error}"))?;
    *active = Some(LoginAttempt {
        request: request.clone(),
        result,
    });
    Ok(request)
}

#[tauri::command]
pub fn get_chatgpt_login_status(
    login: State<ChatgptLogin>,
    attempt_id: String,
) -> Result<&'static str, String> {
    let active = login
        .0
        .lock()
        .map_err(|_| "로그인 상태를 읽지 못했습니다.")?;
    let attempt = active
        .as_ref()
        .filter(|attempt| attempt.request.attempt_id == attempt_id)
        .ok_or("이전 로그인 요청입니다. ChatGPT 로그인을 다시 시작해 주세요.")?;
    match attempt.result.get() {
        None => Ok("pending"),
        Some(Ok(())) => Ok("succeeded"),
        Some(Err(error)) => Err(error.clone()),
    }
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
    clear_credential(&connection, DEFAULT_PROVIDER_ID, "oauth")?;
    let current = load_settings(&connection)?;
    if current.provider_id == DEFAULT_PROVIDER_ID && current.provider_kind == "oauth" {
        save_selection(
            &connection,
            DEFAULT_PROVIDER_ID,
            "api-key",
            &current.model,
            current.openai_oauth_enabled,
            current.openai_oauth_priority,
            current.openai_api_key_enabled,
            current.openai_api_key_priority,
        )?;
    }
    load_settings_for_editing(&connection)
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
            .map_err(|error| format!("WSL에서 브라우저를 열지 못했습니다: {error}"))?;
        if status.success() {
            return Ok(());
        }
        return Err(format!(
            "브라우저 실행이 실패했습니다. 종료 코드: {:?}",
            status.code()
        ));
    }
    open::that(url)
        .map(|_| ())
        .map_err(|error| format!("외부 브라우저를 열지 못했습니다: {error}"))
}

fn run_chatgpt_login_flow(
    listener: TcpListener,
    redirect_uri: &str,
    oauth: &OAuthCodes,
    expected_state: &str,
    db_path: PathBuf,
) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(OAUTH_TIMEOUT_SECONDS);
    receive_chatgpt_callback(listener, expected_state, deadline, |code| {
        let tokens = exchange_code_for_tokens(code, redirect_uri, &oauth.verifier)?;
        AppState { db_path }
            .open_connection()
            .and_then(|mut db| store_chatgpt_login(&mut db, tokens))
            .map_err(|_| "OpenGem에 ChatGPT 로그인 정보를 저장하지 못했습니다.".to_string())
    })
}

fn receive_chatgpt_callback(
    listener: TcpListener,
    expected_state: &str,
    deadline: Instant,
    complete: impl FnOnce(&str) -> Result<(), String>,
) -> Result<(), String> {
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                // Windows에서는 연결된 소켓도 리스너의 논블로킹 모드를 상속합니다.
                stream.set_nonblocking(false).map_err(|e| e.to_string())?;
                stream
                    .set_write_timeout(Some(Duration::from_secs(2)))
                    .map_err(|e| e.to_string())?;
                let read_deadline = deadline.min(Instant::now() + Duration::from_secs(3));
                let Some(target) = read_callback_target(&mut stream, read_deadline) else {
                    continue;
                };
                let Some(code) = chatgpt_callback_code(&target, expected_state) else {
                    let _ = write_html(
                        &mut stream,
                        "404 Not Found",
                        "현재 진행 중인 OpenGem 로그인 요청이 아닙니다.",
                    );
                    continue;
                };
                let result = code.and_then(|code| complete(&code));
                // 브라우저가 먼저 닫혀도 이미 저장된 로그인 결과를 유지합니다.
                match &result {
                    Ok(()) => {
                        let _ = write_html(&mut stream, "200 OK", OAUTH_SUCCESS_HTML);
                    }
                    Err(message) => {
                        let _ =
                            write_html(&mut stream, "400 Bad Request", &oauth_error_html(message));
                    }
                }
                return result;
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(
                Duration::from_millis(50).min(deadline.saturating_duration_since(Instant::now())),
            ),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("ChatGPT 로그인 시간이 초과되었습니다.".to_string())
}

fn store_chatgpt_login(db: &mut rusqlite::Connection, tokens: TokenResponse) -> Result<(), String> {
    let connection = db.transaction().map_err(|error| error.to_string())?;
    let current = load_settings(&connection)?;
    let claims = extract_claims(
        tokens.id_token.as_deref(),
        Some(tokens.access_token.as_str()),
    );
    save_credential(
        &connection,
        StoredProviderCredential {
            provider_id: DEFAULT_PROVIDER_ID.to_string(),
            credential_type: "oauth".to_string(),
            access_token: Some(tokens.access_token),
            refresh_token: Some(tokens.refresh_token),
            expires_at: Some(now_millis()? + tokens.expires_in.unwrap_or(3600) * 1000),
            account_id: extract_account_id(claims.as_ref()),
            email: claims.and_then(|item| item.email),
            ..StoredProviderCredential::default()
        },
    )?;

    if current.provider_id == DEFAULT_PROVIDER_ID && current.provider_kind == "oauth" {
        save_selection(
            &connection,
            DEFAULT_PROVIDER_ID,
            "oauth",
            &current.model,
            current.openai_oauth_enabled,
            current.openai_oauth_priority,
            current.openai_api_key_enabled,
            current.openai_api_key_priority,
        )?;
    }
    connection.commit().map_err(|error| error.to_string())
}

fn read_callback_target(stream: &mut TcpStream, deadline: Instant) -> Option<String> {
    let mut request = Vec::new();
    let mut chunk = [0u8; 2048];
    // 헤더가 여러 TCP 패킷으로 나뉘거나 선연결 후 아무 요청이 오지 않을 수 있습니다.
    while request.len() < 16 * 1024 {
        let timeout = deadline.checked_duration_since(Instant::now())?;
        stream.set_read_timeout(Some(timeout)).ok()?;
        let size = stream.read(&mut chunk).ok()?;
        if size == 0 {
            return None;
        }
        request.extend_from_slice(&chunk[..size]);
        if request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
            let line = request.split(|byte| *byte == b'\n').next()?;
            let mut parts = std::str::from_utf8(line).ok()?.split_ascii_whitespace();
            if parts.next()? == "GET" {
                return parts.next().map(str::to_owned);
            }
            return None;
        }
    }
    None
}

fn chatgpt_callback_code(target: &str, expected_state: &str) -> Option<Result<String, String>> {
    let (path, query) = target.split_once('?')?;
    if path != "/auth/callback" {
        return None;
    }
    let params = url::form_urlencoded::parse(query.as_bytes());
    let (_, state) = params.clone().find(|(key, _)| key == "state")?;
    if state != expected_state {
        return None;
    }
    if let Some((_, error)) = params.clone().find(|(key, _)| key == "error") {
        return Some(Err(if error == "access_denied" {
            "ChatGPT 로그인이 취소되었습니다."
        } else {
            "OpenAI에서 로그인 요청을 승인하지 못했습니다."
        }
        .to_string()));
    }
    Some(
        params
            .into_iter()
            .find(|(key, _)| key == "code")
            .map(|(_, value)| value.into_owned())
            .filter(|code| !code.is_empty())
            .ok_or_else(|| "OpenAI 로그인 응답에 인증 코드가 없습니다.".to_string()),
    )
}

fn exchange_code_for_tokens(
    code: &str,
    redirect_uri: &str,
    verifier: &str,
) -> Result<TokenResponse, String> {
    Client::new()
        .post(format!("{OPENAI_ISSUER}/oauth/token"))
        .timeout(Duration::from_secs(30))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirect_uri),
            ("client_id", OPENAI_CLIENT_ID),
            ("code_verifier", verifier),
        ])
        .send()
        .map_err(|_| {
            "OpenAI 서버에 연결하지 못했습니다. 네트워크를 확인하고 다시 로그인해 주세요."
                .to_string()
        })?
        .error_for_status()
        .map_err(|error| {
            format!(
                "OpenAI가 인증 코드를 승인하지 않았습니다 (HTTP {}). 다시 로그인해 주세요.",
                error
                    .status()
                    .map(|status| status.as_u16())
                    .unwrap_or_default()
            )
        })?
        .json::<TokenResponse>()
        .map_err(|_| "OpenAI의 로그인 응답을 읽을 수 없습니다.".to_string())
}

fn refresh_access_token(refresh_token: &str) -> Result<TokenResponse, String> {
    Client::new()
        .post(format!("{OPENAI_ISSUER}/oauth/token"))
        .timeout(Duration::from_secs(8))
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
    let settings = load_settings(connection)?;
    if settings.provider_kind != "oauth" {
        return Ok(settings);
    }

    resolve_oauth_credential(connection)?;
    load_settings(connection)
}

pub(super) fn resolve_oauth_credential(
    connection: &rusqlite::Connection,
) -> Result<StoredProviderCredential, String> {
    // 모델 조회와 대화가 동시에 시작되어도 회전되는 갱신 토큰은 한 번만 사용합니다.
    static REFRESH: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = REFRESH
        .lock()
        .map_err(|_| "OAuth 갱신 상태를 확인할 수 없습니다.")?;
    resolve_oauth_credential_with(connection, refresh_access_token)
}

fn resolve_oauth_credential_with(
    connection: &rusqlite::Connection,
    refresh: impl FnOnce(&str) -> Result<TokenResponse, String>,
) -> Result<StoredProviderCredential, String> {
    // 전역 모델 선택과 무관하게 OpenAI OAuth 자격 증명만 확인합니다.
    let mut credential = load_credential(connection, DEFAULT_PROVIDER_ID, "oauth")?;

    let refresh_token = credential
        .refresh_token
        .clone()
        .ok_or_else(|| "ChatGPT 로그인이 필요합니다.".to_string())?;
    let now = now_millis()?;
    if credential.access_token.is_none() || credential.expires_at.unwrap_or(0) <= now + 60_000 {
        let tokens = refresh(&refresh_token)?;
        let claims = extract_claims(
            tokens.id_token.as_deref(),
            Some(tokens.access_token.as_str()),
        );
        credential = StoredProviderCredential {
            provider_id: DEFAULT_PROVIDER_ID.to_string(),
            credential_type: "oauth".to_string(),
            access_token: Some(tokens.access_token),
            refresh_token: Some(tokens.refresh_token),
            expires_at: Some(now + tokens.expires_in.unwrap_or(3600) * 1000),
            account_id: extract_account_id(claims.as_ref()).or(credential.account_id),
            email: claims.and_then(|item| item.email).or(credential.email),
            ..StoredProviderCredential::default()
        };
        save_refreshed_oauth_credential(connection, &refresh_token, &credential)?;
    }
    Ok(credential)
}

fn load_settings_for_editing(
    connection: &rusqlite::Connection,
) -> Result<LlmSettingsPayload, String> {
    let settings = load_settings(connection)?;
    // OAuth가 우선인 경우에도 설정 양식은 별도로 저장해 둔 API 키를 편집합니다.
    let api_key =
        if settings.provider_id == DEFAULT_PROVIDER_ID && settings.provider_kind == "oauth" {
            load_credential(connection, DEFAULT_PROVIDER_ID, "api-key")?.api_key
        } else {
            settings.api_key
        };
    Ok(LlmSettingsPayload {
        provider_id: settings.provider_id,
        provider_kind: settings.provider_kind,
        base_url: settings.base_url,
        model: settings.model,
        api_key,
        logged_in: settings.logged_in,
        email: settings.email,
        openai_oauth_enabled: settings.openai_oauth_enabled,
        openai_oauth_priority: settings.openai_oauth_priority,
        openai_api_key_enabled: settings.openai_api_key_enabled,
        openai_api_key_priority: settings.openai_api_key_priority,
    })
}

fn to_provider_settings_payload(settings: StoredProviderSettings) -> ProviderSettingsPayload {
    ProviderSettingsPayload {
        id: settings.id,
        provider_id: settings.provider_id,
        provider_kind: settings.credential_type,
        name: settings.name,
        api_url: settings.api_url,
    }
}

fn to_provider_payload(provider: StoredProvider) -> ProviderPayload {
    ProviderPayload {
        key: provider.key,
        label: provider.label,
        protocol: provider.protocol,
    }
}

fn normalize_provider_id(value: &str) -> String {
    match value.trim() {
        "anthropic" | "google" | "openrouter" | "custom" => value.trim().to_string(),
        "custom_openai" => "custom".to_string(),
        "" | "openai" | "chatgpt" => DEFAULT_PROVIDER_ID.to_string(),
        _ => DEFAULT_PROVIDER_ID.to_string(),
    }
}

fn normalize_provider_kind(provider_id: &str, value: &str) -> String {
    if provider_id == DEFAULT_PROVIDER_ID && value == "oauth" {
        return "oauth".to_string();
    }
    "api-key".to_string()
}

fn normalize_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
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

fn write_html(stream: &mut TcpStream, status: &str, html: &str) -> Result<(), String> {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{}",
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

const OAUTH_SUCCESS_HTML: &str = r#"<!doctype html><html><head><meta charset="utf-8" /><title>OpenGem 로그인 완료</title></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#e2e8f0;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;"><main style="max-width:420px;padding:32px;border-radius:20px;background:rgba(15,23,42,.9);border:1px solid rgba(148,163,184,.2);text-align:center;"><h1 style="margin:0 0 12px;font-size:24px;">로그인 완료</h1><p style="margin:0;color:#cbd5e1;">이 창을 닫고 OpenGem으로 돌아가면 됩니다.</p></main><script>setTimeout(() => window.close(), 1800)</script></body></html>"#;

fn oauth_error_html(message: &str) -> String {
    format!("<!doctype html><html><head><meta charset=\"utf-8\" /><title>OpenGem 로그인 실패</title></head><body style=\"margin:0;min-height:100vh;display:grid;place-items:center;background:#111827;color:#f8fafc;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;\"><main style=\"max-width:440px;padding:32px;border-radius:20px;background:rgba(17,24,39,.92);border:1px solid rgba(248,113,113,.28);text-align:center;\"><h1 style=\"margin:0 0 12px;font-size:24px;color:#fca5a5;\">로그인 실패</h1><p style=\"margin:0;color:#d1d5db;\">{message}</p></main></body></html>")
}

#[cfg(test)]
mod oauth_credential_tests {
    use super::*;
    use crate::migrations::run_migrations;

    fn callback_listener() -> (TcpListener, std::net::SocketAddr) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        (listener, address)
    }

    fn callback_response(address: std::net::SocketAddr, target: &str) -> String {
        let mut socket = TcpStream::connect(address).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        write!(socket, "GET {target} HTTP/1.1\r\nHost: localhost\r\n\r\n").unwrap();
        let mut response = String::new();
        socket.read_to_string(&mut response).unwrap();
        response
    }

    fn login_tokens() -> TokenResponse {
        TokenResponse {
            access_token: "test-access".into(),
            refresh_token: "test-refresh".into(),
            id_token: None,
            expires_in: Some(3600),
        }
    }

    #[test]
    fn callback_ignores_unrelated_connections_and_saves_after_fragmented_request() {
        let (listener, address) = callback_listener();
        let worker = thread::spawn(move || {
            let mut db = rusqlite::Connection::open_in_memory().unwrap();
            run_migrations(&mut db).unwrap();
            let deadline = Instant::now() + Duration::from_secs(10);
            receive_chatgpt_callback(listener, "active", deadline, |code| {
                assert_eq!(code, "test+code");
                store_chatgpt_login(&mut db, login_tokens())
            })
            .unwrap();
            assert!(load_settings_for_editing(&db).unwrap().logged_in);
        });
        drop(TcpStream::connect(address).unwrap());
        for target in [
            "/favicon.ico",
            "/auth/callback?error=access_denied&state=old",
        ] {
            assert!(callback_response(address, target).starts_with("HTTP/1.1 404"));
        }
        let mut socket = TcpStream::connect(address).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        socket
            .write_all(b"GET /auth/callback?code=test%2B")
            .unwrap();
        thread::sleep(Duration::from_millis(150));
        socket
            .write_all(b"code&state=active HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .unwrap();
        let mut response = String::new();
        socket.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 200"));
        worker.join().unwrap();
    }

    #[test]
    fn callback_reports_exchange_and_storage_failures_to_the_browser() {
        for exchange_fails in [true, false] {
            let (listener, address) = callback_listener();
            let worker = thread::spawn(move || {
                let deadline = Instant::now() + Duration::from_secs(5);
                receive_chatgpt_callback(listener, "active", deadline, |_| {
                    if exchange_fails {
                        return Err("인증 코드 교환 실패".into());
                    }
                    let mut db = rusqlite::Connection::open_in_memory().unwrap();
                    store_chatgpt_login(&mut db, login_tokens())
                        .map_err(|_| "로그인 정보 저장 실패".into())
                })
            });
            let response = callback_response(address, "/auth/callback?code=test-code&state=active");
            let error = worker.join().unwrap().unwrap_err();
            assert!(response.starts_with("HTTP/1.1 400"));
            assert!(response.contains(&error));
            assert!(!response.contains("test-code"));
        }
    }

    #[test]
    fn callback_times_out_with_an_idle_client() {
        let (listener, address) = callback_listener();
        let _socket = TcpStream::connect(address).unwrap();
        let deadline = Instant::now() + Duration::from_millis(100);
        let error = receive_chatgpt_callback(listener, "state", deadline, |_| {
            panic!("빈 연결은 인증 코드를 교환하지 않아야 합니다")
        })
        .unwrap_err();
        assert!(error.contains("초과"));
    }

    #[test]
    fn custom_server_keys_follow_their_origin_when_settings_are_saved() {
        let mut db = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut db).unwrap();
        let mut save = |url: &str, key: Option<&str>| {
            let transaction = db.transaction().unwrap();
            let settings = save_settings(
                &transaction,
                SaveLlmSettingsInput {
                    provider_id: "custom".into(),
                    provider_kind: "api-key".into(),
                    api_url: Some(url.into()),
                    model: "local".into(),
                    api_key: key.map(str::to_owned),
                    openai_oauth_enabled: true,
                    openai_oauth_priority: 1,
                    openai_api_key_enabled: true,
                    openai_api_key_priority: 2,
                },
            )?;
            transaction.commit().unwrap();
            Ok::<_, String>(settings.api_key)
        };
        let server = "https://a.example/v1";
        assert_eq!(
            save(server, Some("key-a")).unwrap().as_deref(),
            Some("key-a")
        );
        assert_eq!(
            save("https://A.example:443/v2", None).unwrap().as_deref(),
            Some("key-a")
        );
        assert!(save("not-a-url", Some("invalid")).is_err());
        assert_eq!(save(server, None).unwrap().as_deref(), Some("key-a"));
        assert!(save("https://b.example/v1", None).unwrap().is_none());
        assert_eq!(
            save(server, Some("replacement")).unwrap().as_deref(),
            Some("replacement")
        );
        assert!(save("https://a.example:1443/v1", None).unwrap().is_none());
    }

    #[test]
    fn delayed_refresh_cannot_restore_a_logged_out_or_replaced_account() {
        let mut db = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut db).unwrap();
        let oauth = |token: &str| StoredProviderCredential {
            provider_id: "openai".into(),
            credential_type: "oauth".into(),
            refresh_token: Some(token.into()),
            ..StoredProviderCredential::default()
        };
        for replacement in [None, Some("new-login")] {
            save_credential(&db, oauth("old-login")).unwrap();
            let result = resolve_oauth_credential_with(&db, |_| {
                match replacement {
                    Some(token) => save_credential(&db, oauth(token)).unwrap(),
                    None => clear_credential(&db, "openai", "oauth").unwrap(),
                }
                Ok(TokenResponse {
                    access_token: "stale-access".into(),
                    refresh_token: "stale-refresh".into(),
                    expires_in: Some(3600),
                    id_token: None,
                })
            });
            assert!(result.is_err());
            let stored = load_credential(&db, "openai", "oauth").unwrap();
            assert_eq!(stored.refresh_token.as_deref(), replacement);
            assert!(stored.access_token.is_none());
        }
    }

    #[test]
    fn disabled_credentials_stay_connected_and_are_excluded_from_model_queries() {
        let mut db = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut db).unwrap();
        save_credential(
            &db,
            StoredProviderCredential {
                provider_id: "openai".into(),
                credential_type: "oauth".into(),
                refresh_token: Some("test-refresh".into()),
                ..StoredProviderCredential::default()
            },
        )
        .unwrap();
        save_selection(&db, "openai", "oauth", "test", false, 2, true, 1).unwrap();
        let connections = load_available_providers(&db).unwrap();
        assert_eq!(connections.len(), 1);
        assert!(connections[0].logged_in);
        assert!(connections[0].credential_types.is_empty());
    }

    #[test]
    fn editing_oauth_settings_preserves_the_separate_key_until_explicitly_cleared() {
        let mut db = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut db).unwrap();
        assert_eq!(load_settings(&db).unwrap().model, "gpt-5.4-mini");
        save_credential(
            &db,
            StoredProviderCredential {
                provider_id: "openai".into(),
                credential_type: "oauth".into(),
                access_token: Some("test-oauth".into()),
                refresh_token: Some("test-refresh".into()),
                expires_at: Some(i64::MAX),
                ..StoredProviderCredential::default()
            },
        )
        .unwrap();
        let input = |key: Option<&str>| SaveLlmSettingsInput {
            provider_id: "openai".into(),
            provider_kind: "oauth".into(),
            api_url: None,
            model: String::new(),
            api_key: key.map(str::to_owned),
            openai_oauth_enabled: true,
            openai_oauth_priority: 1,
            openai_api_key_enabled: true,
            openai_api_key_priority: 2,
        };
        save_settings(&db, input(Some("test-api-key"))).unwrap();
        let editing = save_settings(&db, input(None)).unwrap();
        assert_eq!(editing.api_key.as_deref(), Some("test-api-key"));
        assert_eq!(editing.model, "gpt-6.1-sol");
        let runtime = resolve_settings(&db).unwrap();
        assert_eq!(runtime.access_token.as_deref(), Some("test-oauth"));
        assert!(runtime.api_key.is_none());
        assert!(save_settings(&db, input(Some("")))
            .unwrap()
            .api_key
            .is_none());
        assert!(load_credential(&db, "openai", "api-key")
            .unwrap()
            .api_key
            .is_none());
        let mut legacy = input(None);
        legacy.model = "gpt-4o-mini".into();
        assert_eq!(save_settings(&db, legacy).unwrap().model, "gpt-4o-mini");
    }

    #[test]
    fn refreshes_openai_credentials_without_changing_selected_provider() {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut connection).unwrap();
        save_selection(
            &connection,
            "anthropic",
            "api-key",
            "example-model",
            false,
            1,
            true,
            2,
        )
        .unwrap();
        save_credential(
            &connection,
            StoredProviderCredential {
                provider_id: "openai".to_string(),
                credential_type: "oauth".to_string(),
                access_token: Some("old-test-value".to_string()),
                refresh_token: Some("test-refresh-value".to_string()),
                expires_at: Some(1),
                account_id: Some("test-account".to_string()),
                ..StoredProviderCredential::default()
            },
        )
        .unwrap();

        let resolved = resolve_oauth_credential_with(&connection, |value| {
            assert!(value == "test-refresh-value");
            Ok(TokenResponse {
                access_token: "new-test-value".to_string(),
                refresh_token: "rotated-test-value".to_string(),
                expires_in: Some(3600),
                id_token: None,
            })
        })
        .unwrap();
        assert!(resolved.access_token.as_deref() == Some("new-test-value"));
        let saved = load_credential(&connection, "openai", "oauth").unwrap();
        assert!(saved.refresh_token.as_deref() == Some("rotated-test-value"));
        assert!(saved.account_id.as_deref() == Some("test-account"));
        assert_eq!(load_settings(&connection).unwrap().provider_id, "anthropic");
        resolve_oauth_credential_with(&connection, |_| {
            panic!("유효한 토큰은 갱신하지 않아야 합니다")
        })
        .unwrap();
    }

    #[test]
    fn refresh_failure_is_returned() {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut connection).unwrap();
        save_credential(
            &connection,
            StoredProviderCredential {
                provider_id: "openai".to_string(),
                credential_type: "oauth".to_string(),
                refresh_token: Some("test-refresh-value".to_string()),
                ..StoredProviderCredential::default()
            },
        )
        .unwrap();
        assert!(
            resolve_oauth_credential_with(&connection, |_| Err("refresh failed".to_string()))
                .is_err()
        );
    }
}
