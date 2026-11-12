use rand::random;
use serde::{Deserialize, Serialize};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[cfg(windows)]
mod windows;
#[cfg(windows)]
use windows as platform;
#[cfg(not(windows))]
mod unsupported;
#[cfg(not(windows))]
use unsupported as platform;

const SESSION_MS: u64 = 5 * 60 * 1000;
const OBSERVATION_MS: u64 = 60 * 1000;
const MAX_ACTIONS: u32 = 50;
const MAX_TEXT_CHARS: usize = 2_000;
#[cfg(not(windows))]
const UNSUPPORTED: &str = "컴퓨터 제어는 현재 Windows에서만 사용할 수 있습니다.";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerWindow {
    pub id: String,
    pub title: String,
    pub process_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerStatus {
    pub supported: bool,
    pub session_id: Option<String>,
    pub window: Option<ComputerWindow>,
    pub expires_at: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerObservation {
    pub session_id: String,
    pub observation_id: String,
    pub width: u32,
    pub height: u32,
    pub image_data_url: String,
    pub window_title: String,
    pub captured_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ComputerAction {
    Click {
        x: i32,
        y: i32,
        button: MouseButton,
        #[serde(rename = "clickCount")]
        click_count: u8,
    },
    Type {
        text: String,
    },
    Key {
        key: String,
    },
    Scroll {
        x: i32,
        y: i32,
        #[serde(rename = "deltaY")]
        delta_y: i32,
    },
    Wait {
        #[serde(rename = "durationMs")]
        duration_ms: u64,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MouseButton {
    Left,
    Right,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComputerActionInput {
    pub session_id: String,
    pub observation_id: String,
    pub action: ComputerAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct WindowRect {
    left: i32,
    top: i32,
    width: u32,
    height: u32,
}

struct CapturedWindow {
    rect: WindowRect,
    image_data_url: String,
    title: String,
}

#[derive(Clone)]
struct Observation {
    id: String,
    rect: WindowRect,
    captured_at: u64,
}

#[derive(Default)]
struct SessionProgress {
    latest: Option<Observation>,
    actions: u32,
}

struct Session {
    id: String,
    target: platform::Target,
    expires_at: u64,
    cancelled: AtomicBool,
    progress: Mutex<SessionProgress>,
}

static SESSION: OnceLock<Mutex<Option<Arc<Session>>>> = OnceLock::new();
// 화면 포커스/입력은 프로세스 전체에서 한 번에 한 작업만 수행합니다.
static DESKTOP_OPERATION: Mutex<()> = Mutex::new(());

fn sessions() -> &'static Mutex<Option<Arc<Session>>> {
    SESSION.get_or_init(|| Mutex::new(None))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn token() -> String {
    format!("{:032x}", random::<u128>())
}

fn check_session(session: &Session) -> Result<(), String> {
    if session.cancelled.load(Ordering::Acquire) {
        return Err("컴퓨터 제어가 중지되었습니다. 다시 시작해 주세요.".into());
    }
    if now_ms() >= session.expires_at {
        session.cancelled.store(true, Ordering::Release);
        return Err("컴퓨터 제어의 5분 제한에 도달했습니다. 다시 시작해 주세요.".into());
    }
    Ok(())
}

fn find_session(id: &str) -> Result<Arc<Session>, String> {
    let state = sessions()
        .lock()
        .map_err(|_| "컴퓨터 제어 상태를 확인하지 못했습니다.")?;
    let session = state
        .as_ref()
        .filter(|session| session.id == id)
        .cloned()
        .ok_or("이 컴퓨터 제어 요청은 더 이상 활성 상태가 아닙니다.")?;
    check_session(&session)?;
    Ok(session)
}

fn validate_action(action: &ComputerAction, rect: WindowRect) -> Result<(), String> {
    let in_bounds =
        |x: i32, y: i32| x >= 0 && y >= 0 && (x as u32) < rect.width && (y as u32) < rect.height;
    match action {
        ComputerAction::Click {
            x, y, click_count, ..
        } => {
            if !in_bounds(*x, *y) || !matches!(click_count, 1 | 2) {
                return Err("클릭 좌표나 횟수가 선택한 창의 허용 범위를 벗어났습니다.".into());
            }
        }
        ComputerAction::Scroll { x, y, delta_y } => {
            if !in_bounds(*x, *y) || *delta_y == 0 || !(-1_200..=1_200).contains(delta_y) {
                return Err("스크롤 좌표나 양이 허용 범위를 벗어났습니다.".into());
            }
        }
        ComputerAction::Type { text } => {
            if text.is_empty()
                || text.chars().count() > MAX_TEXT_CHARS
                || text
                    .chars()
                    .any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t')
            {
                return Err("입력할 텍스트는 제어 문자 없이 1~2,000자로 지정해 주세요.".into());
            }
        }
        ComputerAction::Key { key } => {
            if !matches!(
                key.as_str(),
                "Enter"
                    | "Tab"
                    | "Escape"
                    | "Backspace"
                    | "Delete"
                    | "ArrowUp"
                    | "ArrowDown"
                    | "ArrowLeft"
                    | "ArrowRight"
                    | "Home"
                    | "End"
                    | "PageUp"
                    | "PageDown"
                    | "Ctrl+A"
                    | "Ctrl+C"
                    | "Ctrl+V"
                    | "Ctrl+X"
                    | "Ctrl+Z"
                    | "Ctrl+F"
                    | "Ctrl+S"
                    | "Ctrl+L"
            ) {
                return Err("허용하지 않은 키 조합입니다.".into());
            }
        }
        ComputerAction::Wait { duration_ms } => {
            if !(50..=2_000).contains(duration_ms) {
                return Err("대기는 50~2,000ms로 지정해 주세요.".into());
            }
        }
    }
    Ok(())
}

fn consume_observation(
    progress: &mut SessionProgress,
    observation_id: &str,
    now: u64,
) -> Result<Observation, String> {
    // 성공/실패와 관계없이 이전 화면을 재사용해 입력하지 않도록 먼저 소모합니다.
    let observation = progress
        .latest
        .take()
        .ok_or("현재 화면을 먼저 다시 확인해 주세요. 이전 관찰로 입력을 재시도할 수 없습니다.")?;
    if observation.id != observation_id
        || now.saturating_sub(observation.captured_at) > OBSERVATION_MS
    {
        return Err("화면 관찰이 오래되었거나 일치하지 않습니다. 다시 확인해 주세요.".into());
    }
    if progress.actions >= MAX_ACTIONS {
        return Err("한 요청의 입력 50회 제한에 도달했습니다. 다시 시작해 주세요.".into());
    }
    Ok(observation)
}

fn record_observation(
    session: &Session,
    progress: &mut SessionProgress,
    captured: CapturedWindow,
) -> Result<ComputerObservation, String> {
    check_session(session)?;
    let id = token();
    let captured_at = now_ms();
    progress.latest = Some(Observation {
        id: id.clone(),
        rect: captured.rect,
        captured_at,
    });
    Ok(ComputerObservation {
        session_id: session.id.clone(),
        observation_id: id,
        width: captured.rect.width,
        height: captured.rect.height,
        image_data_url: captured.image_data_url,
        window_title: captured.title,
        captured_at,
    })
}

#[tauri::command]
pub async fn list_computer_windows() -> Result<Vec<ComputerWindow>, String> {
    tauri::async_runtime::spawn_blocking(platform::list_windows)
        .await
        .map_err(|_| "창 목록을 읽지 못했습니다.".to_string())?
}

#[tauri::command]
pub fn get_computer_status() -> Result<ComputerStatus, String> {
    let state = sessions()
        .lock()
        .map_err(|_| "컴퓨터 제어 상태를 확인하지 못했습니다.")?;
    let session = state
        .as_ref()
        .filter(|session| check_session(session).is_ok());
    Ok(ComputerStatus {
        supported: cfg!(windows),
        session_id: session.map(|s| s.id.clone()),
        window: session.map(|s| s.target.window.clone()),
        expires_at: session.map(|s| s.expires_at),
    })
}

#[tauri::command]
pub async fn start_computer_session(window_id: String) -> Result<ComputerStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = platform::select_window(&window_id)?;
        let session = Arc::new(Session {
            id: token(),
            target,
            expires_at: now_ms() + SESSION_MS,
            cancelled: AtomicBool::new(false),
            progress: Mutex::new(SessionProgress::default()),
        });
        {
            let mut state = sessions()
                .lock()
                .map_err(|_| "컴퓨터 제어 상태를 변경하지 못했습니다.")?;
            if state
                .as_ref()
                .is_some_and(|previous| check_session(previous).is_ok())
            {
                return Err(
                    "이미 컴퓨터 제어가 진행 중입니다. 현재 작업을 중지한 뒤 다시 시작해 주세요."
                        .into(),
                );
            }
            if let Some(previous) = state.replace(Arc::clone(&session)) {
                previous.cancelled.store(true, Ordering::Release);
            }
        }
        let weak = Arc::downgrade(&session);
        // OpenGem이 뒤에 있어도 F8로 이후 입력을 즉시 무효화합니다.
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(40));
            let Some(session) = weak.upgrade() else { break };
            if platform::emergency_stop_pressed() || now_ms() >= session.expires_at {
                session.cancelled.store(true, Ordering::Release);
            }
            if session.cancelled.load(Ordering::Acquire) {
                break;
            }
        });
        Ok(ComputerStatus {
            supported: true,
            session_id: Some(session.id.clone()),
            window: Some(session.target.window.clone()),
            expires_at: Some(session.expires_at),
        })
    })
    .await
    .map_err(|_| "컴퓨터 제어를 시작하지 못했습니다.".to_string())?
}

#[tauri::command]
pub async fn observe_computer_session(session_id: String) -> Result<ComputerObservation, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let session = find_session(&session_id)?;
        let _desktop = DESKTOP_OPERATION
            .lock()
            .map_err(|_| "화면을 확인하지 못했습니다.")?;
        check_session(&session)?;
        let mut progress = session
            .progress
            .lock()
            .map_err(|_| "관찰 상태를 읽지 못했습니다.")?;
        progress.latest = None;
        let captured = platform::observe(&session.target, &|| check_session(&session))?;
        record_observation(&session, &mut progress, captured)
    })
    .await
    .map_err(|_| "화면 관찰을 완료하지 못했습니다.".to_string())?
}

#[tauri::command]
pub async fn act_computer_session(
    input: ComputerActionInput,
) -> Result<ComputerObservation, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let session = find_session(&input.session_id)?;
        let _desktop = DESKTOP_OPERATION
            .lock()
            .map_err(|_| "입력을 실행하지 못했습니다.")?;
        check_session(&session)?;
        let mut progress = session
            .progress
            .lock()
            .map_err(|_| "입력 상태를 읽지 못했습니다.")?;
        let observation = consume_observation(&mut progress, &input.observation_id, now_ms())?;
        validate_action(&input.action, observation.rect)?;
        progress.actions += 1;
        let captured = platform::act(&session.target, observation.rect, &input.action, &|| {
            check_session(&session)
        })?;
        record_observation(&session, &mut progress, captured)
    })
    .await
    .map_err(|_| "컴퓨터 입력을 완료하지 못했습니다. 화면을 다시 확인해 주세요.".to_string())?
}

#[tauri::command]
pub fn stop_computer_session(session_id: String) -> Result<(), String> {
    let mut state = sessions()
        .lock()
        .map_err(|_| "컴퓨터 제어 상태를 변경하지 못했습니다.")?;
    if state
        .as_ref()
        .is_some_and(|session| session.id == session_id)
    {
        if let Some(session) = state.take() {
            session.cancelled.store(true, Ordering::Release);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rect() -> WindowRect {
        WindowRect {
            left: -1200,
            top: 0,
            width: 1000,
            height: 700,
        }
    }
    fn observation() -> Observation {
        Observation {
            id: "current".into(),
            rect: rect(),
            captured_at: 1000,
        }
    }
    #[test]
    fn input_coordinates_are_window_relative_and_bounded() {
        for (x, y) in [(-1, 10), (1000, 10), (0, 700)] {
            assert!(validate_action(
                &ComputerAction::Click {
                    x,
                    y,
                    button: MouseButton::Left,
                    click_count: 1
                },
                rect()
            )
            .is_err());
        }
        assert!(validate_action(
            &ComputerAction::Click {
                x: 0,
                y: 0,
                button: MouseButton::Left,
                click_count: 2
            },
            rect()
        )
        .is_ok());
        assert!(validate_action(
            &ComputerAction::Scroll {
                x: 10,
                y: 10,
                delta_y: i32::MIN
            },
            rect()
        )
        .is_err());
    }
    #[test]
    fn stale_and_failed_observations_cannot_be_replayed() {
        let mut progress = SessionProgress {
            latest: Some(observation()),
            actions: 0,
        };
        assert!(consume_observation(&mut progress, "wrong", 1000).is_err());
        assert!(consume_observation(&mut progress, "current", 1000).is_err());
        progress.latest = Some(observation());
        assert!(consume_observation(&mut progress, "current", 61_001).is_err());
        assert!(progress.latest.is_none());
    }
    #[test]
    fn observation_is_one_use_and_action_budget_is_bounded() {
        let mut progress = SessionProgress {
            latest: Some(observation()),
            actions: 49,
        };
        assert!(consume_observation(&mut progress, "current", 1000).is_ok());
        assert!(progress.latest.is_none());
        progress.actions = 50;
        progress.latest = Some(observation());
        assert!(consume_observation(&mut progress, "current", 1000).is_err());
    }
    #[test]
    fn keys_text_wait_and_unknown_fields_are_restricted() {
        assert!(validate_action(
            &ComputerAction::Key {
                key: "Win+R".into()
            },
            rect()
        )
        .is_err());
        assert!(validate_action(
            &ComputerAction::Key {
                key: "Alt+F4".into()
            },
            rect()
        )
        .is_err());
        assert!(validate_action(
            &ComputerAction::Key {
                key: "Ctrl+A".into()
            },
            rect()
        )
        .is_ok());
        assert!(validate_action(
            &ComputerAction::Type {
                text: "안녕하세요\n테스트".into()
            },
            rect()
        )
        .is_ok());
        assert!(validate_action(&ComputerAction::Type { text: "\0".into() }, rect()).is_err());
        assert!(validate_action(
            &ComputerAction::Type {
                text: "가".repeat(2001)
            },
            rect()
        )
        .is_err());
        assert!(validate_action(&ComputerAction::Wait { duration_ms: 2001 }, rect()).is_err());
        assert!(serde_json::from_str::<ComputerAction>(
            r#"{"kind":"click","x":1,"y":1,"button":"left","clickCount":1,"command":"bad"}"#
        )
        .is_err());
    }
    #[test]
    fn input_payload_cannot_choose_another_window_or_change_the_session() {
        assert!(serde_json::from_str::<ComputerActionInput>(r#"{"sessionId":"s","observationId":"o","windowId":"other","action":{"kind":"key","key":"Enter"}}"#).is_err());
        assert!(serde_json::from_str::<ComputerAction>(
            r#"{"kind":"click","x":1.25,"y":1,"button":"left","clickCount":1}"#
        )
        .is_err());
        assert!(
            serde_json::from_str::<ComputerAction>(r#"{"kind":"shell","command":"anything"}"#)
                .is_err()
        );
        #[cfg(not(windows))]
        assert!(platform::select_window("anything").is_err());
    }
}
