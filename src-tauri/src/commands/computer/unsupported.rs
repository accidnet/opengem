use super::{CapturedWindow, ComputerAction, ComputerWindow, WindowRect, UNSUPPORTED};

pub(super) struct Target {
    pub window: ComputerWindow,
}
pub(super) fn list_windows() -> Result<Vec<ComputerWindow>, String> {
    Err(UNSUPPORTED.into())
}
pub(super) fn select_window(_: &str) -> Result<Target, String> {
    Err(UNSUPPORTED.into())
}
pub(super) fn emergency_stop_pressed() -> bool {
    false
}
pub(super) fn observe(
    _: &Target,
    _: &dyn Fn() -> Result<(), String>,
) -> Result<CapturedWindow, String> {
    Err(UNSUPPORTED.into())
}
pub(super) fn act(
    _: &Target,
    _: WindowRect,
    _: &ComputerAction,
    _: &dyn Fn() -> Result<(), String>,
) -> Result<CapturedWindow, String> {
    Err(UNSUPPORTED.into())
}
