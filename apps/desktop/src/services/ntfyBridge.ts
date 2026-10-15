import type { NotificationConfig } from '@zclaudia/protocol/notifications';
import { invoke } from '@tauri-apps/api/core';
import { isAndroid } from '../utils/platform';

const BRIDGE_URL = 'http://127.0.0.1:9595';
const RECEIVER = 'com.zclaudia.mobile.NotificationRenderService';

export interface NtfyBridgeSubscriptionStatus {
  ntfy_url?: string;
  topic?: string;
  package?: string;
  auth_mode?: string;
  auth_configured?: boolean;
  status?: string;
  connected?: boolean;
}

export interface NtfyBridgeStatusResponse {
  ok: boolean;
  uptime?: string;
  version?: string;
  subscriptions: Record<string, NtfyBridgeSubscriptionStatus>;
}

/** Per-backend subscription id / topic scheme, shared with the gateway. */
export function subscriptionId(packageId: string, backendId: string): string {
  return `${packageId}:${backendId}`;
}

export function backendTopic(baseTopic: string, backendId: string): string {
  return `${baseTopic}-${backendId}`;
}

async function bridgeFetch(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${BRIDGE_URL}${path}`, options);
}

async function getCurrentPackageId(): Promise<string> {
  const { getIdentifier } = await import('@tauri-apps/api/app');
  return getIdentifier();
}

export function isNtfyBridgeSupported(): boolean {
  return isAndroid();
}

/**
 * Sync local ntfy-bridge subscriptions to the desired set: one subscription
 * per subscribed backend (per-backend topics), replacing anything stale that
 * belongs to this package. With no enabled config or no backends, all of this
 * package's subscriptions are removed.
 */
export async function syncNtfyBridgeSubscriptions(
  config: NotificationConfig,
  backendIds: string[]
): Promise<void> {
  if (!isNtfyBridgeSupported()) return;

  const packageId = await getCurrentPackageId();
  const ntfyUrl = config.ntfyUrl.trim();
  const baseTopic = config.ntfyTopic.trim();
  const enabled = Boolean(config.enabled && ntfyUrl && baseTopic && backendIds.length > 0);
  const authMode = config.ntfyAuthMode ?? 'none';
  const authToken = config.ntfySubscribeToken?.trim() ?? '';
  const username = config.ntfyUsername?.trim() ?? '';
  const password = config.ntfyPassword ?? '';

  if (isAndroid()) {
    await invoke('android_sync_ntfy_bridge', {
      config: {
        enabled,
        ntfy_url: ntfyUrl,
        ntfy_topic: baseTopic,
        ntfy_auth_mode: authMode,
        ntfy_auth_token: authToken,
        ntfy_username: username,
        ntfy_password: password,
      },
      packageId,
      backendIds,
    });
    return;
  }

  const desired = new Map<string, string>();
  if (enabled) {
    for (const backendId of backendIds) {
      desired.set(subscriptionId(packageId, backendId), backendTopic(baseTopic, backendId));
    }
  }

  const status = await getNtfyBridgeStatus();
  const currentIds = Object.entries(status.subscriptions ?? {})
    .filter(([, sub]) => sub?.package === packageId)
    .map(([id]) => id);

  for (const [id, topic] of desired) {
    // Upserts restart the daemon's SSE connection; only register new or changed topics.
    if (
      currentIds.includes(id) &&
      status.subscriptions[id]?.topic === topic &&
      status.subscriptions[id]?.ntfy_url === ntfyUrl
    ) {
      continue;
    }
    const response = await bridgeFetch('/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        ntfy_url: ntfyUrl,
        topic,
        auth_mode: authMode,
        auth_token: authToken,
        username,
        password,
        package: packageId,
        receiver: RECEIVER,
      }),
    });
    if (!response.ok) {
      throw new Error(`ntfy-bridge register failed: ${response.status}`);
    }
  }

  for (const id of currentIds) {
    if (desired.has(id)) continue;
    const response = await bridgeFetch('/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!response.ok) {
      throw new Error(`ntfy-bridge unregister failed: ${response.status}`);
    }
  }
}

export async function getNtfyBridgeStatus(): Promise<NtfyBridgeStatusResponse> {
  if (!isNtfyBridgeSupported()) {
    return { ok: false, subscriptions: {} };
  }

  try {
    if (isAndroid()) {
      return await invoke<NtfyBridgeStatusResponse>('android_get_ntfy_bridge_status');
    }
    const response = await bridgeFetch('/status');
    if (!response.ok) {
      throw new Error(`status failed: ${response.status}`);
    }
    return (await response.json()) as NtfyBridgeStatusResponse;
  } catch {
    return { ok: false, subscriptions: {} };
  }
}
