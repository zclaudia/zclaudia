//! macOS-only native repositioning of the window's traffic-light buttons
//! (close / minimize / zoom).
//!
//! The main window uses `titleBarStyle: "Overlay"` + `hiddenTitle: true`, so the
//! webview content (including our custom sidebar-header icons) extends up under
//! the native title bar. By default the traffic lights sit vertically centered in
//! the standard title bar, which reads a touch too HIGH relative to those header
//! icons. We nudge the lights DOWN so they line up with the header row.
//!
//! Technique grounded in `tauri-plugin-decorum`'s `position_traffic_lights`
//! (src/traffic.rs), which fetches the three standard buttons via
//! `standardWindowButton:` and centers them with
//! `rect.origin.y = ((title_bar_height - button_height) / 2.0) - offset`, then
//! applies the new origin with `setFrameOrigin:`. We implement the same idea
//! inline with raw `objc2` `msg_send!` (matching the idioms in `notch.rs`) and
//! with NO extra dependencies.

/// Points to move the lights DOWN from their default vertical center.
///
/// Fine-tune by eye after building until the traffic lights vertically center
/// with the custom sidebar-header icons.
pub const TRAFFIC_LIGHT_DROP: f64 = 7.0;

/// Points to move the lights RIGHT from their default horizontal inset.
pub const TRAFFIC_LIGHT_RIGHT_SHIFT: f64 = 8.0;

/// Reposition the main window's traffic-light buttons so they sit `TRAFFIC_LIGHT_DROP`
/// points below their default vertical center.
///
/// IDEMPOTENT: safe to call repeatedly (setup, resize, focus) without the buttons
/// drifting. The target y is computed from a STABLE reference — the button's
/// superview (title-bar) height — never from the button's own current origin, so
/// there is nothing to compound.
#[cfg(target_os = "macos")]
pub fn center_traffic_lights(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|webview| unsafe {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        use objc2_foundation::{NSPoint, NSRect};
        use std::sync::OnceLock;

        static TRAFFIC_LIGHT_BASE_X: OnceLock<[f64; 3]> = OnceLock::new();

        let win: *mut AnyObject = webview.ns_window() as _;
        if win.is_null() {
            return;
        }

        let base_x = TRAFFIC_LIGHT_BASE_X.get_or_init(|| {
            let mut positions = [0.0f64; 3];
            for i in 0usize..3 {
                let button: *mut AnyObject = msg_send![win, standardWindowButton: i];
                if button.is_null() {
                    continue;
                }
                let frame: NSRect = msg_send![button, frame];
                positions[i] = frame.origin.x;
            }
            positions
        });

        // NSWindowButton indices: 0 = close, 1 = miniaturize, 2 = zoom.
        // Passed as NSUInteger (usize-sized).
        for index in 0usize..3 {
            let button: *mut AnyObject = msg_send![win, standardWindowButton: index];
            if button.is_null() {
                continue;
            }

            // The button's superview is the native title-bar view. Its height is a
            // stable OS-owned value, so centering against it yields the same target
            // every call — that is what makes this idempotent (unlike reading the
            // button's own current y and subtracting each time, which would drift).
            let superview: *mut AnyObject = msg_send![button, superview];
            if superview.is_null() {
                continue;
            }

            let button_frame: NSRect = msg_send![button, frame];
            let superview_frame: NSRect = msg_send![superview, frame];

            // Cocoa/NSView uses a bottom-left origin (y increases UPWARD). Start from
            // the vertically-centered y within the title bar, then SUBTRACT the drop
            // to move the button DOWN. Shift x right from the OS default captured once
            // on first call so repeated relayouts do not compound.
            let target_y = (superview_frame.size.height - button_frame.size.height) / 2.0
                - TRAFFIC_LIGHT_DROP;
            let target_x = base_x[index] + TRAFFIC_LIGHT_RIGHT_SHIFT;

            let origin = NSPoint {
                x: target_x,
                y: target_y,
            };
            let _: () = msg_send![button, setFrameOrigin: origin];
        }
    });
}

/// Non-macOS no-op: the traffic lights only exist on macOS, but keeping the
/// function defined on every target lets callers invoke it unconditionally.
#[cfg(not(target_os = "macos"))]
pub fn center_traffic_lights(_window: &tauri::WebviewWindow) {}
