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
const DRIVE_SCOPE: &str = "https://www.googleapis.com/auth/drive.readonly";
const CALENDAR_EVENTS_SCOPE: &str = "https://www.googleapis.com/auth/calendar.events";
const CALENDAR_LIST_SCOPE: &str = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const EMAIL_SCOPE: &str = "https://www.googleapis.com/auth/userinfo.email";
const RESPONSE_LIMIT: usize = 2 * 1024 * 1024;
type RuntimeKey = (PathBuf, GoogleService);
static RUNTIME: OnceLock<Mutex<HashMap<RuntimeKey, ServiceRuntime>>> = OnceLock::new();

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum GoogleService {
    Gmail,
    Drive,
    Calendar,
}
impl GoogleService {
    fn name(self) -> &'static str {
        match self {
            Self::Gmail => "gmail",
            Self::Drive => "drive",
            Self::Calendar => "calendar",
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::Gmail => "Gmail",
            Self::Drive => "Google Drive",
            Self::Calendar => "Google Calendar",
        }
    }
    fn scopes(self) -> &'static [&'static str] {
        match self {
            Self::Gmail => &[GMAIL_SCOPE],
            Self::Drive => &[DRIVE_SCOPE, EMAIL_SCOPE],
            Self::Calendar => &[CALENDAR_EVENTS_SCOPE, CALENDAR_LIST_SCOPE, EMAIL_SCOPE],
        }
    }
    fn setup_message(self) -> String {
        format!(
            "사용자 메뉴 → Google 연동에서 {}을 연결해 주세요.",
            self.label()
        )
    }
}
const SERVICES: [GoogleService; 3] = [
    GoogleService::Gmail,
    GoogleService::Drive,
    GoogleService::Calendar,
];

#[derive(Default)]
struct ServiceRuntime {
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
    #[serde(default)]
    client_secret: String,
    refresh_token: Option<String>,
}
struct Settings {
    client_id: String,
    client_key: String,
    credential_key: String,
    email: Option<String>,
    connected: bool,
    granted_scopes: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleServiceStatus {
    pub service: GoogleService,
    pub connected: bool,
    pub email: Option<String>,
    pub login_pending: bool,
    pub last_error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleSettingsPayload {
    pub client_id: String,
    pub has_client_secret: bool,
    pub services: Vec<GoogleServiceStatus>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveGoogleSettingsInput {
    pub client_id: String,
    pub client_secret: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleLoginPayload {
    pub authorization_url: String,
}
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    scope: Option<String>,
}
#[derive(Deserialize)]
struct UserInfo {
    email: String,
    verified_email: Option<bool>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GmailProfile {
    email_address: String,
}

fn runtime() -> Result<MutexGuard<'static, HashMap<RuntimeKey, ServiceRuntime>>, String> {
    RUNTIME
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "Google 연결 상태에 접근하지 못했습니다. 앱을 다시 시작해 주세요.".to_string())
}
fn runtime_key(path: &Path, service: GoogleService) -> RuntimeKey {
    (path.to_path_buf(), service)
}
fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn connection(path: &Path) -> Result<Connection, String> {
    let db = Connection::open(path).map_err(|e| e.to_string())?;
    db.busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    Ok(db)
}
fn load_settings(db: &Connection, service: GoogleService) -> Result<Settings, String> {
    db.query_row("SELECT c.client_id,c.credential_key,s.credential_key,s.email,s.connected,s.granted_scopes FROM email_connection_settings c CROSS JOIN google_service_connections s WHERE c.id=1 AND s.service=?1",[service.name()],|row|Ok(Settings{client_id:row.get(0)?,client_key:row.get(1)?,credential_key:row.get(2)?,email:row.get(3)?,connected:row.get::<_,i64>(4)?!=0,granted_scopes:row.get(5)?})).map_err(|e|e.to_string())
}
fn secret_entry(key: &str) -> Result<keyring::Entry, String> {
    // 기존 Gmail 키링 이름을 유지하고 서비스별 별도 식별자를 사용합니다.
    keyring::Entry::new("opengem.gmail", key)
        .map_err(|_| "운영체제 자격 증명 저장소를 열지 못했습니다.".to_string())
}
fn load_secrets(key: &str) -> Result<Secrets, String> {
    if key.is_empty() {
        return Ok(Secrets::default());
    }
    match secret_entry(key)?.get_password() {
        Ok(value) => serde_json::from_str(&value).map_err(|_| {
            "저장된 Google 자격 증명을 읽지 못했습니다. 다시 연결해 주세요.".to_string()
        }),
        Err(keyring::Error::NoEntry) => Ok(Secrets::default()),
        Err(_) => Err("운영체제 자격 증명 저장소가 잠겨 있거나 사용할 수 없습니다.".to_string()),
    }
}
fn save_secrets(key: &str, secrets: &Secrets) -> Result<(), String> {
    let value = serde_json::to_string(secrets)
        .map_err(|_| "Google 자격 증명을 준비하지 못했습니다.".to_string())?;
    secret_entry(key)?.set_password(&value).map_err(|_| {
        "운영체제 자격 증명 저장소에 저장하지 못했습니다. 저장소 잠금을 확인해 주세요.".to_string()
    })
}
fn scope_allowed(granted: &str, required: &str) -> bool {
    granted
        .split_whitespace()
        .any(|value| value == required || (required == EMAIL_SCOPE && value == "email"))
}
fn scopes_sufficient(service: GoogleService, granted: &str) -> bool {
    service
        .scopes()
        .iter()
        .all(|scope| scope_allowed(granted, scope))
}
fn verify_scopes(service: GoogleService, scope: Option<&str>) -> Result<String, String> {
    let scope = scope.unwrap_or_default();
    if !scopes_sufficient(service, scope) {
        return Err(format!(
            "{}에 필요한 권한을 모두 받지 못했습니다. Google 연동에서 다시 연결해 주세요.",
            service.label()
        ));
    }
    Ok(scope.to_string())
}

pub(crate) fn settings_payload(path: &Path) -> Result<GoogleSettingsPayload, String> {
    let db = connection(path)?;
    let common = load_settings(&db, GoogleService::Gmail)?;
    let client_secrets = load_secrets(&common.client_key);
    let has_client_secret = client_secrets
        .as_ref()
        .is_ok_and(|s| !s.client_secret.is_empty());
    let mut states = runtime()?;
    let mut services = Vec::new();
    for service in SERVICES {
        let settings = load_settings(&db, service)?;
        let secrets = load_secrets(&settings.credential_key);
        let status = states.entry(runtime_key(path, service)).or_default();
        let connected = settings.connected
            && has_client_secret
            && secrets
                .as_ref()
                .is_ok_and(|s| s.refresh_token.as_ref().is_some_and(|v| !v.is_empty()))
            && scopes_sufficient(service, &settings.granted_scopes);
        let error = status
            .last_error
            .clone()
            .or_else(|| secrets.err())
            .or_else(|| client_secrets.as_ref().err().cloned())
            .or_else(|| (settings.connected && !connected).then(|| service.setup_message()));
        services.push(GoogleServiceStatus {
            service,
            connected,
            email: settings.email,
            login_pending: status.login_pending,
            last_error: error,
        });
    }
    Ok(GoogleSettingsPayload {
        client_id: common.client_id,
        has_client_secret,
        services,
    })
}
#[tauri::command]
pub fn get_google_settings(state: State<AppState>) -> Result<GoogleSettingsPayload, String> {
    settings_payload(&state.db_path)
}

fn invalidate_all(states: &mut HashMap<RuntimeKey, ServiceRuntime>, path: &Path) {
    for service in SERVICES {
        let status = states.entry(runtime_key(path, service)).or_default();
        status.generation = status.generation.wrapping_add(1);
        status.login_pending = false;
        status.last_error = None;
        status.access = None;
    }
}
fn set_service_identity(
    db: &mut Connection,
    service: GoogleService,
    email: Option<&str>,
    granted_scopes: &str,
) -> Result<(), String> {
    let transaction = db.transaction().map_err(|e| e.to_string())?;
    transaction.execute("UPDATE google_service_connections SET connected=?1,email=?2,granted_scopes=?3,updated_at=?4 WHERE service=?5",params![email.is_some(),email,granted_scopes,now_millis(),service.name()]).map_err(|e|e.to_string())?;
    if service == GoogleService::Gmail {
        transaction.execute("UPDATE email_connection_settings SET connected=?1,email=?2,updated_at=?3 WHERE id=1",params![email.is_some(),email,now_millis()]).map_err(|e|e.to_string())?;
    }
    transaction.commit().map_err(|e| e.to_string())
}

pub(crate) fn save_settings(
    path: &Path,
    input: SaveGoogleSettingsInput,
) -> Result<GoogleSettingsPayload, String> {
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
        let mut states = runtime()?;
        let db = connection(path)?;
        let current = load_settings(&db, GoogleService::Gmail)?;
        let old = load_secrets(&current.client_key)?;
        let same_client = current.client_id == client_id;
        let client_secret = if !secret.is_empty() {
            secret
        } else if same_client {
            old.client_secret.clone()
        } else {
            String::new()
        };
        if client_secret.is_empty() {
            return Err("데스크톱 앱 OAuth 클라이언트 보안 비밀번호를 입력해 주세요.".to_string());
        }
        let changed = !same_client || old.client_secret != client_secret;
        let key = if current.client_key.is_empty() {
            random_string(32)
        } else {
            current.client_key
        };
        if changed {
            // 저장소 쓰기가 중간에 실패해도 모든 이전 실행을 먼저 무효화합니다.
            invalidate_all(&mut states, path);
            db.execute("UPDATE google_service_connections SET connected=0,email=NULL,granted_scopes='',updated_at=?1",[now_millis()]).map_err(|e|e.to_string())?;
            for service in SERVICES {
                let setting = load_settings(&db, service)?;
                if !setting.credential_key.is_empty() && setting.credential_key != key {
                    save_secrets(&setting.credential_key, &Secrets::default())?;
                }
            }
        }
        save_secrets(
            &key,
            &Secrets {
                client_secret,
                refresh_token: if changed { None } else { old.refresh_token },
            },
        )?;
        db.execute("UPDATE email_connection_settings SET client_id=?1,credential_key=?2,connected=CASE WHEN ?3 THEN 0 ELSE connected END,email=CASE WHEN ?3 THEN NULL ELSE email END,updated_at=?4 WHERE id=1",params![client_id,key,changed,now_millis()]).map_err(|e|e.to_string())?;
        db.execute("UPDATE google_service_connections SET credential_key=?1 WHERE service='gmail' AND credential_key=''",[&key]).map_err(|e|e.to_string())?;
    }
    settings_payload(path)
}
#[tauri::command]
pub fn save_google_settings(
    state: State<AppState>,
    input: SaveGoogleSettingsInput,
) -> Result<GoogleSettingsPayload, String> {
    save_settings(&state.db_path, input)
}

pub(crate) fn begin_login(
    path: &Path,
    service: GoogleService,
) -> Result<GoogleLoginPayload, String> {
    let mut states = runtime()?;
    let db = connection(path)?;
    let mut settings = load_settings(&db, service)?;
    let client_secret = load_secrets(&settings.client_key)?.client_secret;
    if settings.client_id.is_empty() || client_secret.is_empty() {
        return Err(service.setup_message());
    }
    if settings.credential_key.is_empty() {
        settings.credential_key = random_string(32);
        db.execute(
            "UPDATE google_service_connections SET credential_key=?1 WHERE service=?2",
            params![settings.credential_key, service.name()],
        )
        .map_err(|e| e.to_string())?;
    }
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|_| "Google 로그인용 로컬 포트를 열지 못했습니다.".to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/oauth/callback");
    let verifier = random_string(96);
    let expected_state = random_string(48);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let authorization_url = authorize_url(
        &settings.client_id,
        &redirect_uri,
        &challenge,
        &expected_state,
        service,
    );
    let status = states.entry(runtime_key(path, service)).or_default();
    status.generation = status.generation.wrapping_add(1);
    status.login_pending = true;
    status.last_error = None;
    status.access = None;
    let generation = status.generation;
    drop(states);
    let path = path.to_path_buf();
    thread::spawn(move || {
        let result = login_flow(
            &path,
            service,
            generation,
            listener,
            &settings,
            &client_secret,
            &redirect_uri,
            &verifier,
            &expected_state,
        );
        if let Ok(mut states) = runtime() {
            let status = states.entry(runtime_key(&path, service)).or_default();
            if status.generation == generation {
                status.login_pending = false;
                status.last_error = result.err();
            }
        }
    });
    Ok(GoogleLoginPayload { authorization_url })
}
#[tauri::command]
pub fn begin_google_login(
    state: State<AppState>,
    service: GoogleService,
) -> Result<GoogleLoginPayload, String> {
    begin_login(&state.db_path, service)
}
pub(crate) fn cancel_login(path: &Path, service: GoogleService) -> Result<(), String> {
    let mut states = runtime()?;
    let status = states.entry(runtime_key(path, service)).or_default();
    status.generation = status.generation.wrapping_add(1);
    status.login_pending = false;
    status.last_error = None;
    Ok(())
}
#[tauri::command]
pub fn cancel_google_login(state: State<AppState>, service: GoogleService) -> Result<(), String> {
    cancel_login(&state.db_path, service)
}
pub(crate) fn disconnect_service(path: &Path, service: GoogleService) -> Result<(), String> {
    let mut states = runtime()?;
    let status = states.entry(runtime_key(path, service)).or_default();
    status.generation = status.generation.wrapping_add(1);
    status.login_pending = false;
    status.last_error = None;
    status.access = None;
    let db = connection(path)?;
    let settings = load_settings(&db, service)?;
    db.execute("UPDATE google_service_connections SET connected=0,email=NULL,granted_scopes='',updated_at=?1 WHERE service=?2",params![now_millis(),service.name()]).map_err(|e|e.to_string())?;
    if service == GoogleService::Gmail {
        db.execute(
            "UPDATE email_connection_settings SET connected=0,email=NULL,updated_at=?1 WHERE id=1",
            [now_millis()],
        )
        .map_err(|e| e.to_string())?;
    }
    if !settings.credential_key.is_empty() {
        let mut secrets = load_secrets(&settings.credential_key)?;
        secrets.refresh_token = None;
        save_secrets(&settings.credential_key, &secrets)?;
    }
    Ok(())
}
#[tauri::command]
pub fn disconnect_google_service(
    state: State<AppState>,
    service: GoogleService,
) -> Result<GoogleSettingsPayload, String> {
    disconnect_service(&state.db_path, service)?;
    settings_payload(&state.db_path)
}
fn random_string(length: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(length)
        .map(char::from)
        .collect()
}
fn authorize_url(
    client_id: &str,
    redirect: &str,
    challenge: &str,
    state: &str,
    service: GoogleService,
) -> String {
    let mut url =
        Url::parse("https://accounts.google.com/o/oauth2/v2/auth").expect("fixed OAuth URL");
    let scope = service.scopes().join(" ");
    // 설치형 앱은 증분 인증을 지원하지 않으므로 서비스별 동의를 따로 받습니다.
    url.query_pairs_mut().extend_pairs([
        ("client_id", client_id),
        ("redirect_uri", redirect),
        ("response_type", "code"),
        ("scope", scope.as_str()),
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
        .map_err(|_| "Google 연결을 준비하지 못했습니다.".to_string())
}
fn error_status(service: GoogleService, status: u16) -> String {
    let label = service.label();
    match status{400|401=>format!("{label} 인증이 만료되었거나 요청이 유효하지 않습니다. Google 연동에서 다시 연결해 주세요."),403=>format!("{label} 권한과 Google Cloud의 API 사용 설정을 확인해 주세요."),404=>format!("{label} 항목을 찾을 수 없거나 접근할 수 없습니다."),429=>format!("{label} 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요."),code=>format!("{label} 요청에 실패했습니다 (HTTP {code}). 잠시 후 다시 시도해 주세요.")}
}
fn response_bytes(
    response: Response,
    service: GoogleService,
    limit: usize,
) -> Result<Vec<u8>, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(error_status(service, status.as_u16()));
    }
    let mut bytes = Vec::new();
    response
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| format!("{} 응답을 읽지 못했습니다.", service.label()))?;
    if bytes.len() > limit {
        return Err(format!(
            "{} 응답이 처리 한도를 초과했습니다.",
            service.label()
        ));
    }
    Ok(bytes)
}
fn decode_response<T: DeserializeOwned>(
    response: Response,
    service: GoogleService,
) -> Result<T, String> {
    let bytes = response_bytes(response, service, RESPONSE_LIMIT)?;
    serde_json::from_slice(&bytes)
        .map_err(|_| format!("{} 응답 형식을 확인하지 못했습니다.", service.label()))
}
pub(crate) fn service_generation(path: &Path, service: GoogleService) -> Result<u64, String> {
    Ok(runtime()?
        .entry(runtime_key(path, service))
        .or_default()
        .generation)
}
pub(crate) fn check_generation(
    path: &Path,
    service: GoogleService,
    generation: u64,
) -> Result<(), String> {
    if runtime()?
        .get(&runtime_key(path, service))
        .map(|s| s.generation)
        != Some(generation)
    {
        Err(format!(
            "{} 연결이 변경되어 진행 중인 작업을 중단했습니다.",
            service.label()
        ))
    } else {
        Ok(())
    }
}
pub(crate) fn record_result(
    path: &Path,
    service: GoogleService,
    generation: u64,
    error: Option<String>,
) {
    if let Ok(mut states) = runtime() {
        let status = states.entry(runtime_key(path, service)).or_default();
        if status.generation == generation && !status.login_pending {
            status.last_error = error;
        }
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
            "Google 연결이 취소되었거나 Google에서 거절했습니다. 다시 연결해 주세요.".to_string(),
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
        "Google 연결이 완료되었습니다. 이 창을 닫고 OpenGem으로 돌아가세요."
    } else {
        "이 로그인 요청을 처리하지 못했습니다. OpenGem에서 연결 상태를 확인해 주세요."
    };
    let body = format!("<!doctype html><html lang=\"ko\"><meta charset=\"utf-8\"><title>OpenGem Google</title><p>{message}</p></html>");
    let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let _ = stream.write_all(response.as_bytes());
}

#[allow(clippy::too_many_arguments)]
fn login_flow(
    path: &Path,
    service: GoogleService,
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
        check_generation(path, service, generation)?;
        if Instant::now() >= deadline {
            return Err("Google 로그인 시간이 초과되었습니다. 다시 연결해 주세요.".to_string());
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
                    service,
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
            Err(_) => return Err("Google 로그인 응답을 받지 못했습니다.".to_string()),
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn finish_login(
    path: &Path,
    service: GoogleService,
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
        service,
    )?;
    let granted_scopes = verify_scopes(service, tokens.scope.as_deref())?;
    let refresh_token = tokens
        .refresh_token
        .filter(|v| !v.is_empty())
        .ok_or_else(|| {
            format!(
                "{} 재인증 권한을 받지 못했습니다. 다시 연결해 주세요.",
                service.label()
            )
        })?;
    let email = if service == GoogleService::Gmail {
        let profile: GmailProfile = decode_response(
            client
                .get("https://gmail.googleapis.com/gmail/v1/users/me/profile")
                .bearer_auth(&tokens.access_token)
                .send()
                .map_err(|_| "Gmail 계정 정보를 확인하지 못했습니다.".to_string())?,
            service,
        )?;
        profile.email_address
    } else {
        let profile: UserInfo = decode_response(
            client
                .get("https://www.googleapis.com/oauth2/v2/userinfo")
                .bearer_auth(&tokens.access_token)
                .send()
                .map_err(|_| "Google 계정 정보를 확인하지 못했습니다.".to_string())?,
            service,
        )?;
        if profile.verified_email == Some(false) {
            return Err("Google 이메일 주소가 확인되지 않았습니다.".to_string());
        }
        profile.email
    };
    let email = email.trim().to_lowercase();
    if email.len() > 320 || !email.contains('@') || email.chars().any(char::is_whitespace) {
        return Err("Google 계정 이메일을 확인하지 못했습니다.".to_string());
    }
    let mut states = runtime()?;
    let status = states.entry(runtime_key(path, service)).or_default();
    if status.generation != generation {
        return Err("취소되거나 변경된 Google 로그인입니다.".to_string());
    }
    let mut db = connection(path)?;
    let current = load_settings(&db, service)?;
    if current.client_id != settings.client_id
        || current.client_key != settings.client_key
        || current.credential_key != settings.credential_key
    {
        return Err("Google 설정이 변경되었습니다. 다시 연결해 주세요.".to_string());
    }
    // 키링과 SQLite는 하나의 트랜잭션이 아니므로 토큰 교체 전에 연결부터 끊습니다.
    // 이후 저장 실패 시 이전 계정 이름으로 새 토큰을 사용하는 대신 재연결을 요구합니다.
    set_service_identity(&mut db, service, None, "")?;
    save_secrets(
        &settings.credential_key,
        &Secrets {
            client_secret: if settings.credential_key == settings.client_key {
                client_secret.to_string()
            } else {
                String::new()
            },
            refresh_token: Some(refresh_token),
        },
    )?;
    set_service_identity(&mut db, service, Some(&email), &granted_scopes)?;
    // 재연결 완료 전의 요청도 새 계정으로 넘어가지 않도록 완료 시 세대를 한 번 더 바꿉니다.
    status.generation = status.generation.wrapping_add(1);
    status.login_pending = false;
    status.last_error = None;
    status.access = Some(AccessToken {
        value: tokens.access_token,
        expires_at: now_millis() + tokens.expires_in.unwrap_or(3600).clamp(60, 86_400) * 1000,
    });
    Ok(())
}

pub(crate) fn service_access(
    path: &Path,
    service: GoogleService,
) -> Result<(String, String, u64), String> {
    let mut states = runtime()?;
    let db = connection(path)?;
    let settings = load_settings(&db, service)?;
    if !settings.connected || !scopes_sufficient(service, &settings.granted_scopes) {
        return Err(service.setup_message());
    }
    let status = states.entry(runtime_key(path, service)).or_default();
    if status.login_pending {
        return Err(format!(
            "{} 연결을 완료한 뒤 다시 시도해 주세요.",
            service.label()
        ));
    }
    let generation = status.generation;
    let cached = status.access.clone();
    drop(states);
    let email = settings
        .email
        .clone()
        .ok_or_else(|| service.setup_message())?;
    if let Some(access) = cached.filter(|token| token.expires_at > now_millis() + 60_000) {
        return Ok((access.value, email, generation));
    }
    let common = load_secrets(&settings.client_key)?;
    let mut secrets = load_secrets(&settings.credential_key)?;
    let refresh = secrets
        .refresh_token
        .as_deref()
        .ok_or_else(|| service.setup_message())?;
    let tokens: TokenResponse = decode_response(
        http_client()?
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("client_id", settings.client_id.as_str()),
                ("client_secret", common.client_secret.as_str()),
                ("refresh_token", refresh),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .map_err(|_| {
                "Google 인증을 갱신하지 못했습니다. 네트워크를 확인해 주세요.".to_string()
            })?,
        service,
    )?;
    if let Some(scope) = tokens.scope.as_deref() {
        verify_scopes(service, Some(scope))?;
    }
    if tokens.access_token.is_empty() {
        return Err("Google 인증 응답에 액세스 권한이 없습니다.".to_string());
    }
    let mut states = runtime()?;
    let status = states.entry(runtime_key(path, service)).or_default();
    if status.generation != generation {
        return Err(format!(
            "{} 연결이 변경되었습니다. 다시 시도해 주세요.",
            service.label()
        ));
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

pub(crate) struct GoogleResponse {
    pub bytes: Vec<u8>,
    pub account_email: String,
    pub status: u16,
}
fn validate_endpoint(
    service: GoogleService,
    method: &reqwest::Method,
    url: &str,
) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|_| "Google API 주소가 올바르지 않습니다.".to_string())?;
    let basic = parsed.scheme() == "https"
        && parsed.port().is_none()
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.fragment().is_none();
    let endpoint = match service {
        GoogleService::Gmail => {
            parsed.host_str() == Some("gmail.googleapis.com")
                && parsed.path().starts_with("/gmail/v1/")
                && *method == reqwest::Method::GET
        }
        GoogleService::Drive => {
            matches!(
                parsed.host_str(),
                Some("www.googleapis.com" | "drive.googleapis.com")
            ) && parsed.path().starts_with("/drive/v3/")
                && *method == reqwest::Method::GET
        }
        GoogleService::Calendar => {
            matches!(
                parsed.host_str(),
                Some("www.googleapis.com" | "calendar.googleapis.com")
            ) && parsed.path().starts_with("/calendar/v3/")
                && (*method == reqwest::Method::GET
                    || (*method == reqwest::Method::POST
                        && parsed.path().starts_with("/calendar/v3/calendars/")
                        && parsed.path().ends_with("/events")))
        }
    };
    if !basic || !endpoint {
        return Err("허용되지 않은 Google API 요청입니다.".to_string());
    }
    Ok(())
}
// 인증 토큰은 고정된 Google API 호스트에만 전송하고 호출자에는 반환하지 않습니다.
fn request_for_account(
    path: &Path,
    service: GoogleService,
    method: reqwest::Method,
    url: &str,
    query: &[(&str, &str)],
    json: Option<&serde_json::Value>,
    limit: usize,
    expected_account: Option<&str>,
) -> Result<GoogleResponse, String> {
    validate_endpoint(service, &method, url)?;
    let (access, email, generation) = service_access(path, service)?;
    if expected_account
        .is_some_and(|expected| expected.trim().to_lowercase() != email.to_lowercase())
    {
        return Err(
            "Google 계정이 변경되었습니다. 현재 계정에서 내용을 다시 확인해 주세요.".to_string(),
        );
    }
    let result = (|| {
        check_generation(path, service, generation)?;
        let mut request = http_client()?
            .request(method.clone(), url)
            .bearer_auth(access)
            .query(query);
        if let Some(body) = json {
            request = request.json(body);
        }
        let response = request
            .send()
            .map_err(|_| format!("{} 서버에 연결하지 못했습니다.", service.label()))?;
        let status = response.status().as_u16();
        // 같은 요청 ID의 재시도만 커넥터가 기존 일정을 조회해 확인할 수 있게 합니다.
        let bytes = if status == 409
            && service == GoogleService::Calendar
            && method == reqwest::Method::POST
        {
            Vec::new()
        } else {
            response_bytes(response, service, limit.min(RESPONSE_LIMIT))?
        };
        check_generation(path, service, generation)?;
        Ok(GoogleResponse {
            bytes,
            account_email: email,
            status,
        })
    })();
    record_result(path, service, generation, result.as_ref().err().cloned());
    result
}

pub(crate) fn google_request(
    path: &Path,
    service: GoogleService,
    method: reqwest::Method,
    url: &str,
    query: &[(&str, &str)],
    json: Option<&serde_json::Value>,
    limit: usize,
) -> Result<GoogleResponse, String> {
    request_for_account(path, service, method, url, query, json, limit, None)
}
#[allow(clippy::too_many_arguments)]
pub(crate) fn google_request_for_account(
    path: &Path,
    service: GoogleService,
    method: reqwest::Method,
    url: &str,
    query: &[(&str, &str)],
    json: Option<&serde_json::Value>,
    limit: usize,
    expected_account: &str,
) -> Result<GoogleResponse, String> {
    request_for_account(
        path,
        service,
        method,
        url,
        query,
        json,
        limit,
        Some(expected_account),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_preserves_gmail_without_connecting_other_services() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE email_connection_settings(id INTEGER PRIMARY KEY,credential_key TEXT,email TEXT,connected INTEGER,updated_at INTEGER);INSERT INTO email_connection_settings VALUES(1,'legacy-key','owner@example.test',1,123);").unwrap();
        db.execute_batch(include_str!(
            "../../sql/migrations/020_google_integrations.sql"
        ))
        .unwrap();
        let gmail:(String,String,i64,String)=db.query_row("SELECT credential_key,email,connected,granted_scopes FROM google_service_connections WHERE service='gmail'",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap();
        assert_eq!(
            gmail,
            (
                "legacy-key".into(),
                "owner@example.test".into(),
                1,
                GMAIL_SCOPE.into()
            )
        );
        let connected:i64=db.query_row("SELECT SUM(connected) FROM google_service_connections WHERE service IN ('drive','calendar')",[],|r|r.get(0)).unwrap();
        assert_eq!(connected, 0);
    }
    #[test]
    fn authorization_is_service_specific_and_requires_granted_scopes() {
        for service in SERVICES {
            let url = Url::parse(&authorize_url(
                "client",
                "http://127.0.0.1:5555/oauth/callback",
                "challenge",
                "state",
                service,
            ))
            .unwrap();
            let query: HashMap<_, _> = url.query_pairs().into_owned().collect();
            assert_eq!(query["scope"], service.scopes().join(" "));
            assert_eq!(query["code_challenge_method"], "S256");
            assert_eq!(query["state"], "state");
            assert_eq!(query["access_type"], "offline");
            assert!(!query.contains_key("include_granted_scopes"));
            assert!(verify_scopes(service, Some(&query["scope"])).is_ok());
            assert!(verify_scopes(service, None).is_err());
        }
        assert!(verify_scopes(GoogleService::Drive, Some(GMAIL_SCOPE)).is_err());
        assert!(verify_scopes(GoogleService::Calendar, Some(CALENDAR_LIST_SCOPE)).is_err());
        assert!(verify_scopes(GoogleService::Drive, Some(&format!("{DRIVE_SCOPE} email"))).is_ok());
    }
    #[test]
    fn canceling_one_service_does_not_cancel_other_services() {
        let path = PathBuf::from("test-only-independent-google-generation");
        for service in SERVICES {
            runtime().unwrap().insert(
                runtime_key(&path, service),
                ServiceRuntime {
                    generation: 10,
                    login_pending: true,
                    ..ServiceRuntime::default()
                },
            );
        }
        cancel_login(&path, GoogleService::Drive).unwrap();
        assert!(check_generation(&path, GoogleService::Drive, 10).is_err());
        assert!(check_generation(&path, GoogleService::Gmail, 10).is_ok());
        assert!(check_generation(&path, GoogleService::Calendar, 10).is_ok());
        let mut states = runtime().unwrap();
        assert!(!states[&runtime_key(&path, GoogleService::Drive)].login_pending);
        assert!(states[&runtime_key(&path, GoogleService::Calendar)].login_pending);
        for service in SERVICES {
            states.remove(&runtime_key(&path, service));
        }
    }
    #[test]
    fn callbacks_check_state_before_accepting_success_or_denial() {
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
            Some("valid".into())
        );
    }
    #[test]
    fn service_transport_rejects_foreign_hosts_redirects_and_write_methods() {
        assert!(validate_endpoint(
            GoogleService::Drive,
            &reqwest::Method::GET,
            "https://www.googleapis.com/drive/v3/files"
        )
        .is_ok());
        assert!(validate_endpoint(
            GoogleService::Calendar,
            &reqwest::Method::POST,
            "https://www.googleapis.com/calendar/v3/calendars/primary/events"
        )
        .is_ok());
        for url in [
            "https://evil.test/drive/v3/files",
            "http://www.googleapis.com/drive/v3/files",
            "https://secret@www.googleapis.com/drive/v3/files",
            "https://www.googleapis.com:444/drive/v3/files",
            "https://www.googleapis.com/calendar/v3/users/me/calendarList",
        ] {
            assert!(validate_endpoint(GoogleService::Drive, &reqwest::Method::GET, url).is_err());
        }
        assert!(validate_endpoint(
            GoogleService::Drive,
            &reqwest::Method::POST,
            "https://www.googleapis.com/drive/v3/files"
        )
        .is_err());
        assert!(validate_endpoint(
            GoogleService::Calendar,
            &reqwest::Method::DELETE,
            "https://www.googleapis.com/calendar/v3/calendars/primary/events/id"
        )
        .is_err());
    }
    #[test]
    fn settings_payload_has_no_authentication_secrets() {
        let json = serde_json::to_value(GoogleSettingsPayload {
            client_id: "public-client".into(),
            has_client_secret: true,
            services: vec![GoogleServiceStatus {
                service: GoogleService::Drive,
                connected: true,
                email: Some("owner@example.test".into()),
                login_pending: false,
                last_error: None,
            }],
        })
        .unwrap();
        assert_eq!(json["services"][0]["service"], "drive");
        let text = json.to_string();
        assert!(!text.contains("refreshToken"));
        assert!(!text.contains("accessToken"));
        assert!(!text.contains("credentialKey"));
    }

    #[test]
    fn all_generations_are_invalidated_before_any_fallible_credential_write() {
        let path = PathBuf::from("test-only-all-google-generations");
        let mut states = HashMap::new();
        for service in SERVICES {
            states.insert(
                runtime_key(&path, service),
                ServiceRuntime {
                    generation: 20,
                    login_pending: true,
                    access: Some(AccessToken {
                        value: "old".into(),
                        expires_at: 999,
                    }),
                    last_error: None,
                },
            );
        }
        invalidate_all(&mut states, &path);
        for service in SERVICES {
            let status = &states[&runtime_key(&path, service)];
            assert_eq!(status.generation, 21);
            assert!(status.access.is_none());
            assert!(!status.login_pending);
        }
    }
    #[test]
    fn failed_reconnect_identity_commit_leaves_both_gmail_views_disconnected() {
        let mut db = Connection::open_in_memory().unwrap();
        crate::migrations::run_migrations(&mut db).unwrap();
        set_service_identity(
            &mut db,
            GoogleService::Gmail,
            Some("old@example.test"),
            GMAIL_SCOPE,
        )
        .unwrap();
        set_service_identity(&mut db, GoogleService::Gmail, None, "").unwrap();
        db.execute_batch("CREATE TRIGGER reject_legacy_identity BEFORE UPDATE OF connected ON email_connection_settings WHEN NEW.connected=1 BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
        assert!(set_service_identity(
            &mut db,
            GoogleService::Gmail,
            Some("new@example.test"),
            GMAIL_SCOPE
        )
        .is_err());
        for sql in [
            "SELECT connected,email FROM google_service_connections WHERE service='gmail'",
            "SELECT connected,email FROM email_connection_settings WHERE id=1",
        ] {
            let row: (i64, Option<String>) = db
                .query_row(sql, [], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap();
            assert_eq!(row, (0, None));
        }
    }

    #[test]
    fn provider_error_body_never_leaks_tokens() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0u8; 1024];
            let _ = stream.read(&mut buffer);
            stream.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 16\r\nConnection: close\r\n\r\nprivate-token123").unwrap();
        });
        let response = http_client()
            .unwrap()
            .get(format!("http://{address}/"))
            .send()
            .unwrap();
        let error = response_bytes(response, GoogleService::Drive, 1000)
            .err()
            .unwrap();
        assert!(!error.contains("private-token"));
        assert!(error.contains("Google Drive"));
        server.join().unwrap();
    }
}
