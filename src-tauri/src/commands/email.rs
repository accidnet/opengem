use crate::{
    app_state::AppState,
    commands::google_auth::{self, GoogleService},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::blocking::{Client, Response};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    io::Read,
    path::Path,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::State;
const BODY_LIMIT: usize = 8_000;
const RESPONSE_LIMIT: u64 = 2 * 1024 * 1024;
const RESPONSE_TOO_LARGE: &str = "메일 응답이 처리 한도를 초과했습니다.";

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

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn gmail_payload(
    settings: google_auth::GoogleSettingsPayload,
) -> Result<EmailSettingsPayload, String> {
    let status = settings
        .services
        .into_iter()
        .find(|service| service.service == GoogleService::Gmail)
        .ok_or_else(|| "Gmail 연결 상태를 찾지 못했습니다.".to_string())?;
    Ok(EmailSettingsPayload {
        provider: "gmail",
        client_id: settings.client_id,
        has_client_secret: settings.has_client_secret,
        connected: status.connected,
        email: status.email,
        login_pending: status.login_pending,
        last_error: status.last_error,
    })
}
// 기존 Gmail 명령 계약을 유지해 반복 이메일 업무가 그대로 동작합니다.
#[tauri::command]
pub fn get_email_settings(state: State<AppState>) -> Result<EmailSettingsPayload, String> {
    gmail_payload(google_auth::settings_payload(&state.db_path)?)
}
#[tauri::command]
pub fn save_email_settings(
    state: State<AppState>,
    input: SaveEmailSettingsInput,
) -> Result<EmailSettingsPayload, String> {
    gmail_payload(google_auth::save_settings(
        &state.db_path,
        google_auth::SaveGoogleSettingsInput {
            client_id: input.client_id,
            client_secret: input.client_secret,
        },
    )?)
}
#[tauri::command]
pub fn begin_email_login(state: State<AppState>) -> Result<EmailLoginPayload, String> {
    let result = google_auth::begin_login(&state.db_path, GoogleService::Gmail)?;
    Ok(EmailLoginPayload {
        authorization_url: result.authorization_url,
    })
}
#[tauri::command]
pub fn cancel_email_login(state: State<AppState>) -> Result<EmailSettingsPayload, String> {
    google_auth::cancel_login(&state.db_path, GoogleService::Gmail)?;
    gmail_payload(google_auth::settings_payload(&state.db_path)?)
}
#[tauri::command]
pub fn disconnect_email(state: State<AppState>) -> Result<EmailSettingsPayload, String> {
    google_auth::disconnect_service(&state.db_path, GoogleService::Gmail)?;
    gmail_payload(google_auth::settings_payload(&state.db_path)?)
}
fn resolve_access(path: &Path) -> Result<(String, String, u64), String> {
    google_auth::service_access(path, GoogleService::Gmail)
}
fn check_generation(path: &Path, generation: u64) -> Result<(), String> {
    google_auth::check_generation(path, GoogleService::Gmail, generation)
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
            400 | 401 => "Gmail 인증이 만료되었거나 요청이 유효하지 않습니다. 사용자 메뉴 → Google 연동에서 다시 연결해 주세요.".to_string(),
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

#[tauri::command]
pub async fn fetch_email_digest_messages(
    state: State<'_, AppState>,
    input: FetchEmailInput,
) -> Result<EmailBatch, String> {
    let path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let generation = google_auth::service_generation(&path, GoogleService::Gmail)?;
        let result = fetch_messages(&path, input);
        google_auth::record_result(
            &path,
            GoogleService::Gmail,
            generation,
            result.as_ref().err().cloned(),
        );
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
    use std::{io::Write, net::TcpListener, thread};
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
