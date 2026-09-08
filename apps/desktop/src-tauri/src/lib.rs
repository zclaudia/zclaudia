#[cfg(not(target_os = "android"))]
use tauri::menu::{MenuBuilder, MenuItemBuilder};
#[cfg(not(target_os = "android"))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(not(target_os = "android"))]
use tauri::Manager;

#[cfg(not(target_os = "android"))]
mod server;

#[cfg(not(target_os = "android"))]
mod permissions;

#[cfg(not(target_os = "android"))]
mod network_probe;

#[cfg(target_os = "windows")]
mod wsl;

#[cfg(target_os = "android")]
mod android_bridge;

#[cfg(not(target_os = "android"))]
mod window_manager;

#[cfg(not(target_os = "android"))]
mod traffic_lights;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Claudia!", name)
}

/// Focus a window by label (bring to front, unminimize if needed)
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn focus_window(app: tauri::AppHandle, label: String) {
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Close a window by label
#[cfg(not(target_os = "android"))]
#[tauri::command]
fn close_window(app: tauri::AppHandle, label: String) {
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.close();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init());

    // Updater + process (restart) — desktop only
    #[cfg(not(target_os = "android"))]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    // Keep desktop app single-instance. The clean dev launcher uses a separate
    // identifier, so dev and production can still coexist without spawning
    // duplicate app instances inside the same channel.
    #[cfg(not(target_os = "android"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        // When a second instance is launched, focus the existing window
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_focus();
            let _ = window.unminimize();
        }
    }));

    #[cfg(not(target_os = "android"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        greet,
        server::start_server,
        server::stop_server,
        server::register_dev_server_pid,
        server::get_shell_network_env,
        network_probe::probe_opencode_endpoints,
        network_probe::probe_network_endpoint,
        permissions::check_full_disk_access,
        permissions::open_full_disk_access_settings,
        permissions::check_folder_permissions,
        permissions::open_files_and_folders_settings,
        focus_window,
        close_window,
        window_manager::list_windows,
        #[cfg(target_os = "windows")]
        wsl::wsl_exec,
        #[cfg(target_os = "windows")]
        wsl::wsl_start_server,
    ]);

    #[cfg(target_os = "android")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        greet,
        android_bridge::android_get_ntfy_bridge_status,
        android_bridge::android_sync_ntfy_bridge,
    ]);

    // Setup: initialize the system tray and macOS permissions
    #[cfg(not(target_os = "android"))]
    let builder = builder.setup(|app| {
        // macOS: probe TCC-protected folders at startup
        #[cfg(target_os = "macos")]
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_secs(1));
            let results = permissions::check_folder_permissions();
            let pending: Vec<_> = results
                .iter()
                .filter(|r| !r.granted)
                .map(|r| r.name.as_str())
                .collect();
            if !pending.is_empty() {
                eprintln!("[Permissions] Folders not yet authorized: {:?}", pending);
            }
        });

        // System tray icon
        let show_item = MenuItemBuilder::with_id("show", "Show Main Window").build(app)?;
        let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
        let tray_menu = MenuBuilder::new(app)
            .items(&[&show_item, &quit_item])
            .build()?;

        let tray_icon =
            tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon@2x.png"))
                .expect("failed to load tray icon");

        TrayIconBuilder::with_id("main-tray")
            .icon(tray_icon)
            .icon_as_template(true)
            .menu(&tray_menu)
            .tooltip("Claudia")
            .on_menu_event(|app, event| match event.id().as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    let app = tray.app_handle();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
            })
            .build(app)?;

        // macOS: drop the native traffic lights so they vertically center with the
        // custom sidebar-header icons. No-op on other platforms. The buttons may not
        // be fully laid out yet at setup time — the Resized / Focused re-apply in the
        // run() handler covers that case.
        if let Some(window) = app.get_webview_window("main") {
            traffic_lights::center_traffic_lights(&window);
        }

        Ok(())
    });

    #[cfg(target_os = "android")]
    let builder = builder.setup(|_app| Ok(()));

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(not(target_os = "android"))]
            match event {
                tauri::RunEvent::WindowEvent { label, event, .. } => {
                    // Close button on main window: hide to tray instead of quitting
                    if label == "main" {
                        // Re-drop the traffic lights on relayout (resize / fullscreen
                        // toggle / refocus), since AppKit restores their default
                        // vertical center on those transitions. Idempotent, so calling
                        // it repeatedly is safe. Done before the CloseRequested `if let`
                        // below, which moves `event`.
                        if matches!(
                            event,
                            tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(true)
                        ) {
                            if let Some(window) = app.get_webview_window("main") {
                                traffic_lights::center_traffic_lights(&window);
                            }
                        }
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        }
                    }
                }
                tauri::RunEvent::Exit => {
                    server::stop_server_sync();
                }
                _ => {}
            }
        });
}
