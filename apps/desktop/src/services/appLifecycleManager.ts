/**
 * AppLifecycleManager
 *
 * Manages mobile/Windows reconnection via three layers:
 * 1. Visibility change detection (background/foreground)
 * 2. Network change detection (online/offline)
 * 3. Client-side health probing (25s interval)
 * 4. Heartbeat staleness detection — marks connections degraded when
 *    state_heartbeat messages stop arriving and triggers proactive recovery.
 *
 * Only active when the facade supports forceReconnect (direct gateway mode).
 * The facade handles all auto-recovery — this manager just ensures the WS
 * connection stays alive by calling facade.forceReconnect() on resume/online.
 */

import type { BackendFacade } from '@zclaudia/shared/facade/types';
import { useServerStore } from '../stores/serverStore';

const HEALTH_PROBE_INTERVAL_MS = 25_000;
/** Mark connection degraded if no heartbeat for 75s (2.5 × 30s heartbeat interval). */
const HEARTBEAT_STALE_THRESHOLD_MS = 75_000;
const RESUME_RECONNECT_DEBOUNCE_MS = 1_500;

class AppLifecycleManager {
  private facade: BackendFacade | null = null;
  private onResume: (() => void | Promise<void>) | null = null;
  private backgroundSince: number | null = null;
  private healthProbeTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  /** Timestamp of the last health probe tick — used to detect OS freeze. */
  private lastHealthProbeTickAt = 0;
  /** Prevent duplicate reconnects when wake emits focus + visibility + online together. */
  private lastResumeReconnectAt = 0;
  /** Android Activity state outranks WebView visibility, which can remain stale. */
  private nativeForeground: boolean | null = null;

  private isForeground(): boolean {
    return this.nativeForeground ?? document.visibilityState === 'visible';
  }

  private handleNativeLifecycle = (event: Event): void => {
    const active = (event as CustomEvent<{ active?: unknown }>).detail?.active;
    if (typeof active !== 'boolean') return;
    this.nativeForeground = active;
    if (active) this.onForeground();
    else this.onBackground();
  };

  // Bound handlers for cleanup
  private handleVisibilityChange = (): void => {
    if (this.isForeground()) {
      this.onForeground();
    } else {
      this.onBackground();
    }
  };

  private handleOnline = (): void => {
    if (!this.isForeground()) return;
    this.triggerResumeReconnect('network online');
  };

  private handleWindowFocus = (): void => {
    if (!this.isForeground()) return;
    this.triggerResumeReconnect('window focus');
  };

  private handlePageShow = (): void => {
    if (!this.isForeground()) return;
    this.triggerResumeReconnect('pageshow');
  };

  start(facade: BackendFacade, options?: { onResume?: () => void | Promise<void> }): void {
    if (this.started) this.stop();
    this.facade = facade;
    this.onResume = options?.onResume ?? null;
    this.started = true;
    const nativeActive = (window as Window & { __ZCLAUDIA_NATIVE_APP_ACTIVE__?: boolean })
      .__ZCLAUDIA_NATIVE_APP_ACTIVE__;
    this.nativeForeground = typeof nativeActive === 'boolean' ? nativeActive : null;

    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('focus', this.handleWindowFocus);
    window.addEventListener('pageshow', this.handlePageShow);
    window.addEventListener('zclaudia:app-lifecycle', this.handleNativeLifecycle);

    if (this.isForeground()) this.startHealthProbe();
  }

  stop(): void {
    this.started = false;
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('focus', this.handleWindowFocus);
    window.removeEventListener('pageshow', this.handlePageShow);
    window.removeEventListener('zclaudia:app-lifecycle', this.handleNativeLifecycle);

    this.stopHealthProbe();
    this.facade = null;
    this.onResume = null;
    this.backgroundSince = null;
    this.lastResumeReconnectAt = 0;
    this.nativeForeground = null;
  }

  private onBackground(): void {
    if (this.backgroundSince !== null) return;
    this.backgroundSince = Date.now();
    this.lastResumeReconnectAt = 0;
    this.stopHealthProbe();
    console.log('[AppLifecycleManager] App went to background');
  }

  private onForeground(): void {
    const wasBackgroundMs = this.backgroundSince ? Date.now() - this.backgroundSince : 0;
    this.backgroundSince = null;

    console.log(
      `[AppLifecycleManager] App returned to foreground (background for ${Math.round(wasBackgroundMs / 1000)}s)`
    );

    this.triggerResumeReconnect('foreground');

    // Restart health probe and run one immediately
    this.startHealthProbe();
    this.facade?.probeHealth?.();
  }

  private triggerResumeReconnect(reason: string): void {
    const now = Date.now();
    if (now - this.lastResumeReconnectAt < RESUME_RECONNECT_DEBOUNCE_MS) {
      return;
    }
    this.lastResumeReconnectAt = now;
    // focus/pageshow/native resume can be the only wake signal. A previous
    // hidden event stopped the probe, so all resume paths must restart it.
    this.backgroundSince = null;
    this.startHealthProbe();
    console.log(`[AppLifecycleManager] ${reason} — triggering reconnect`);
    this.facade?.forceReconnect?.();
    this.runResumeHooks();
  }

  private runResumeHooks(): void {
    try {
      const result = this.onResume?.();
      if (result && typeof (result as Promise<void>).catch === 'function') {
        void (result as Promise<void>).catch(err => {
          console.warn('[AppLifecycleManager] Resume hook failed:', err);
        });
      }
    } catch (err) {
      console.warn('[AppLifecycleManager] Resume hook failed:', err);
    }
  }

  private startHealthProbe(): void {
    this.stopHealthProbe();
    // Only probe if facade supports it (direct gateway mode)
    if (!this.facade?.probeHealth) return;
    this.lastHealthProbeTickAt = Date.now();
    this.healthProbeTimer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - this.lastHealthProbeTickAt;
      this.lastHealthProbeTickAt = now;

      // Freeze detection: if elapsed time is much larger than the probe interval,
      // the app was likely frozen by the OS (background on mobile). Treat as
      // foreground resume — this doesn't depend on visibilitychange which may
      // not fire reliably on all Android WebView implementations.
      if (elapsed > HEALTH_PROBE_INTERVAL_MS * 2) {
        console.log(
          `[AppLifecycleManager] Freeze detected: ${Math.round(elapsed / 1000)}s since last tick (expected ${HEALTH_PROBE_INTERVAL_MS / 1000}s)`
        );
        // Don't go through onForeground() — backgroundSince may be null if
        // visibilitychange never fired. Force reconnect unconditionally.
        this.triggerResumeReconnect('freeze detected');
        this.facade?.probeHealth?.();
        return;
      }

      this.facade?.probeHealth?.();
      this.checkHeartbeatStaleness(now);
    }, HEALTH_PROBE_INTERVAL_MS);
  }

  private stopHealthProbe(): void {
    if (this.healthProbeTimer) {
      clearInterval(this.healthProbeTimer);
      this.healthProbeTimer = null;
    }
  }

  /**
   * Check all remote connections for stale heartbeats.
   * If a connection hasn't received a state_heartbeat within the threshold,
   * mark it degraded and trigger proactive recovery (session sync via REST).
   */
  private checkHeartbeatStaleness(now: number): void {
    const store = useServerStore.getState();
    const { connections } = store;

    for (const [serverId, conn] of Object.entries(connections)) {
      // Skip local connections — they use IPC, not remote heartbeat
      if (conn.isLocalConnection) continue;
      // Skip connections that haven't received any heartbeat yet (not fully initialized)
      if (!conn.lastHeartbeatAt) continue;

      const staleDuration = now - conn.lastHeartbeatAt;
      if (staleDuration > HEARTBEAT_STALE_THRESHOLD_MS && conn.connectionQuality !== 'degraded') {
        console.warn(
          `[AppLifecycleManager] Heartbeat stale for ${serverId}: ${Math.round(staleDuration / 1000)}s since last heartbeat — marking degraded`
        );
        store.setConnectionQuality(serverId, 'degraded');

        // Proactive recovery: sync session state via REST to catch any missed
        // permission requests or run completions
        this.triggerStateRecovery(serverId);
      }
    }
  }

  /**
   * Trigger proactive state recovery for a degraded connection.
   * Uses REST API (independent of WebSocket heartbeat) to fetch current state.
   */
  private triggerStateRecovery(serverId: string): void {
    import('./sessionSync')
      .then(({ eagerSyncCurrentSession, recoverCurrentSessionTail }) => {
        console.log(`[AppLifecycleManager] Triggering state recovery for ${serverId}`);
        void eagerSyncCurrentSession(serverId);
        void recoverCurrentSessionTail(serverId);
      })
      .catch(err => {
        console.error('[AppLifecycleManager] Failed to trigger state recovery:', err);
      });
  }
}

export const appLifecycleManager = new AppLifecycleManager();
