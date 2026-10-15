#![cfg(target_os = "android")]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const NTFY_BRIDGE_URL: &str = "http://127.0.0.1:9595";
const NTFY_RECEIVER: &str = "com.zclaudia.mobile.NotificationRenderService";

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AndroidNotificationConfig {
    enabled: bool,
    ntfy_url: String,
    ntfy_topic: String,
    #[serde(default)]
    ntfy_auth_mode: String,
    #[serde(default)]
    ntfy_auth_token: String,
    #[serde(default)]
    ntfy_username: String,
    #[serde(default)]
    ntfy_password: String,
}

#[derive(Serialize)]
pub struct AndroidNtfyBridgeStatus {
    ok: bool,
    uptime: Option<String>,
    version: Option<String>,
    subscriptions: serde_json::Value,
}

#[derive(Serialize)]
struct AndroidBridgeSubscribeRequest {
    id: String,
    ntfy_url: String,
    topic: String,
    auth_mode: String,
    auth_token: String,
    username: String,
    password: String,
    package: String,
    receiver: String,
}

fn android_bridge_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn android_get_ntfy_bridge_status() -> Result<AndroidNtfyBridgeStatus, String> {
    let response = android_bridge_client()?
        .get(format!("{NTFY_BRIDGE_URL}/status"))
        .send()
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("status failed: {}", response.status()));
    }

    let value = response
        .json::<serde_json::Value>()
        .map_err(|e| e.to_string())?;
    Ok(AndroidNtfyBridgeStatus {
        ok: value.get("ok").and_then(|v| v.as_bool()).unwrap_or(false),
        uptime: value
            .get("uptime")
            .and_then(|v| v.as_str())
            .map(ToOwned::to_owned),
        version: value
            .get("version")
            .and_then(|v| v.as_str())
            .map(ToOwned::to_owned),
        subscriptions: value
            .get("subscriptions")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({})),
    })
}

/// Sync local ntfy-bridge subscriptions to the desired set: one per backend,
/// id "<package>:<backendId>", topic "<base>-<backendId>" (mirrors the
/// gateway's per-backend publish scheme). Stale subscriptions belonging to
/// this package are removed; with nothing enabled everything is removed.
#[tauri::command]
pub fn android_sync_ntfy_bridge(
    config: AndroidNotificationConfig,
    package_id: String,
    backend_ids: Vec<String>,
) -> Result<(), String> {
    let client = android_bridge_client()?;
    let ntfy_url = config.ntfy_url.trim().to_string();
    let base_topic = config.ntfy_topic.trim().to_string();

    let enabled = config.enabled && !ntfy_url.is_empty() && !base_topic.is_empty() && !backend_ids.is_empty();

    let desired: Vec<(String, String)> = backend_ids
        .iter()
        .filter(|_| enabled)
        .map(|backend_id| {
            (
                format!("{package_id}:{backend_id}"),
                format!("{base_topic}-{backend_id}"),
            )
        })
        .collect();

    // Current subscriptions for this package: id -> (ntfy_url, topic).
    let mut current: HashMap<String, (String, String)> = HashMap::new();
    let status_response = client
        .get(format!("{NTFY_BRIDGE_URL}/status"))
        .send()
        .map_err(|e| e.to_string())?;
    if !status_response.status().is_success() {
        return Err(format!("ntfy-bridge status failed: {}", status_response.status()));
    }
    let status = status_response
        .json::<serde_json::Value>()
        .map_err(|e| e.to_string())?;
    if let Some(subs) = status.get("subscriptions").and_then(|v| v.as_object()) {
        for (id, sub) in subs {
            if sub.get("package").and_then(|v| v.as_str()) != Some(package_id.as_str()) {
                continue;
            }
            let url = sub
                .get("ntfy_url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let topic = sub
                .get("topic")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            current.insert(id.clone(), (url, topic));
        }
    }

    for (id, topic) in &desired {
        // Upserts restart the daemon's SSE connection; only register new or
        // changed subscriptions.
        if let Some((current_url, current_topic)) = current.get(id) {
            if current_topic == topic && current_url == &ntfy_url {
                continue;
            }
        }
        let response = client
            .post(format!("{NTFY_BRIDGE_URL}/subscribe"))
            .json(&AndroidBridgeSubscribeRequest {
                id: id.clone(),
                ntfy_url: ntfy_url.clone(),
                topic: topic.clone(),
                auth_mode: config.ntfy_auth_mode.trim().to_string(),
                auth_token: config.ntfy_auth_token.trim().to_string(),
                username: config.ntfy_username.trim().to_string(),
                password: config.ntfy_password.clone(),
                package: package_id.clone(),
                receiver: NTFY_RECEIVER.to_string(),
            })
            .send()
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("ntfy-bridge register failed: {}", response.status()));
        }
    }

    for id in current.keys() {
        if desired.iter().any(|(desired_id, _)| desired_id == id) {
            continue;
        }
        let response = client
            .delete(format!("{NTFY_BRIDGE_URL}/subscribe"))
            .json(&serde_json::json!({ "id": id }))
            .send()
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("ntfy-bridge unregister failed: {}", response.status()));
        }
    }

    Ok(())
}
