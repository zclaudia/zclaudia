use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
pub struct WindowInfo {
    label: String,
    title: String,
    visible: bool,
    focused: bool,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    pid: u32,
}

#[tauri::command]
pub fn list_windows(app: tauri::AppHandle) -> Vec<WindowInfo> {
    let pid = std::process::id();
    let mut windows: Vec<WindowInfo> = app
        .webview_windows()
        .into_iter()
        .map(|(label, window)| {
            let title = window.title().unwrap_or_default();
            let visible = window.is_visible().unwrap_or(false);
            let focused = window.is_focused().unwrap_or(false);
            let size = window.inner_size().unwrap_or_default();
            let pos = window.outer_position().unwrap_or_default();
            WindowInfo {
                label,
                title,
                visible,
                focused,
                width: size.width,
                height: size.height,
                x: pos.x,
                y: pos.y,
                pid,
            }
        })
        .collect();
    windows.sort_by(|a, b| a.label.cmp(&b.label));
    windows
}
