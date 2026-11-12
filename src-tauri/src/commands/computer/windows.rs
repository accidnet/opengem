use super::{CapturedWindow, ComputerAction, ComputerWindow, MouseButton, WindowRect};
use base64::Engine;
use std::{
    mem::{size_of, zeroed},
    ptr::null_mut,
    thread,
    time::Duration,
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, BOOL, FILETIME, HWND, LPARAM, POINT, RECT},
    Graphics::{
        Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS},
        Gdi::{
            BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
            GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT,
            DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ, SRCCOPY,
        },
    },
    System::Threading::{
        GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    },
    UI::{
        HiDpi::{
            SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT,
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        },
        Input::KeyboardAndMouse::*,
        WindowsAndMessaging::*,
    },
};

const MAX_PIXELS: u64 = 12_000_000;
const MAX_PNG_BYTES: usize = 4 * 1024 * 1024;

pub(super) struct Target {
    pub window: ComputerWindow,
    handle: usize,
    pid: u32,
    created_at: u64,
    thread_id: u32,
    class_name: String,
}

struct DpiGuard(DPI_AWARENESS_CONTEXT);
impl DpiGuard {
    fn new() -> Self {
        Self(unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) })
    }
}
impl Drop for DpiGuard {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                SetThreadDpiAwarenessContext(self.0);
            }
        }
    }
}

struct FocusGuard {
    previous: HWND,
    target: HWND,
    target_pid: u32,
}
impl Drop for FocusGuard {
    fn drop(&mut self) {
        unsafe {
            let foreground = GetForegroundWindow();
            let mut pid = 0;
            GetWindowThreadProcessId(foreground, &mut pid);
            // 사용자가 다른 앱을 선택했으면 포커스를 다시 빼앗지 않습니다.
            if (foreground == self.target || pid == self.target_pid)
                && !self.previous.is_null()
                && self.previous != self.target
                && IsWindow(self.previous) != 0
            {
                SetForegroundWindow(self.previous);
            }
        }
    }
}

struct BitmapCapture {
    screen: HDC,
    memory: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
}
impl Drop for BitmapCapture {
    fn drop(&mut self) {
        unsafe {
            if !self.previous.is_null() {
                SelectObject(self.memory, self.previous);
            }
            if !self.bitmap.is_null() {
                DeleteObject(self.bitmap);
            }
            if !self.memory.is_null() {
                DeleteDC(self.memory);
            }
            if !self.screen.is_null() {
                ReleaseDC(null_mut(), self.screen);
            }
        }
    }
}

fn hwnd(target: &Target) -> HWND {
    target.handle as HWND
}

fn process_identity(pid: u32) -> Option<(u64, String)> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return None;
        }
        let mut created: FILETIME = zeroed();
        let mut exited: FILETIME = zeroed();
        let mut kernel: FILETIME = zeroed();
        let mut user: FILETIME = zeroed();
        let valid =
            GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user) != 0;
        let mut path = [0u16; 32768];
        let mut length = path.len() as u32;
        let named = QueryFullProcessImageNameW(process, 0, path.as_mut_ptr(), &mut length) != 0;
        CloseHandle(process);
        if !valid || !named {
            return None;
        }
        let path = String::from_utf16_lossy(&path[..length as usize]);
        let name = path.rsplit(['\\', '/']).next().unwrap_or(&path).to_string();
        Some((
            ((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64,
            name,
        ))
    }
}

fn title(handle: HWND) -> String {
    let mut text = [0u16; 512];
    let length = unsafe { GetWindowTextW(handle, text.as_mut_ptr(), text.len() as i32) };
    String::from_utf16_lossy(&text[..length.max(0) as usize])
}

fn class_name(handle: HWND) -> String {
    let mut text = [0u16; 256];
    let length = unsafe { GetClassNameW(handle, text.as_mut_ptr(), text.len() as i32) };
    String::from_utf16_lossy(&text[..length.max(0) as usize])
}

fn cloaked(handle: HWND) -> bool {
    let mut value: u32 = 0;
    unsafe {
        DwmGetWindowAttribute(
            handle,
            DWMWA_CLOAKED as u32,
            &mut value as *mut _ as _,
            size_of::<u32>() as u32,
        );
    }
    value != 0
}

fn target_from_handle(handle: HWND) -> Option<Target> {
    unsafe {
        if IsWindowVisible(handle) == 0 || IsIconic(handle) != 0 || cloaked(handle) {
            return None;
        }
        if GetWindowLongPtrW(handle, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW != 0 {
            return None;
        }
        let text = title(handle);
        if text.trim().is_empty() {
            return None;
        }
        let mut pid = 0;
        let thread_id = GetWindowThreadProcessId(handle, &mut pid);
        if pid == std::process::id() || thread_id == 0 {
            return None;
        }
        let (created_at, process_name) = process_identity(pid)?;
        let class_name = class_name(handle);
        let id = format!(
            "{:x}-{}-{:x}-{}",
            handle as usize, pid, created_at, thread_id
        );
        Some(Target {
            window: ComputerWindow {
                id,
                title: text,
                process_name,
            },
            handle: handle as usize,
            pid,
            created_at,
            thread_id,
            class_name,
        })
    }
}

unsafe extern "system" fn collect_window(handle: HWND, data: LPARAM) -> BOOL {
    let targets = &mut *(data as *mut Vec<Target>);
    if targets.len() >= 200 {
        return 0;
    }
    if let Some(target) = target_from_handle(handle) {
        targets.push(target);
    }
    1
}

fn targets() -> Vec<Target> {
    let _dpi = DpiGuard::new();
    let mut targets = Vec::new();
    unsafe {
        EnumWindows(Some(collect_window), &mut targets as *mut _ as LPARAM);
    }
    targets
}

pub(super) fn list_windows() -> Result<Vec<ComputerWindow>, String> {
    Ok(targets().into_iter().map(|target| target.window).collect())
}

pub(super) fn select_window(id: &str) -> Result<Target, String> {
    targets()
        .into_iter()
        .find(|target| target.window.id == id)
        .ok_or_else(|| "선택한 창을 찾지 못했습니다. 창을 열고 목록을 새로 고쳐 주세요.".into())
}

pub(super) fn emergency_stop_pressed() -> bool {
    unsafe { GetAsyncKeyState(VK_F8 as i32) < 0 }
}

fn verify_target(target: &Target) -> Result<(), String> {
    let handle = hwnd(target);
    unsafe {
        let mut pid = 0;
        let thread_id = GetWindowThreadProcessId(handle, &mut pid);
        if IsWindow(handle) == 0
            || IsWindowVisible(handle) == 0
            || IsIconic(handle) != 0
            || cloaked(handle)
            || pid != target.pid
            || thread_id != target.thread_id
            || class_name(handle) != target.class_name
            || process_identity(pid).map(|identity| identity.0) != Some(target.created_at)
        {
            return Err("선택한 창이 닫혔거나 변경되었습니다. 창을 다시 선택해 주세요.".into());
        }
    }
    Ok(())
}

fn focus(target: &Target, check: &dyn Fn() -> Result<(), String>) -> Result<FocusGuard, String> {
    check()?;
    verify_target(target)?;
    let handle = hwnd(target);
    let guard = FocusGuard {
        previous: unsafe { GetForegroundWindow() },
        target: handle,
        target_pid: target.pid,
    };
    if guard.previous != handle {
        unsafe {
            SetForegroundWindow(handle);
        }
        for _ in 0..10 {
            check()?;
            if unsafe { GetForegroundWindow() } == handle {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
    }
    check()?;
    if unsafe { GetForegroundWindow() } != handle {
        return Err("선택한 창을 전면으로 가져오지 못했습니다. 해당 창을 직접 선택한 뒤 다시 시도해 주세요.".into());
    }
    // 전면 전환 애니메이션이 끝난 화면을 캡처합니다.
    for _ in 0..5 {
        check()?;
        thread::sleep(Duration::from_millis(20));
    }
    Ok(guard)
}

fn raw_rect_for(handle: HWND) -> Result<WindowRect, String> {
    let mut bounds: RECT = unsafe { zeroed() };
    unsafe {
        if DwmGetWindowAttribute(
            handle,
            DWMWA_EXTENDED_FRAME_BOUNDS as u32,
            &mut bounds as *mut _ as _,
            size_of::<RECT>() as u32,
        ) < 0
            && GetWindowRect(handle, &mut bounds) == 0
        {
            return Err("창의 위치와 크기를 읽지 못했습니다.".into());
        }
    }
    let width = bounds.right as i64 - bounds.left as i64;
    let height = bounds.bottom as i64 - bounds.top as i64;
    if width <= 0 || height <= 0 || width > u32::MAX as i64 || height > u32::MAX as i64 {
        return Err(
            "창 크기를 확인할 수 없거나 너무 큽니다. 창을 줄인 뒤 다시 시도해 주세요.".into(),
        );
    }
    Ok(WindowRect {
        left: bounds.left,
        top: bounds.top,
        width: width as u32,
        height: height as u32,
    })
}

fn rect_for(handle: HWND) -> Result<WindowRect, String> {
    let rect = raw_rect_for(handle)?;
    if rect.width as u64 * rect.height as u64 > MAX_PIXELS {
        return Err("창이 너무 큽니다. 창을 줄인 뒤 다시 시도해 주세요.".into());
    }
    unsafe {
        let left = GetSystemMetrics(SM_XVIRTUALSCREEN) as i64;
        let top = GetSystemMetrics(SM_YVIRTUALSCREEN) as i64;
        let right = left + GetSystemMetrics(SM_CXVIRTUALSCREEN) as i64;
        let bottom = top + GetSystemMetrics(SM_CYVIRTUALSCREEN) as i64;
        if (rect.left as i64) < left
            || (rect.top as i64) < top
            || rect.left as i64 + rect.width as i64 > right
            || rect.top as i64 + rect.height as i64 > bottom
        {
            return Err(
                "선택한 창 전체가 화면 안에 보여야 합니다. 창 위치를 조정해 주세요.".into(),
            );
        }
    }
    Ok(rect)
}

fn overlaps(first: WindowRect, second: WindowRect) -> bool {
    (first.left as i64) < second.left as i64 + second.width as i64
        && first.left as i64 + first.width as i64 > second.left as i64
        && (first.top as i64) < second.top as i64 + second.height as i64
        && first.top as i64 + first.height as i64 > second.top as i64
}

struct OcclusionCheck {
    target: HWND,
    rect: WindowRect,
    found: bool,
    blocked: bool,
}
unsafe extern "system" fn check_occlusion(handle: HWND, data: LPARAM) -> BOOL {
    let state = &mut *(data as *mut OcclusionCheck);
    if handle == state.target {
        state.found = true;
        return 0;
    }
    if IsWindowVisible(handle) != 0 && IsIconic(handle) == 0 && !cloaked(handle) {
        if let Ok(rect) = raw_rect_for(handle) {
            if overlaps(rect, state.rect) {
                state.blocked = true;
                return 0;
            }
        }
    }
    1
}

fn verify_visible(target: &Target, rect: WindowRect) -> Result<(), String> {
    verify_target(target)?;
    if rect_for(hwnd(target))? != rect {
        return Err("관찰 후 창 위치나 크기가 변경되었습니다. 화면을 다시 확인해 주세요.".into());
    }
    if unsafe { GetForegroundWindow() } != hwnd(target) {
        return Err("입력 중 전면 창이 변경되었습니다. 화면을 다시 확인해 주세요.".into());
    }
    let mut state = OcclusionCheck {
        target: hwnd(target),
        rect,
        found: false,
        blocked: false,
    };
    unsafe {
        EnumWindows(Some(check_occlusion), &mut state as *mut _ as LPARAM);
    }
    if state.blocked || !state.found {
        return Err(
            "다른 창이 선택한 창을 가리고 있습니다. 겹친 창을 치운 뒤 다시 시도해 주세요.".into(),
        );
    }
    Ok(())
}

fn capture_pixels(rect: WindowRect) -> Result<String, String> {
    unsafe {
        let mut capture = BitmapCapture {
            screen: GetDC(null_mut()),
            memory: null_mut(),
            bitmap: null_mut(),
            previous: null_mut(),
        };
        if capture.screen.is_null() {
            return Err("화면 캡처 장치를 열지 못했습니다.".into());
        }
        capture.memory = CreateCompatibleDC(capture.screen);
        capture.bitmap =
            CreateCompatibleBitmap(capture.screen, rect.width as i32, rect.height as i32);
        if capture.memory.is_null() || capture.bitmap.is_null() {
            return Err("화면 캡처 메모리를 준비하지 못했습니다.".into());
        }
        capture.previous = SelectObject(capture.memory, capture.bitmap);
        if capture.previous.is_null() || capture.previous as isize == -1 {
            capture.previous = null_mut();
            return Err("화면 캡처 비트맵을 선택하지 못했습니다.".into());
        }
        if BitBlt(
            capture.memory,
            0,
            0,
            rect.width as i32,
            rect.height as i32,
            capture.screen,
            rect.left,
            rect.top,
            SRCCOPY | CAPTUREBLT,
        ) == 0
        {
            return Err("이 창의 화면을 캡처하지 못했습니다.".into());
        }
        SelectObject(capture.memory, capture.previous);
        capture.previous = null_mut();
        let mut info: BITMAPINFO = zeroed();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: rect.width as i32,
            biHeight: -(rect.height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            ..zeroed()
        };
        let mut rgba = vec![0u8; rect.width as usize * rect.height as usize * 4];
        if GetDIBits(
            capture.screen,
            capture.bitmap,
            0,
            rect.height,
            rgba.as_mut_ptr() as _,
            &mut info,
            DIB_RGB_COLORS,
        ) != rect.height as i32
        {
            return Err("화면 픽셀을 읽지 못했습니다.".into());
        }
        for pixel in rgba.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            pixel[3] = 255;
        }
        let mut png_bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png_bytes, rect.width, rect.height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.set_compression(png::Compression::Fast);
            let mut writer = encoder
                .write_header()
                .map_err(|_| "화면 이미지를 만들지 못했습니다.")?;
            writer
                .write_image_data(&rgba)
                .map_err(|_| "화면 이미지를 인코딩하지 못했습니다.")?;
        }
        if png_bytes.len() > MAX_PNG_BYTES {
            return Err(
                "화면 이미지가 4MiB를 넘습니다. 창 크기를 줄인 뒤 다시 시도해 주세요.".into(),
            );
        }
        Ok(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png_bytes)
        ))
    }
}

fn capture_focused(
    target: &Target,
    check: &dyn Fn() -> Result<(), String>,
) -> Result<CapturedWindow, String> {
    check()?;
    let rect = rect_for(hwnd(target))?;
    let mut affinity = 0u32;
    if unsafe { GetWindowDisplayAffinity(hwnd(target), &mut affinity) } != 0 && affinity != 0 {
        return Err("화면 캡처가 보호된 창은 제어할 수 없습니다.".into());
    }
    verify_visible(target, rect)?;
    let image_data_url = capture_pixels(rect)?;
    check()?;
    verify_visible(target, rect)?;
    if rect_for(hwnd(target))? != rect {
        return Err("캡처 중 창 위치가 변경되었습니다. 다시 확인해 주세요.".into());
    }
    Ok(CapturedWindow {
        rect,
        image_data_url,
        title: title(hwnd(target)),
    })
}

pub(super) fn observe(
    target: &Target,
    check: &dyn Fn() -> Result<(), String>,
) -> Result<CapturedWindow, String> {
    let _dpi = DpiGuard::new();
    let _focus = focus(target, check)?;
    capture_focused(target, check)
}

fn neutral_modifiers() -> Result<(), String> {
    let pressed = [VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN]
        .into_iter()
        .any(|key| unsafe { GetAsyncKeyState(key as i32) < 0 });
    if pressed {
        return Err("키보드의 Ctrl/Shift/Alt/Windows 키를 놓은 뒤 다시 시도해 주세요.".into());
    }
    Ok(())
}

fn keyboard(vk: u16, scan: u16, flags: u32) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: scan,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}
fn mouse(flags: u32, data: u32) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
                mouseData: data,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}
fn send(inputs: &[INPUT]) -> Result<(), String> {
    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            size_of::<INPUT>() as i32,
        )
    };
    if sent != inputs.len() as u32 {
        // 일부 입력만 수신했을 때 눌린 키/버튼이 남지 않도록 release 이벤트를 보냅니다.
        let releases: Vec<INPUT> = inputs
            .iter()
            .filter_map(|input| unsafe {
                if input.r#type == INPUT_KEYBOARD {
                    let key = input.Anonymous.ki;
                    Some(keyboard(key.wVk, key.wScan, key.dwFlags | KEYEVENTF_KEYUP))
                } else {
                    let button = input.Anonymous.mi;
                    let flags = if button.dwFlags & MOUSEEVENTF_LEFTDOWN != 0 {
                        MOUSEEVENTF_LEFTUP
                    } else if button.dwFlags & MOUSEEVENTF_RIGHTDOWN != 0 {
                        MOUSEEVENTF_RIGHTUP
                    } else {
                        0
                    };
                    (flags != 0).then(|| mouse(flags, 0))
                }
            })
            .collect();
        if !releases.is_empty() {
            unsafe {
                SendInput(
                    releases.len() as u32,
                    releases.as_ptr(),
                    size_of::<INPUT>() as i32,
                );
            }
        }
        return Err("Windows가 입력을 허용하지 않았습니다. 관리자 권한 창이나 잠금 화면은 제어할 수 없습니다.".into());
    }
    Ok(())
}

fn point(target: &Target, rect: WindowRect, x: i32, y: i32) -> Result<(), String> {
    let p = POINT {
        x: rect.left + x,
        y: rect.top + y,
    };
    unsafe {
        if GetAncestor(WindowFromPoint(p), GA_ROOT) != hwnd(target) {
            return Err("입력 위치를 다른 창이 가리고 있습니다. 화면을 다시 확인해 주세요.".into());
        }
        if SetCursorPos(p.x, p.y) == 0 {
            return Err("마우스 위치를 이동하지 못했습니다.".into());
        }
        if GetAncestor(WindowFromPoint(p), GA_ROOT) != hwnd(target) {
            return Err("마우스 이동 중 입력 대상이 변경되었습니다.".into());
        }
    }
    Ok(())
}

fn key_inputs(key: &str) -> Result<Vec<INPUT>, String> {
    let (control, name) = key
        .strip_prefix("Ctrl+")
        .map(|key| (true, key))
        .unwrap_or((false, key));
    let vk = match name {
        "Enter" => VK_RETURN,
        "Tab" => VK_TAB,
        "Escape" => VK_ESCAPE,
        "Backspace" => VK_BACK,
        "Delete" => VK_DELETE,
        "ArrowUp" => VK_UP,
        "ArrowDown" => VK_DOWN,
        "ArrowLeft" => VK_LEFT,
        "ArrowRight" => VK_RIGHT,
        "Home" => VK_HOME,
        "End" => VK_END,
        "PageUp" => VK_PRIOR,
        "PageDown" => VK_NEXT,
        "A" if control => 0x41,
        "C" if control => 0x43,
        "V" if control => 0x56,
        "X" if control => 0x58,
        "Z" if control => 0x5A,
        "F" if control => 0x46,
        "S" if control => 0x53,
        "L" if control => 0x4C,
        _ => return Err("허용하지 않은 키 조합입니다.".into()),
    };
    let extended = if matches!(
        vk,
        VK_DELETE | VK_UP | VK_DOWN | VK_LEFT | VK_RIGHT | VK_HOME | VK_END | VK_PRIOR | VK_NEXT
    ) {
        KEYEVENTF_EXTENDEDKEY
    } else {
        0
    };
    let mut inputs = Vec::new();
    if control {
        inputs.push(keyboard(VK_CONTROL, 0, 0));
    }
    inputs.push(keyboard(vk, 0, extended));
    inputs.push(keyboard(vk, 0, extended | KEYEVENTF_KEYUP));
    if control {
        inputs.push(keyboard(VK_CONTROL, 0, KEYEVENTF_KEYUP));
    }
    Ok(inputs)
}

fn pause(ms: u64, check: &dyn Fn() -> Result<(), String>) -> Result<(), String> {
    let mut remaining = ms;
    while remaining > 0 {
        check()?;
        let next = remaining.min(20);
        thread::sleep(Duration::from_millis(next));
        remaining -= next;
    }
    check()
}

pub(super) fn act(
    target: &Target,
    expected: WindowRect,
    action: &ComputerAction,
    check: &dyn Fn() -> Result<(), String>,
) -> Result<CapturedWindow, String> {
    let _dpi = DpiGuard::new();
    let _focus = focus(target, check)?;
    let rect = rect_for(hwnd(target))?;
    if rect != expected {
        return Err("관찰 후 창 위치나 크기가 변경되었습니다. 화면을 다시 확인해 주세요.".into());
    }
    verify_visible(target, rect)?;
    check()?;
    neutral_modifiers()?;
    match action {
        ComputerAction::Click {
            x,
            y,
            button,
            click_count,
        } => {
            let (down, up) = match button {
                MouseButton::Left => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
                MouseButton::Right => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
            };
            for index in 0..*click_count {
                if index > 0 {
                    pause(80, check)?;
                }
                check()?;
                verify_visible(target, rect)?;
                point(target, rect, *x, *y)?;
                check()?;
                send(&[mouse(down, 0), mouse(up, 0)])?;
            }
        }
        ComputerAction::Scroll { x, y, delta_y } => {
            point(target, rect, *x, *y)?;
            check()?;
            send(&[mouse(MOUSEEVENTF_WHEEL, (-delta_y) as u32)])?;
        }
        ComputerAction::Key { key } => {
            check()?;
            send(&key_inputs(key)?)?;
        }
        ComputerAction::Type { text } => {
            // 클립보드를 바꾸지 않고 UTF-16 유니코드 입력을 보냅니다.
            for unit in text.encode_utf16() {
                check()?;
                if unsafe { GetForegroundWindow() } != hwnd(target) {
                    return Err("텍스트 입력 중 창이 변경되어 중지했습니다.".into());
                }
                send(&[
                    keyboard(0, unit, KEYEVENTF_UNICODE),
                    keyboard(0, unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP),
                ])?;
            }
        }
        ComputerAction::Wait { duration_ms } => {
            pause(*duration_ms, check)?;
        }
    }
    pause(150, check)?;
    capture_focused(target, check)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn overlap_and_key_mapping_are_bounded() {
        let first = WindowRect {
            left: -100,
            top: 0,
            width: 100,
            height: 100,
        };
        assert!(overlaps(
            first,
            WindowRect {
                left: -1,
                top: 0,
                width: 100,
                height: 100
            }
        ));
        assert!(!overlaps(
            first,
            WindowRect {
                left: 0,
                top: 0,
                width: 100,
                height: 100
            }
        ));
        assert!(overlaps(
            first,
            WindowRect {
                left: -10_000,
                top: -10_000,
                width: 20_000,
                height: 20_000
            }
        ));
        assert_eq!(key_inputs("Ctrl+A").unwrap().len(), 4);
        assert_eq!(key_inputs("ArrowRight").unwrap().len(), 2);
        assert!(key_inputs("Win+R").is_err());
    }

    #[test]
    #[ignore = "실제 데스크톱에서 전용 테스트 창만 열고 입력하는 수동 네이티브 검증"]
    fn native_smoke_uses_only_its_own_test_window() {
        use std::sync::mpsc;
        let (sender, receiver) = mpsc::channel();
        let ui_thread = thread::spawn(move || unsafe {
            let _dpi = DpiGuard::new();
            let class: Vec<u16> = "EDIT\0".encode_utf16().collect();
            let title: Vec<u16> = "OpenGem computer native test only\0"
                .encode_utf16()
                .collect();
            let window = CreateWindowExW(
                0,
                class.as_ptr(),
                title.as_ptr(),
                WS_OVERLAPPEDWINDOW | WS_VISIBLE | ES_MULTILINE as u32 | ES_AUTOVSCROLL as u32,
                120,
                120,
                640,
                420,
                null_mut(),
                null_mut(),
                null_mut(),
                null_mut(),
            );
            if window.is_null() {
                sender.send(0usize).unwrap();
                return;
            }
            sender.send(window as usize).unwrap();
            let mut message: MSG = zeroed();
            while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            if IsWindow(window) != 0 {
                DestroyWindow(window);
            }
        });
        let handle = receiver.recv_timeout(Duration::from_secs(5)).unwrap() as HWND;
        assert!(!handle.is_null(), "전용 테스트 창 생성 실패");
        let mut pid = 0;
        let thread_id = unsafe { GetWindowThreadProcessId(handle, &mut pid) };
        assert_eq!(
            pid,
            std::process::id(),
            "자체 테스트 프로세스 이외의 창은 제어하지 않음"
        );
        struct TestWindow(HWND, u32);
        impl Drop for TestWindow {
            fn drop(&mut self) {
                unsafe {
                    PostMessageW(self.0, WM_CLOSE, 0, 0);
                    PostThreadMessageW(self.1, WM_QUIT, 0, 0);
                }
            }
        }
        let cleanup = TestWindow(handle, thread_id);
        let (created_at, process_name) = process_identity(pid).unwrap();
        let target = Target {
            window: ComputerWindow {
                id: "own-native-test".into(),
                title: title(handle),
                process_name,
            },
            handle: handle as usize,
            pid,
            created_at,
            thread_id,
            class_name: class_name(handle),
        };
        let check = || Ok(());
        let initial = observe(&target, &check).expect("전용 테스트 창 캡처");
        assert!(initial.image_data_url.starts_with("data:image/png;base64,"));
        assert!(initial.image_data_url.len() > 1000);
        assert!(initial.rect.width > 500 && initial.rect.height > 300);
        let clicked = act(
            &target,
            initial.rect,
            &ComputerAction::Click {
                x: 80,
                y: 100,
                button: MouseButton::Left,
                click_count: 1,
            },
            &check,
        )
        .expect("전용 창 클릭");
        let selected = act(
            &target,
            clicked.rect,
            &ComputerAction::Key {
                key: "Ctrl+A".into(),
            },
            &check,
        )
        .expect("전체 선택");
        let typed = act(
            &target,
            selected.rect,
            &ComputerAction::Type {
                text: "OpenGem 네이티브 입력 검증".into(),
            },
            &check,
        )
        .expect("유니코드 입력");
        assert_eq!(title(handle), "OpenGem 네이티브 입력 검증");
        assert_ne!(initial.image_data_url, typed.image_data_url);
        let stale = WindowRect {
            left: typed.rect.left + 1,
            ..typed.rect
        };
        assert!(act(
            &target,
            stale,
            &ComputerAction::Key {
                key: "Enter".into()
            },
            &check
        )
        .is_err());
        let cancelled = || Err("cancelled".to_string());
        assert!(act(
            &target,
            typed.rect,
            &ComputerAction::Type {
                text: "must not type".into()
            },
            &cancelled
        )
        .is_err());
        assert_eq!(title(handle), "OpenGem 네이티브 입력 검증");
        drop(cleanup);
        ui_thread.join().unwrap();
    }
}
