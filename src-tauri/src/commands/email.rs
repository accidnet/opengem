use crate::app_state::AppState;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{distributions::Alphanumeric, Rng};
use reqwest::blocking::{Client, Response};
use rusqlite::{params, Connection};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, OnceLock},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::State;
use url::Url;

const GMAIL_SCOPE: &str = "https://www.googleapis.com/auth/gmail.readonly";
const SETUP_REQUIRED: &str = "전체 설정 > 이메일에서 Gmail을 연결해 주세요.";
const BODY_LIMIT: usize = 8_000;
const RESPONSE_LIMIT: u64 = 2 * 1024 * 1024;
const RESPONSE_TOO_LARGE: &str = "메일 응답이 처리 한도를 초과했습니다.";
static RUNTIME: OnceLock<Mutex<HashMap<PathBuf, EmailRuntime>>> = OnceLock::new();

#[derive(Default)]
struct EmailRuntime {
    generation: u64,
    login_pending: bool,
    last_error: Option<String>,
    access: Option<AccessToken>,
}

#[derive(Clone)]
struct AccessToken {
    value: String,
    expires_at: i64,
}

#[derive(Default, Serialize, Deserialize)]
struct Secrets {
    client_secret: String,
    refresh_token: Option<String>,
}

struct Settings {
    client_id: String,
    credential_key: String,
    email: Option<String>,
    connected: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSettingsPayload {
    provider: &'static str,
    client_id: String,
    has_client_secret: bool,
    connected: bool,
    email: Option<String>,
    login_pending: bool,
    last_error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEmailSettingsInput {
    client_id: String,
    client_secret: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailLoginPayload {
    authorization_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchEmailInput {
    since: i64,
    until: Option<i64>,
    page_token: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailMessage {
    id: String,
    thread_id: String,
    from: String,
    subject: String,
    body: String,
    received_at: i64,
    url: String,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailBatch {
    messages: Vec<EmailMessage>,
    since: i64,
    until: i64,
    next_page_token: Option<String>,
    account_email: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    scope: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GmailProfile {
    email_address: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GmailList {
    #[serde(default)]
    messages: Vec<GmailMessage>,
    next_page_token: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GmailMessage {
    id: String,
    #[serde(default)]
    thread_id: String,
    #[serde(default)]
    internal_date: String,
    #[serde(default)]
    snippet: String,
    #[serde(default)]
    payload: MimePart,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct MimePart {
    #[serde(default)]
    mime_type: String,
    #[serde(default)]
    filename: String,
    #[serde(default)]
    headers: Vec<MimeHeader>,
    #[serde(default)]
    body: MimeBody,
    #[serde(default)]
    parts: Vec<MimePart>,
}

#[derive(Deserialize)]
struct MimeHeader {
    name: String,
    value: String,
}

#[derive(Deserialize, Default)]
struct MimeBody {
    #[serde(default)]
    data: String,
}

fn runtime() -> Result<MutexGuard<'static, HashMap<PathBuf, EmailRuntime>>, String> {
    RUNTIME
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "이메일 연결 상태에 접근하지 못했습니다. 앱을 다시 시작해 주세요.".to_string())
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn connection(path: &Path) -> Result<Connection, String> {
    let db = Connection::open(path).map_err(|error| error.to_string())?;
    db.busy_timeout(Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    Ok(db)
}

fn load_settings(db: &Connection) -> Result<Settings, String> {
    db.query_row(
        "SELECT client_id, credential_key, email, connected FROM email_connection_settings WHERE id=1",
        [],
        |row| Ok(Settings { client_id: row.get(0)?, credential_key: row.get(1)?, email: row.get(2)?, connected: row.get::<_,i64>(3)? != 0 }),
    ).map_err(|error| error.to_string())
}

fn secret_entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("opengem.gmail", key)
        .map_err(|_| "운영체제 자격 증명 저장소를 열지 못했습니다.".to_string())
}

fn load_secrets(key: &str) -> Result<Secrets, String> {
    if key.is_empty() {
        return Ok(Secrets::default());
    }
    match secret_entry(key)?.get_password() {
        Ok(value) => serde_json::from_str(&value).map_err(|_| {
            "저장된 Gmail 자격 증명을 읽지 못했습니다. 다시 연결해 주세요.".to_string()
        }),
        Err(keyring::Error::NoEntry) => Ok(Secrets::default()),
        Err(_) => Err("운영체제 자격 증명 저장소가 잠겨 있거나 사용할 수 없습니다.".to_string()),
    }
}

fn save_secrets(key: &str, secrets: &Secrets) -> Result<(), String> {
    let value = serde_json::to_string(secrets)
        .map_err(|_| "Gmail 자격 증명을 준비하지 못했습니다.".to_string())?;
    secret_entry(key)?.set_password(&value).map_err(|_| {
        "운영체제 자격 증명 저장소에 저장하지 못했습니다. 저장소 잠금을 확인해 주세요.".to_string()
    })
}

fn settings_payload(path: &Path) -> Result<EmailSettingsPayload, String> {
    let db = connection(path)?;
    let settings = load_settings(&db)?;
    let mut runtime = runtime()?;
    let status = runtime.entry(path.to_path_buf()).or_default();
    let secrets = load_secrets(&settings.credential_key);
    let has_client_secret = secrets
        .as_ref()
        .is_ok_and(|value| !value.client_secret.is_empty());
    let connected = settings.connected
        && secrets
            .as_ref()
            .is_ok_and(|value| value.refresh_token.is_some());
    let last_error = status
        .last_error
        .clone()
        .or_else(|| secrets.err())
        .or_else(|| {
            if settings.connected && !connected {
                Some(SETUP_REQUIRED.to_string())
            } else {
                None
            }
        });
    Ok(EmailSettingsPayload {
        provider: "gmail",
        client_id: settings.client_id,
        has_client_secret,
        connected,
        email: settings.email,
        login_pending: status.login_pending,
        last_error,
    })
}

#[tauri::command]
pub fn get_email_settings(state: State<AppState>) -> Result<EmailSettingsPayload, String> {
    settings_payload(&state.db_path)
}

#[tauri::command]
pub fn save_email_settings(
    state: State<AppState>,
    input: SaveEmailSettingsInput,
) -> Result<EmailSettingsPayload, String> {
    let client_id = input.client_id.trim();
    if !client_id.ends_with(".apps.googleusercontent.com")
        || client_id.len() > 256
        || client_id.chars().any(char::is_whitespace)
    {
        return Err(
            "Google Cloud에서 만든 데스크톱 앱 OAuth 클라이언트 ID를 입력해 주세요.".to_string(),
        );
    }
    let secret = input.client_secret.unwrap_or_default().trim().to_string();
    if secret.len() > 512 {
        return Err("클라이언트 보안 비밀번호가 너무 깁니다.".to_string());
    }
    {
        // 설정 변경과 로그인 완료가 교차해도 이전 계정의 토큰을 되살리지 않습니다.
        let mut runtime = runtime()?;
        let status = runtime.entry(state.db_path.clone()).or_default();
        let db = connection(&state.db_path)?;
        let current = load_settings(&db)?;
        let same_client = current.client_id == client_id;
        let mut secrets = load_secrets(&current.credential_key)?;
        let changed = !same_client || (!secret.is_empty() && secret != secrets.client_secret);
        if !same_client {
            secrets = Secrets::default();
        }
        if !secret.is_empty() {
            secrets.client_secret = secret;
        }
        if secrets.client_secret.is_empty() {
            return Err("데스크톱 앱 OAuth 클라이언트 보안 비밀번호를 입력해 주세요.".to_string());
        }
        if changed {
            secrets.refresh_token = None;
        }
        let key = if current.credential_key.is_empty() {
            random_string(32)
        } else {
            current.credential_key
        };
        save_secrets(&key, &secrets)?;
        db.execute("UPDATE email_connection_settings SET client_id=?1, credential_key=?2, connected=CASE WHEN ?3 THEN 0 ELSE connected END, email=CASE WHEN ?3 THEN NULL ELSE email END, updated_at=?4 WHERE id=1", params![client_id,key,changed,now_millis()]).map_err(|error|error.to_string())?;
        status.generation = status.generation.wrapping_add(1);
        status.login_pending = false;
        status.last_error = None;
        if changed {
            status.access = None;
        }
    }
    settings_payload(&state.db_path)
}

#[tauri::command]
pub fn begin_email_login(state: State<AppState>) -> Result<EmailLoginPayload, String> {
    let mut guard = runtime()?;
    let db = connection(&state.db_path)?;
    let settings = load_settings(&db)?;
    let secrets = load_secrets(&settings.credential_key)?;
    if settings.client_id.is_empty() || secrets.client_secret.is_empty() {
        return Err(SETUP_REQUIRED.to_string());
    }
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|_| "Gmail 로그인용 로컬 포트를 열지 못했습니다.".to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/oauth/callback");
    let verifier = random_string(96);
    let expected_state = random_string(48);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let authorization_url = authorize_url(
        &settings.client_id,
        &redirect_uri,
        &challenge,
        &expected_state,
    );
    let generation = {
        let status = guard.entry(state.db_path.clone()).or_default();
        status.generation = status.generation.wrapping_add(1);
        status.login_pending = true;
        status.last_error = None;
        status.generation
    };
    drop(guard);
    let path = state.db_path.clone();
    thread::spawn(move || {
        let result = login_flow(
            &path,
            generation,
            listener,
            &settings,
            &secrets.client_secret,
            &redirect_uri,
            &verifier,
            &expected_state,
        );
        if let Ok(mut runtime) = runtime() {
            let status = runtime.entry(path).or_default();
            if status.generation == generation {
                status.login_pending = false;
                status.last_error = result.err();
            }
        }
    });
    Ok(EmailLoginPayload { authorization_url })
}

#[tauri::command]
pub fn cancel_email_login(state: State<AppState>) -> Result<EmailSettingsPayload, String> {
    {
        let mut runtime = runtime()?;
        let status = runtime.entry(state.db_path.clone()).or_default();
        status.generation = status.generation.wrapping_add(1);
        status.login_pending = false;
        status.last_error = None;
    }
    settings_payload(&state.db_path)
}

#[tauri::command]
pub fn disconnect_email(state: State<AppState>) -> Result<EmailSettingsPayload, String> {
    {
        let mut runtime = runtime()?;
        let status = runtime.entry(state.db_path.clone()).or_default();
        status.generation = status.generation.wrapping_add(1);
        status.login_pending = false;
        status.last_error = None;
        status.access = None;
        let db = connection(&state.db_path)?;
        let settings = load_settings(&db)?;
        // 연결 상태를 먼저 해제해 저장소 오류 시에도 후속 읽기를 중단합니다.
        db.execute(
            "UPDATE email_connection_settings SET connected=0,email=NULL,updated_at=?1 WHERE id=1",
            [now_millis()],
        )
        .map_err(|error| error.to_string())?;
        if !settings.credential_key.is_empty() {
            let mut secrets = load_secrets(&settings.credential_key)?;
            secrets.refresh_token = None;
            save_secrets(&settings.credential_key, &secrets)?;
        }
    }
    settings_payload(&state.db_path)
}

fn random_string(length: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(length)
        .map(char::from)
        .collect()
}

fn authorize_url(client_id: &str, redirect: &str, challenge: &str, state: &str) -> String {
    let mut url =
        Url::parse("https://accounts.google.com/o/oauth2/v2/auth").expect("fixed OAuth URL");
    url.query_pairs_mut().extend_pairs([
        ("client_id", client_id),
        ("redirect_uri", redirect),
        ("response_type", "code"),
        ("scope", GMAIL_SCOPE),
        ("access_type", "offline"),
        ("prompt", "consent"),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
        ("state", state),
    ]);
    url.to_string()
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Gmail 연결을 준비하지 못했습니다.".to_string())
}

fn decode_response<T: DeserializeOwned>(response: Response) -> Result<T, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            400 | 401 => "Gmail 인증이 만료되었거나 요청이 유효하지 않습니다. 전체 설정 > 이메일에서 다시 연결해 주세요.".to_string(),
            403 => "Gmail 읽기 권한과 Google Cloud의 Gmail API 사용 설정을 확인해 주세요.".to_string(),
            429 => "Gmail 요청 한도에 도달했습니다. 잠시 후 다시 시도합니다.".to_string(),
            code => format!("Gmail 요청에 실패했습니다 (HTTP {code}). 잠시 후 다시 시도해 주세요."),
        });
    }
    let mut bytes = Vec::new();
    response
        .take(RESPONSE_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Gmail 응답을 읽지 못했습니다.".to_string())?;
    if bytes.len() as u64 > RESPONSE_LIMIT {
        return Err(RESPONSE_TOO_LARGE.to_string());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Gmail 응답 형식을 확인하지 못했습니다.".to_string())
}

fn check_generation(path: &Path, generation: u64) -> Result<(), String> {
    let runtime = runtime()?;
    if runtime.get(path).map(|item| item.generation) != Some(generation) {
        Err("이메일 연결이 변경되어 진행 중인 작업을 중단했습니다.".to_string())
    } else {
        Ok(())
    }
}

fn callback_code(target: &str, expected_state: &str) -> Result<Option<String>, String> {
    let url = Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| "로그인 응답이 잘못되었습니다.".to_string())?;
    if url.path() != "/oauth/callback" {
        return Ok(None);
    }
    let values: HashMap<_, _> = url.query_pairs().into_owned().collect();
    if values.get("state").map(String::as_str) != Some(expected_state) {
        return Ok(None);
    }
    if values.contains_key("error") {
        return Err(
            "Gmail 연결이 취소되었거나 Google에서 거절했습니다. 다시 연결해 주세요.".to_string(),
        );
    }
    values
        .get("code")
        .filter(|value| !value.is_empty())
        .cloned()
        .map(Some)
        .ok_or_else(|| "로그인 인증 코드가 없습니다.".to_string())
}

fn respond(stream: &mut TcpStream, success: bool) {
    let message = if success {
        "Gmail 연결이 완료되었습니다. 이 창을 닫고 OpenGem으로 돌아가세요."
    } else {
        "이 로그인 요청을 처리하지 못했습니다. OpenGem에서 연결 상태를 확인해 주세요."
    };
    let body = format!("<!doctype html><html lang=\"ko\"><meta charset=\"utf-8\"><title>OpenGem Gmail</title><p>{message}</p></html>");
    let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let _ = stream.write_all(response.as_bytes());
}

#[allow(clippy::too_many_arguments)]
fn login_flow(
    path: &Path,
    generation: u64,
    listener: TcpListener,
    settings: &Settings,
    client_secret: &str,
    redirect: &str,
    verifier: &str,
    expected_state: &str,
) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        check_generation(path, generation)?;
        if Instant::now() >= deadline {
            return Err("Gmail 로그인 시간이 초과되었습니다. 다시 연결해 주세요.".to_string());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .map_err(|error| error.to_string())?;
                let mut buffer = [0u8; 8192];
                let Ok(length) = stream.read(&mut buffer) else {
                    continue;
                };
                let request = String::from_utf8_lossy(&buffer[..length]);
                let Some(line) = request.lines().next() else {
                    continue;
                };
                let mut fields = line.split_whitespace();
                if fields.next() != Some("GET") {
                    respond(&mut stream, false);
                    continue;
                }
                let target = fields.next().unwrap_or("");
                let code = match callback_code(target, expected_state) {
                    Ok(Some(code)) => code,
                    Ok(None) => {
                        respond(&mut stream, false);
                        continue;
                    }
                    Err(error) => {
                        respond(&mut stream, false);
                        return Err(error);
                    }
                };
                let result = finish_login(
                    path,
                    generation,
                    settings,
                    client_secret,
                    redirect,
                    verifier,
                    &code,
                );
                respond(&mut stream, result.is_ok());
                return result;
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(150))
            }
            Err(_) => return Err("Gmail 로그인 응답을 받지 못했습니다.".to_string()),
        }
    }
}

fn finish_login(
    path: &Path,
    generation: u64,
    settings: &Settings,
    client_secret: &str,
    redirect: &str,
    verifier: &str,
    code: &str,
) -> Result<(), String> {
    let client = http_client()?;
    let tokens: TokenResponse = decode_response(
        client
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("client_id", settings.client_id.as_str()),
                ("client_secret", client_secret),
                ("code", code),
                ("code_verifier", verifier),
                ("redirect_uri", redirect),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .map_err(|_| "Google 인증 서버에 연결하지 못했습니다.".to_string())?,
    )?;
    if tokens
        .scope
        .as_ref()
        .is_some_and(|scope| !scope.split_whitespace().any(|value| value == GMAIL_SCOPE))
    {
        return Err("Gmail 읽기 권한이 허용되지 않았습니다. 다시 연결해 주세요.".to_string());
    }
    let refresh_token = tokens
        .refresh_token
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "주기적 확인에 필요한 Gmail 재인증 권한을 받지 못했습니다. 다시 연결해 주세요."
                .to_string()
        })?;
    let profile: GmailProfile = decode_response(
        client
            .get("https://gmail.googleapis.com/gmail/v1/users/me/profile")
            .bearer_auth(&tokens.access_token)
            .send()
            .map_err(|_| "Gmail 계정 정보를 확인하지 못했습니다.".to_string())?,
    )?;
    let mut runtime = runtime()?;
    let status = runtime.entry(path.to_path_buf()).or_default();
    if status.generation != generation {
        return Err("취소되거나 변경된 Gmail 로그인입니다.".to_string());
    }
    let db = connection(path)?;
    let current = load_settings(&db)?;
    if current.client_id != settings.client_id || current.credential_key != settings.credential_key
    {
        return Err("Gmail 설정이 변경되었습니다. 다시 연결해 주세요.".to_string());
    }
    save_secrets(
        &settings.credential_key,
        &Secrets {
            client_secret: client_secret.to_string(),
            refresh_token: Some(refresh_token),
        },
    )?;
    db.execute(
        "UPDATE email_connection_settings SET connected=1,email=?1,updated_at=?2 WHERE id=1",
        params![profile.email_address, now_millis()],
    )
    .map_err(|error| error.to_string())?;
    status.access = Some(AccessToken {
        value: tokens.access_token,
        expires_at: now_millis() + tokens.expires_in.unwrap_or(3600).clamp(60, 86_400) * 1000,
    });
    Ok(())
}

fn resolve_access(path: &Path) -> Result<(String, String, u64), String> {
    let mut guard = runtime()?;
    let db = connection(path)?;
    let settings = load_settings(&db)?;
    if !settings.connected {
        return Err(SETUP_REQUIRED.to_string());
    }
    let (generation, cached) = {
        let status = guard.entry(path.to_path_buf()).or_default();
        (status.generation, status.access.clone())
    };
    drop(guard);
    let email = settings
        .email
        .clone()
        .ok_or_else(|| SETUP_REQUIRED.to_string())?;
    if let Some(access) = cached.filter(|token| token.expires_at > now_millis() + 60_000) {
        return Ok((access.value, email, generation));
    }
    let mut secrets = load_secrets(&settings.credential_key)?;
    let refresh = secrets
        .refresh_token
        .as_deref()
        .ok_or_else(|| SETUP_REQUIRED.to_string())?;
    let tokens: TokenResponse = decode_response(
        http_client()?
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("client_id", settings.client_id.as_str()),
                ("client_secret", secrets.client_secret.as_str()),
                ("refresh_token", refresh),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .map_err(|_| {
                "Gmail 인증을 갱신하지 못했습니다. 네트워크를 확인해 주세요.".to_string()
            })?,
    )?;
    let mut runtime = runtime()?;
    let status = runtime.entry(path.to_path_buf()).or_default();
    if status.generation != generation {
        return Err("이메일 연결이 변경되었습니다. 다시 시도해 주세요.".to_string());
    }
    if let Some(refresh) = tokens.refresh_token {
        secrets.refresh_token = Some(refresh);
        save_secrets(&settings.credential_key, &secrets)?;
    }
    status.access = Some(AccessToken {
        value: tokens.access_token.clone(),
        expires_at: now_millis() + tokens.expires_in.unwrap_or(3600).clamp(60, 86_400) * 1000,
    });
    Ok((tokens.access_token, email, generation))
}

#[tauri::command]
pub async fn fetch_email_digest_messages(
    state: State<'_, AppState>,
    input: FetchEmailInput,
) -> Result<EmailBatch, String> {
    let path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let generation = runtime()?.entry(path.clone()).or_default().generation;
        let result = fetch_messages(&path, input);
        if let Ok(mut runtime) = runtime() {
            let status = runtime.entry(path).or_default();
            if status.generation == generation && !status.login_pending {
                status.last_error = result.as_ref().err().cloned();
            }
        }
        result
    })
    .await
    .map_err(|_| "Gmail 확인 작업을 완료하지 못했습니다.".to_string())?
}

fn fetch_messages(path: &Path, input: FetchEmailInput) -> Result<EmailBatch, String> {
    let until = input.until.unwrap_or_else(now_millis);
    if input.since < 0 || until <= input.since || until > now_millis() + 60_000 {
        return Err("메일 확인 기간이 올바르지 않습니다.".to_string());
    }
    if input
        .page_token
        .as_ref()
        .is_some_and(|value| value.len() > 4096)
    {
        return Err("메일 페이지 정보가 너무 깁니다.".to_string());
    }
    let (access, email, generation) = resolve_access(path)?;
    let client = http_client()?;
    // WebView의 취소 신호가 IPC를 중단하지 못하므로 백엔드에서도 한 페이지 시간을 제한합니다.
    let deadline = Instant::now() + Duration::from_secs(60);
    // 검색은 초 단위로 넓게 잡고 최종 결과에서 밀리초 경계를 정확히 적용합니다.
    let query = format!(
        "after:{} before:{}",
        input.since / 1000 - 1,
        (until + 999) / 1000
    );
    let mut request = client
        .get("https://gmail.googleapis.com/gmail/v1/users/me/messages")
        .timeout(Duration::from_secs(15))
        .bearer_auth(&access)
        .query(&[
            ("labelIds", "INBOX"),
            ("maxResults", "25"),
            ("q", query.as_str()),
        ]);
    if let Some(token) = &input.page_token {
        request = request.query(&[("pageToken", token)]);
    }
    let listed: GmailList = decode_response(
        request
            .send()
            .map_err(|_| "Gmail 메일 목록을 가져오지 못했습니다.".to_string())?,
    )?;
    let mut messages = Vec::new();
    for listed_message in listed.messages {
        check_generation(path, generation)?;
        if Instant::now() >= deadline {
            return Err(
                "Gmail 확인 시간이 초과되었습니다. 다음 실행에 다시 시도합니다.".to_string(),
            );
        }
        if !listed_message.id.chars().all(|ch| ch.is_ascii_hexdigit())
            || listed_message.id.is_empty()
        {
            return Err("Gmail 메일 식별자가 올바르지 않습니다.".to_string());
        }
        let response = client
            .get(format!(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/{}",
                listed_message.id
            ))
            .timeout(
                deadline
                    .saturating_duration_since(Instant::now())
                    .min(Duration::from_secs(15)),
            )
            .bearer_auth(&access)
            .query(&[("format", "full")])
            .send()
            .map_err(|_| "Gmail 메일 본문을 가져오지 못했습니다.".to_string())?;
        // 조회 중 삭제된 메일은 다음 확인을 막지 않습니다.
        if response.status().as_u16() == 404 {
            continue;
        }
        let (message, oversized): (GmailMessage, bool) = match decode_response(response) {
            Ok(message) => (message, false),
            Err(error) if error == RESPONSE_TOO_LARGE => {
                // 큰 본문은 메타데이터/미리보기만 사용하고 불완전함을 보고서에 표시합니다.
                let metadata = client
                    .get(format!(
                        "https://gmail.googleapis.com/gmail/v1/users/me/messages/{}",
                        listed_message.id
                    ))
                    .timeout(
                        deadline
                            .saturating_duration_since(Instant::now())
                            .min(Duration::from_secs(15)),
                    )
                    .bearer_auth(&access)
                    .query(&[("format", "metadata")])
                    .send()
                    .map_err(|_| "Gmail 메일 미리보기를 가져오지 못했습니다.".to_string())?;
                (decode_response(metadata)?, true)
            }
            Err(error) => return Err(error),
        };
        let timestamp = message
            .internal_date
            .parse::<i64>()
            .map_err(|_| "메일 수신 시간을 확인하지 못했습니다.".to_string())?;
        if timestamp >= input.since && timestamp < until {
            let mut sanitized = sanitize_message(message, timestamp);
            sanitized.truncated |= oversized;
            let account_query = url::form_urlencoded::Serializer::new(String::new())
                .append_pair("authuser", &email)
                .finish();
            sanitized.url = format!(
                "https://mail.google.com/mail/?{account_query}#inbox/{}",
                sanitized.id
            );
            messages.push(sanitized);
        }
    }
    check_generation(path, generation)?;
    messages.sort_by_key(|message| message.received_at);
    Ok(EmailBatch {
        messages,
        since: input.since,
        until,
        next_page_token: listed.next_page_token,
        account_email: email,
    })
}

fn mime_text(part: &MimePart, mime: &str, depth: usize) -> String {
    if depth > 20 || !part.filename.is_empty() {
        return String::new();
    }
    if part.mime_type.eq_ignore_ascii_case(mime) {
        return URL_SAFE_NO_PAD
            .decode(part.body.data.trim_end_matches('='))
            .ok()
            .map(|value| String::from_utf8_lossy(&value).into_owned())
            .unwrap_or_default();
    }
    part.parts
        .iter()
        .map(|child| mime_text(child, mime, depth + 1))
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn plain_html(html: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => {
                in_tag = true;
                result.push(' ');
            }
            '>' => in_tag = false,
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }
    result
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

fn bounded_text(text: &str, limit: usize) -> String {
    text.chars()
        .filter(|ch| !ch.is_control() || matches!(ch, '\n' | '\t'))
        .take(limit)
        .collect()
}

fn sanitize_message(message: GmailMessage, timestamp: i64) -> EmailMessage {
    let header = |name: &str| {
        message
            .payload
            .headers
            .iter()
            .find(|header| header.name.eq_ignore_ascii_case(name))
            .map(|header| bounded_text(&header.value, 1024))
            .unwrap_or_default()
    };
    let from = header("from");
    let subject = header("subject");
    let mut body = mime_text(&message.payload, "text/plain", 0);
    if body.trim().is_empty() {
        body = plain_html(&mime_text(&message.payload, "text/html", 0));
    }
    let snippet_only = body.trim().is_empty();
    if snippet_only {
        body = plain_html(&message.snippet);
    }
    let truncated = snippet_only || body.contains('\u{fffd}') || body.chars().count() > BODY_LIMIT;
    let url = format!("https://mail.google.com/mail/u/0/#inbox/{}", message.id);
    EmailMessage {
        id: message.id,
        thread_id: message.thread_id,
        from,
        subject,
        body: bounded_text(&body, BODY_LIMIT),
        received_at: timestamp,
        url,
        truncated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canceled_generation_cannot_continue_mail_work() {
        let path = PathBuf::from("test-only-gmail-generation");
        {
            let mut states = runtime().unwrap();
            states.insert(
                path.clone(),
                EmailRuntime {
                    generation: 10,
                    ..EmailRuntime::default()
                },
            );
        }
        assert!(check_generation(&path, 10).is_ok());
        {
            let mut states = runtime().unwrap();
            states.get_mut(&path).unwrap().generation = 11;
        }
        assert!(check_generation(&path, 10).is_err());
        runtime().unwrap().remove(&path);
    }

    #[test]
    fn oauth_uses_readonly_pkce_and_state() {
        let url = Url::parse(&authorize_url(
            "client",
            "http://127.0.0.1:5555/oauth/callback",
            "challenge",
            "state",
        ))
        .unwrap();
        let query: HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(query["scope"], GMAIL_SCOPE);
        assert_eq!(query["code_challenge_method"], "S256");
        assert_eq!(query["state"], "state");
        assert_eq!(query["access_type"], "offline");
    }

    #[test]
    fn ignores_foreign_callbacks_and_verifies_denial_state() {
        assert_eq!(callback_code("/favicon.ico", "expected").unwrap(), None);
        assert_eq!(
            callback_code("/oauth/callback?state=wrong&code=secret", "expected").unwrap(),
            None
        );
        assert_eq!(
            callback_code(
                "/oauth/callback?state=wrong&error=access_denied",
                "expected"
            )
            .unwrap(),
            None
        );
        assert!(callback_code(
            "/oauth/callback?state=expected&error=access_denied",
            "expected"
        )
        .is_err());
        assert_eq!(
            callback_code("/oauth/callback?state=expected&code=valid", "expected").unwrap(),
            Some("valid".to_string())
        );
    }

    #[test]
    fn extracts_plain_text_without_attachments_and_bounds_utf8() {
        let body = "회의는 금요일 15시입니다.";
        let message: GmailMessage=serde_json::from_value(serde_json::json!({"id":"abc123","internalDate":"1234","payload":{"mimeType":"multipart/mixed","headers":[{"name":"Subject","value":"회의"}],"parts":[{"mimeType":"text/plain","body":{"data":URL_SAFE_NO_PAD.encode(body)}},{"mimeType":"text/plain","filename":"secret.txt","body":{"data":URL_SAFE_NO_PAD.encode("attachment should be ignored")}}]}})).unwrap();
        let result = sanitize_message(message, 1234);
        assert_eq!(result.subject, "회의");
        assert_eq!(result.body, body);
        assert!(!result.truncated);
        assert_eq!(bounded_text("한글\0문자", 3), "한글문");
    }

    #[test]
    fn falls_back_to_html_without_rendering_and_marks_truncation() {
        let message: GmailMessage=serde_json::from_value(serde_json::json!({"id":"abc123","payload":{"mimeType":"text/html","body":{"data":URL_SAFE_NO_PAD.encode(format!("<p>{}&amp;end</p>","한".repeat(BODY_LIMIT+1)))}}})).unwrap();
        let result = sanitize_message(message, 1234);
        assert!(result.truncated);
        assert_eq!(result.body.chars().count(), BODY_LIMIT);
        assert!(!result.body.contains("<p>"));
    }

    #[test]
    fn rejects_error_responses_without_returning_secrets() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0u8; 1024];
            let _ = stream.read(&mut buffer);
            stream.write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 16\r\nConnection: close\r\n\r\nprivate-token123").unwrap();
        });
        let response = http_client()
            .unwrap()
            .get(format!("http://{address}/"))
            .send()
            .unwrap();
        let error = decode_response::<GmailList>(response).err().unwrap();
        assert!(!error.contains("private-token"));
        assert!(error.contains("다시 연결"));
        server.join().unwrap();
    }
}
