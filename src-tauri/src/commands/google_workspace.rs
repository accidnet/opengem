use crate::{
    app_state::AppState,
    commands::google_auth::{google_request, google_request_for_account, GoogleService},
};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;
use tauri::State;
use url::Url;

const RESPONSE_LIMIT: usize = 2 * 1024 * 1024;
const TEXT_LIMIT: usize = 40_000;
const EVENT_FIELDS: &str =
    "id,summary,description,start,end,location,htmlLink,status,extendedProperties";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveListInput {
    query: Option<String>,
    page_token: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveFile {
    id: String,
    name: String,
    mime_type: String,
    #[serde(default)]
    modified_time: Option<String>,
    #[serde(default)]
    web_view_link: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveFileList {
    #[serde(default)]
    files: Vec<DriveFile>,
    next_page_token: Option<String>,
    #[serde(default)]
    incomplete_search: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveFileContent {
    id: String,
    name: String,
    mime_type: String,
    content: String,
    truncated: bool,
    url: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Calendar {
    id: String,
    #[serde(default)]
    summary: String,
    time_zone: Option<String>,
    #[serde(default)]
    primary: bool,
    #[serde(default)]
    access_role: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarList {
    calendars: Vec<Calendar>,
    next_page_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawCalendarList {
    #[serde(default)]
    items: Vec<Calendar>,
    next_page_token: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventTime {
    #[serde(skip_serializing_if = "Option::is_none")]
    date_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    time_zone: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    id: String,
    title: String,
    description: String,
    start: EventTime,
    end: EventTime,
    location: String,
    url: String,
    status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawCalendarEvent {
    id: String,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    start: EventTime,
    #[serde(default)]
    end: EventTime,
    #[serde(default)]
    location: String,
    #[serde(default)]
    html_link: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    extended_properties: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventListInput {
    calendar_id: Option<String>,
    time_min: String,
    time_max: String,
    query: Option<String>,
    page_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawEventList {
    #[serde(default)]
    items: Vec<RawCalendarEvent>,
    next_page_token: Option<String>,
    time_zone: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventList {
    events: Vec<CalendarEvent>,
    next_page_token: Option<String>,
    time_zone: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateEventInput {
    calendar_id: String,
    expected_account_email: String,
    draft_id: String,
    title: String,
    description: Option<String>,
    location: Option<String>,
    start: EventTime,
    end: EventTime,
}

fn parse_json<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<T, String> {
    serde_json::from_slice(bytes)
        .map_err(|_| "Google 응답 형식을 읽지 못했습니다. 다시 시도해 주세요.".to_string())
}

fn limited_text(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

fn require_text(value: &str, label: &str, max: usize) -> Result<(), String> {
    if value.trim().is_empty()
        || value.chars().count() > max
        || value.chars().any(|c| c.is_control())
    {
        return Err(format!("{label} 값이 올바르지 않습니다."));
    }
    Ok(())
}

fn optional_query(query: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = query.map(str::trim).filter(|q| !q.is_empty()) else {
        return Ok(None);
    };
    require_text(value, "검색어", 2000)?;
    Ok(Some(value.to_string()))
}

fn validate_page_token(token: Option<&str>) -> Result<(), String> {
    if let Some(token) = token {
        require_text(token, "페이지 정보", 4096)?;
    }
    Ok(())
}

fn drive_search_query(query: Option<&str>) -> Result<String, String> {
    let text = optional_query(query)?;
    Ok(match text {
        Some(text) => format!(
            "trashed = false and fullText contains '{}'",
            text.replace('\\', "\\\\").replace('\'', "\\'")
        ),
        None => "trashed = false".to_string(),
    })
}

fn drive_url(file_id: &str, suffix: Option<&str>) -> Result<String, String> {
    if file_id.is_empty()
        || file_id.len() > 256
        || !file_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Google Drive 파일 ID가 올바르지 않습니다.".to_string());
    }
    let mut url = format!("https://www.googleapis.com/drive/v3/files/{file_id}");
    if let Some(suffix) = suffix {
        url.push('/');
        url.push_str(suffix);
    }
    Ok(url)
}

fn safe_google_link(value: &str, allowed_hosts: &[&str], fallback: String) -> String {
    Url::parse(value)
        .ok()
        .filter(|url| {
            url.scheme() == "https"
                && url.username().is_empty()
                && url.password().is_none()
                && url.port().is_none()
                && url
                    .host_str()
                    .is_some_and(|host| allowed_hosts.contains(&host))
        })
        .map(|url| url.to_string())
        .unwrap_or(fallback)
}

fn normalize_drive_file(mut file: DriveFile) -> DriveFile {
    file.name = limited_text(&file.name, 1000);
    file.web_view_link = safe_google_link(
        &file.web_view_link,
        &["drive.google.com", "docs.google.com"],
        format!(
            "https://drive.google.com/file/d/{}/view",
            url::form_urlencoded::byte_serialize(file.id.as_bytes()).collect::<String>()
        ),
    );
    file
}

fn list_drive_files(path: &Path, input: DriveListInput) -> Result<DriveFileList, String> {
    validate_page_token(input.page_token.as_deref())?;
    let query = drive_search_query(input.query.as_deref())?;
    let mut params = vec![
        ("q", query.as_str()),
        ("pageSize", "50"),
        ("orderBy", "modifiedTime desc"),
        ("spaces", "drive"),
        ("corpora", "user"),
        (
            "fields",
            "nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,webViewLink)",
        ),
    ];
    if let Some(token) = input.page_token.as_deref() {
        params.push(("pageToken", token));
    }
    let response = google_request(
        path,
        GoogleService::Drive,
        Method::GET,
        "https://www.googleapis.com/drive/v3/files",
        &params,
        None,
        RESPONSE_LIMIT,
    )?;
    let mut result: DriveFileList = parse_json(&response.bytes)?;
    result.files = result.files.into_iter().map(normalize_drive_file).collect();
    Ok(result)
}

#[tauri::command]
pub async fn list_google_drive_files(
    state: State<'_, AppState>,
    input: DriveListInput,
) -> Result<DriveFileList, String> {
    let path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || list_drive_files(&path, input))
        .await
        .map_err(|_| "Drive 조회 작업을 완료하지 못했습니다.".to_string())?
}

fn read_drive_file(path: &Path, file_id: &str) -> Result<DriveFileContent, String> {
    let url = drive_url(file_id, None)?;
    let metadata = google_request(
        path,
        GoogleService::Drive,
        Method::GET,
        &url,
        &[
            ("fields", "id,name,mimeType,modifiedTime,webViewLink"),
            ("supportsAllDrives", "true"),
        ],
        None,
        RESPONSE_LIMIT,
    )?;
    let file = normalize_drive_file(parse_json::<DriveFile>(&metadata.bytes)?);
    let content = if file.mime_type == "application/vnd.google-apps.document"
        || file.mime_type == "application/vnd.google-apps.presentation"
    {
        google_request_for_account(
            path,
            GoogleService::Drive,
            Method::GET,
            &drive_url(file_id, Some("export"))?,
            &[("mimeType", "text/plain")],
            None,
            RESPONSE_LIMIT,
            &metadata.account_email,
        )?
    } else if file.mime_type.starts_with("text/")
        || [
            "application/json",
            "application/xml",
            "application/javascript",
            "application/yaml",
            "application/x-yaml",
        ]
        .contains(&file.mime_type.as_str())
    {
        google_request_for_account(
            path,
            GoogleService::Drive,
            Method::GET,
            &url,
            &[("alt", "media"), ("supportsAllDrives", "true")],
            None,
            RESPONSE_LIMIT,
            &metadata.account_email,
        )?
    } else {
        return Err("이 파일 형식은 본문 읽기를 지원하지 않습니다. Google Docs·Slides 또는 텍스트 파일을 선택하고 다른 형식은 원문 링크에서 확인해 주세요.".to_string());
    };
    if metadata.account_email != content.account_email {
        return Err("Drive 계정이 변경되었습니다. 파일을 다시 선택해 주세요.".to_string());
    }
    let decoded = String::from_utf8_lossy(&content.bytes);
    let truncated =
        matches!(decoded, std::borrow::Cow::Owned(_)) || decoded.chars().count() > TEXT_LIMIT;
    Ok(DriveFileContent {
        id: file.id,
        name: file.name,
        mime_type: file.mime_type,
        content: limited_text(&decoded, TEXT_LIMIT),
        truncated,
        url: file.web_view_link,
    })
}

#[tauri::command]
pub async fn read_google_drive_file(
    state: State<'_, AppState>,
    file_id: String,
) -> Result<DriveFileContent, String> {
    let path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || read_drive_file(&path, &file_id))
        .await
        .map_err(|_| "Drive 본문 읽기를 완료하지 못했습니다.".to_string())?
}

fn calendar_url(calendar_id: &str, event_id: Option<&str>) -> Result<String, String> {
    require_text(calendar_id, "캘린더 ID", 1024)?;
    let mut url = Url::parse("https://www.googleapis.com/calendar/v3/calendars/").unwrap();
    let mut segments = url
        .path_segments_mut()
        .map_err(|_| "캘린더 경로를 준비하지 못했습니다.".to_string())?;
    segments.pop_if_empty().push(calendar_id).push("events");
    if let Some(id) = event_id {
        segments.push(id);
    }
    drop(segments);
    Ok(url.to_string())
}

fn list_calendars(path: &Path, page_token: Option<String>) -> Result<CalendarList, String> {
    validate_page_token(page_token.as_deref())?;
    let mut params = vec![
        ("maxResults", "100"),
        ("minAccessRole", "reader"),
        (
            "fields",
            "nextPageToken,items(id,summary,timeZone,primary,accessRole)",
        ),
    ];
    if let Some(token) = page_token.as_deref() {
        params.push(("pageToken", token));
    }
    let response = google_request(
        path,
        GoogleService::Calendar,
        Method::GET,
        "https://www.googleapis.com/calendar/v3/users/me/calendarList",
        &params,
        None,
        RESPONSE_LIMIT,
    )?;
    let result: RawCalendarList = parse_json(&response.bytes)?;
    Ok(CalendarList {
        calendars: result
            .items
            .into_iter()
            .map(|mut item| {
                item.summary = limited_text(&item.summary, 1000);
                item
            })
            .collect(),
        next_page_token: result.next_page_token,
    })
}

#[tauri::command]
pub async fn list_google_calendars(
    state: State<'_, AppState>,
    page_token: Option<String>,
) -> Result<CalendarList, String> {
    let path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || list_calendars(&path, page_token))
        .await
        .map_err(|_| "캘린더 목록을 가져오지 못했습니다.".to_string())?
}

fn to_calendar_event(event: RawCalendarEvent) -> CalendarEvent {
    CalendarEvent {
        id: event.id,
        title: limited_text(&event.summary, 1000),
        description: limited_text(&event.description, 10000),
        start: event.start,
        end: event.end,
        location: limited_text(&event.location, 2000),
        url: safe_google_link(
            &event.html_link,
            &["www.google.com", "calendar.google.com"],
            "https://calendar.google.com/calendar/u/0/r".to_string(),
        ),
        status: event.status,
    }
}

fn list_events(path: &Path, input: EventListInput) -> Result<EventList, String> {
    let start = parse_timestamp(&input.time_min)?;
    let end = parse_timestamp(&input.time_max)?;
    validate_range(start, end)?;
    validate_page_token(input.page_token.as_deref())?;
    let query = optional_query(input.query.as_deref())?;
    let mut params = vec![
        ("timeMin", input.time_min.as_str()),
        ("timeMax", input.time_max.as_str()),
        ("singleEvents", "true"),
        ("orderBy", "startTime"),
        ("showDeleted", "false"),
        ("maxResults", "100"),
    ];
    let fields = format!("nextPageToken,timeZone,items({EVENT_FIELDS})");
    params.push(("fields", fields.as_str()));
    if let Some(query) = query.as_deref() {
        params.push(("q", query));
    }
    if let Some(token) = input.page_token.as_deref() {
        params.push(("pageToken", token));
    }
    let response = google_request(
        path,
        GoogleService::Calendar,
        Method::GET,
        &calendar_url(input.calendar_id.as_deref().unwrap_or("primary"), None)?,
        &params,
        None,
        RESPONSE_LIMIT,
    )?;
    let result: RawEventList = parse_json(&response.bytes)?;
    Ok(EventList {
        events: result.items.into_iter().map(to_calendar_event).collect(),
        next_page_token: result.next_page_token,
        time_zone: result.time_zone,
    })
}

#[tauri::command]
pub async fn list_google_calendar_events(
    state: State<'_, AppState>,
    input: EventListInput,
) -> Result<EventList, String> {
    let path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || list_events(&path, input))
        .await
        .map_err(|_| "일정 조회를 완료하지 못했습니다.".to_string())?
}

fn decimal(value: &str) -> Result<i64, String> {
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
        return Err("일정 날짜·시간 형식이 올바르지 않습니다.".to_string());
    }
    value
        .parse::<i64>()
        .map_err(|_| "일정 날짜·시간 형식이 올바르지 않습니다.".to_string())
}

fn parse_date(value: &str) -> Result<i64, String> {
    if value.len() != 10 || !value.is_ascii() || &value[4..5] != "-" || &value[7..8] != "-" {
        return Err("종일 일정의 날짜는 YYYY-MM-DD 형식이어야 합니다.".to_string());
    }
    let year = decimal(&value[0..4])?;
    let month = decimal(&value[5..7])?;
    let day = decimal(&value[8..10])?;
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let maximum = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => 0,
    };
    if !(1..=9999).contains(&year) || day < 1 || day > maximum {
        return Err("존재하지 않는 일정 날짜입니다.".to_string());
    }
    // 그레고리력의 날짜를 정수 일수로 변환해 윤년과 오프셋 비교를 처리합니다.
    let y = year - i64::from(month <= 2);
    let era = y / 400;
    let yoe = y - era * 400;
    let shifted = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * shifted + 2) / 5 + day - 1;
    Ok(era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468)
}

fn parse_timestamp(value: &str) -> Result<i128, String> {
    if !value.is_ascii()
        || value.len() < 20
        || value.len() > 40
        || &value[10..11] != "T"
        || &value[13..14] != ":"
        || &value[16..17] != ":"
    {
        return Err("일정 시각은 시간대 오프셋을 포함한 RFC3339 형식이어야 합니다.".to_string());
    }
    let days = parse_date(&value[..10])?;
    let hour = decimal(&value[11..13])?;
    let minute = decimal(&value[14..16])?;
    let second = decimal(&value[17..19])?;
    if hour > 23 || minute > 59 || second > 59 {
        return Err("존재하지 않는 일정 시각입니다.".to_string());
    }
    let tail = &value[19..];
    let zone_start = tail
        .find(['Z', '+', '-'])
        .ok_or_else(|| "일정 시각의 시간대 오프셋이 필요합니다.".to_string())?;
    let fraction = &tail[..zone_start];
    let nanos = if fraction.is_empty() {
        0
    } else {
        if !fraction.starts_with('.') || fraction.len() < 2 || fraction.len() > 10 {
            return Err("초 소수점 형식이 올바르지 않습니다.".to_string());
        }
        let digits = &fraction[1..];
        decimal(digits)? as i128 * 10i128.pow((9 - digits.len()) as u32)
    };
    let zone = &tail[zone_start..];
    let offset = if zone == "Z" {
        0
    } else {
        if zone.len() != 6 || &zone[3..4] != ":" || !zone.starts_with(['+', '-']) {
            return Err("일정 시간대 오프셋이 올바르지 않습니다.".to_string());
        }
        let h = decimal(&zone[1..3])?;
        let m = decimal(&zone[4..6])?;
        if h > 23 || m > 59 {
            return Err("일정 시간대 오프셋이 올바르지 않습니다.".to_string());
        }
        (h * 60 + m) * 60 * if zone.starts_with('-') { -1 } else { 1 }
    };
    Ok(
        (days as i128 * 86400 + hour as i128 * 3600 + minute as i128 * 60 + second as i128
            - offset as i128)
            * 1_000_000_000
            + nanos,
    )
}

fn validate_range(start: i128, end: i128) -> Result<(), String> {
    if end <= start || end - start > 366i128 * 86400 * 1_000_000_000 {
        return Err("일정 종료는 시작보다 뒤여야 하며 기간은 366일 이내여야 합니다.".to_string());
    }
    Ok(())
}

fn event_time(value: &EventTime) -> Result<(bool, i128), String> {
    if let Some(zone) = &value.time_zone {
        if zone.is_empty()
            || zone.len() > 128
            || !zone
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "_+-/".contains(c))
        {
            return Err("일정 시간대 이름이 올바르지 않습니다.".to_string());
        }
    }
    match (&value.date_time, &value.date) {
        (Some(timestamp), None) => Ok((false, parse_timestamp(timestamp)?)),
        (None, Some(date)) => Ok((true, parse_date(date)? as i128 * 86400 * 1_000_000_000)),
        _ => Err("날짜 또는 날짜·시간 중 하나만 지정해 주세요.".to_string()),
    }
}

fn draft_event_id(value: &str) -> Result<String, String> {
    if value.len() != 36
        || value.bytes().enumerate().any(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b != b'-'
            } else {
                !b.is_ascii_hexdigit()
            }
        })
    {
        return Err("일정 초안 식별자가 올바르지 않습니다.".to_string());
    }
    Ok(format!(
        "opengem{}",
        value.replace('-', "").to_ascii_lowercase()
    ))
}

fn event_body(input: &CreateEventInput) -> Result<Value, String> {
    require_text(&input.expected_account_email, "연결 계정", 320)?;
    if !input.expected_account_email.contains('@') {
        return Err("검토한 Calendar 연결 계정이 필요합니다.".to_string());
    }
    require_text(&input.calendar_id, "캘린더 ID", 1024)?;
    require_text(&input.title, "일정 제목", 1000)?;
    if input
        .description
        .as_ref()
        .is_some_and(|s| s.chars().count() > 10000)
        || input
            .location
            .as_ref()
            .is_some_and(|s| s.chars().count() > 2000 || s.chars().any(char::is_control))
    {
        return Err("일정 설명 또는 장소가 너무 길거나 올바르지 않습니다.".to_string());
    }
    let (start_all_day, start) = event_time(&input.start)?;
    let (end_all_day, end) = event_time(&input.end)?;
    if start_all_day != end_all_day {
        return Err("시작과 종료의 종일 일정 형식이 일치해야 합니다.".to_string());
    }
    validate_range(start, end)?;
    let mut body = json!({"id":draft_event_id(&input.draft_id)?,"summary":input.title.trim(),"description":input.description.as_deref().unwrap_or_default(),"location":input.location.as_deref().unwrap_or_default(),"start":input.start,"end":input.end,"guestsCanInviteOthers":false});
    let fingerprint = Sha256::digest(
        serde_json::to_vec(&body).map_err(|_| "일정 초안을 준비하지 못했습니다.".to_string())?,
    )
    .iter()
    .map(|b| format!("{b:02x}"))
    .collect::<String>();
    body["extendedProperties"] = json!({"private":{"opengemDraft":input.draft_id.to_ascii_lowercase(),"opengemFingerprint":fingerprint}});
    Ok(body)
}

fn matches_existing(event: &RawCalendarEvent, body: &Value) -> bool {
    event.status != "cancelled"
        && event.extended_properties.get("private")
            == body
                .get("extendedProperties")
                .and_then(|v| v.get("private"))
        && body.get("summary").and_then(Value::as_str) == Some(event.summary.as_str())
        && body.get("description").and_then(Value::as_str) == Some(event.description.as_str())
        && body.get("location").and_then(Value::as_str) == Some(event.location.as_str())
        && ["start", "end"].iter().all(|field| {
            let actual = if *field == "start" {
                &event.start
            } else {
                &event.end
            };
            body.get(*field)
                .and_then(|v| serde_json::from_value::<EventTime>(v.clone()).ok())
                .and_then(|expected| event_time(&expected).ok())
                .zip(event_time(actual).ok())
                .is_some_and(|(expected, actual)| expected == actual)
        })
}

fn create_event(path: &Path, input: CreateEventInput) -> Result<CalendarEvent, String> {
    let body = event_body(&input)?;
    let url = calendar_url(&input.calendar_id, None)?;
    // 초대 대상 필드를 받지 않고 알림 전송을 끕니다. 동일 초안의 재시도는 같은 Google ID를 사용합니다.
    let response = google_request_for_account(
        path,
        GoogleService::Calendar,
        Method::POST,
        &url,
        &[("sendUpdates", "none"), ("fields", EVENT_FIELDS)],
        Some(&body),
        RESPONSE_LIMIT,
        &input.expected_account_email,
    )?;
    if response.status == 409 {
        let id = body["id"]
            .as_str()
            .ok_or_else(|| "일정 초안 ID가 없습니다.".to_string())?;
        let existing = google_request_for_account(
            path,
            GoogleService::Calendar,
            Method::GET,
            &calendar_url(&input.calendar_id, Some(id))?,
            &[("fields", EVENT_FIELDS)],
            None,
            RESPONSE_LIMIT,
            &input.expected_account_email,
        )?;
        if response.account_email != existing.account_email {
            return Err("Calendar 계정이 변경되었습니다. 연결 상태를 확인해 주세요.".to_string());
        }
        let event: RawCalendarEvent = parse_json(&existing.bytes)?;
        if !matches_existing(&event, &body) {
            return Err("같은 초안 ID의 일정이 이미 다른 내용으로 등록되어 있습니다. 기존 일정을 확인하고 새 초안을 만들어 주세요.".to_string());
        }
        return Ok(to_calendar_event(event));
    }
    Ok(to_calendar_event(parse_json(&response.bytes)?))
}

#[tauri::command]
pub async fn create_google_calendar_event(
    state: State<'_, AppState>,
    input: CreateEventInput,
) -> Result<CalendarEvent, String> {
    let path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || create_event(&path, input))
        .await
        .map_err(|_| {
            "일정 등록 응답을 확인하지 못했습니다. 같은 초안으로 다시 시도해 주세요.".to_string()
        })?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> CreateEventInput {
        CreateEventInput {
            calendar_id: "primary".into(),
            expected_account_email: "owner@example.test".into(),
            draft_id: "a156601a-3533-4f78-a89a-8d24cf18438c".into(),
            title: "검토한 회의".into(),
            description: Some("원문에서 확인한 일정".into()),
            location: Some("온라인".into()),
            start: EventTime {
                date_time: Some("2026-11-12T14:00:00+09:00".into()),
                date: None,
                time_zone: Some("Asia/Seoul".into()),
            },
            end: EventTime {
                date_time: Some("2026-11-12T15:00:00+09:00".into()),
                date: None,
                time_zone: Some("Asia/Seoul".into()),
            },
        }
    }

    #[test]
    fn drive_search_escapes_queries_and_rejects_bad_ids() {
        assert_eq!(drive_search_query(None).unwrap(), "trashed = false");
        assert_eq!(
            drive_search_query(Some("team's \\ notes")).unwrap(),
            "trashed = false and fullText contains 'team\\'s \\\\ notes'"
        );
        assert!(drive_search_query(Some("line\nother")).is_err());
        assert!(drive_url("../token", None).is_err());
        assert!(drive_url("https://example.test", None).is_err());
        assert!(drive_url("file_-123", Some("export"))
            .unwrap()
            .ends_with("file_-123/export"));
    }

    #[test]
    fn calendar_paths_encode_ids_and_link_hosts_are_restricted() {
        let result = calendar_url("team#holiday@example.test", None).unwrap();
        assert!(result.contains("team%23holiday@example.test/events"));
        assert_eq!(
            Url::parse(&result).unwrap().host_str(),
            Some("www.googleapis.com")
        );
        assert_eq!(
            safe_google_link(
                "https://evil.test/file",
                &["drive.google.com"],
                "fallback".into()
            ),
            "fallback"
        );
        assert_eq!(
            safe_google_link(
                "https://user:secret@drive.google.com/file",
                &["drive.google.com"],
                "fallback".into()
            ),
            "fallback"
        );
    }

    #[test]
    fn timestamps_compare_offsets_and_reject_ambiguous_or_invalid_dates() {
        assert_eq!(
            parse_timestamp("2026-11-12T14:00:00+09:00").unwrap(),
            parse_timestamp("2026-11-12T05:00:00Z").unwrap()
        );
        assert_eq!(parse_timestamp("1970-01-01T00:00:00Z").unwrap(), 0);
        assert_eq!(
            parse_timestamp("2026-11-12T05:00:00.001Z").unwrap()
                - parse_timestamp("2026-11-12T05:00:00Z").unwrap(),
            1_000_000
        );
        assert!(parse_date("2024-02-29").is_ok());
        for value in [
            "2026-02-29T00:00:00Z",
            "2026-11-12T14:00:00",
            "2026-11-12T24:00:00Z",
            "2026-11-12T14:00:00+99:00",
            "2026-11-12T14:00:00.Z",
            "일정없음",
        ] {
            assert!(parse_timestamp(value).is_err(), "{value}");
        }
    }

    #[test]
    fn reviewed_event_payload_has_no_invite_fields_and_retries_use_stable_id() {
        let draft = input();
        let first = event_body(&draft).unwrap();
        let second = event_body(&draft).unwrap();
        assert_eq!(first, second);
        assert!(first["id"]
            .as_str()
            .unwrap()
            .chars()
            .all(|c| c.is_ascii_digit() || ('a'..='v').contains(&c)));
        assert!(first.get("attendees").is_none());
        assert!(first.get("conferenceData").is_none());
        let mut korean = input();
        korean.title = "가".repeat(500);
        korean.description = Some("설".repeat(8000));
        korean.location = Some("장".repeat(1000));
        assert!(event_body(&korean).is_ok());
        assert_eq!(first["guestsCanInviteOthers"], false);
        let mut with_attendees=serde_json::to_value(json!({"calendarId":"primary","expectedAccountEmail":"owner@example.test","draftId":draft.draft_id,"title":draft.title,"start":draft.start,"end":draft.end})).unwrap();
        with_attendees["attendees"] = json!([{"email":"other@example.test"}]);
        assert!(serde_json::from_value::<CreateEventInput>(with_attendees).is_err());
    }

    #[test]
    fn event_validation_enforces_exclusive_end_and_same_date_kind() {
        let mut draft = input();
        draft.end = draft.start.clone();
        assert!(event_body(&draft).is_err());
        draft.start = EventTime {
            date: Some("2026-11-12".into()),
            ..Default::default()
        };
        draft.end = EventTime {
            date: Some("2026-11-13".into()),
            ..Default::default()
        };
        assert!(event_body(&draft).is_ok());
        draft.end = input().end;
        assert!(event_body(&draft).is_err());
        draft = input();
        draft.draft_id = "../bad".into();
        assert!(event_body(&draft).is_err());
        draft = input();
        draft.expected_account_email.clear();
        assert!(event_body(&draft).is_err());
    }

    #[test]
    fn idempotent_retry_rejects_modified_or_deleted_remote_events() {
        let body = event_body(&input()).unwrap();
        let mut event: RawCalendarEvent = serde_json::from_value(body.clone()).unwrap();
        event.status = "confirmed".into();
        assert!(matches_existing(&event, &body));
        event.start.date_time = Some("2026-11-12T05:00:00Z".into());
        assert!(matches_existing(&event, &body));
        event.summary = "누군가 바꾼 제목".into();
        assert!(!matches_existing(&event, &body));
        event.summary = body["summary"].as_str().unwrap().into();
        event.status = "cancelled".into();
        assert!(!matches_existing(&event, &body));
    }

    #[test]
    fn unicode_content_bounds_do_not_split_characters() {
        assert_eq!(limited_text("가나다😀", 3), "가나다");
        assert!(validate_range(0, 367i128 * 86400 * 1_000_000_000).is_err());
        assert!(validate_page_token(Some(&"a".repeat(4097))).is_err());
    }
}
