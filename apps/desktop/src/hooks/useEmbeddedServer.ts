/// <reference types="vite/client" />
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Command, type Child } from '@tauri-apps/plugin-shell';
import { appDataDir, homeDir, join, resolveResource } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { useIsMounted } from './useIsMounted';
import { useLatestRef } from './useLatestRef';

export type EmbeddedServerStatus =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'error'
  | 'disabled'
  | 'wsl-mode';

interface EmbeddedServerCoreState {
  port: number | null;
  status: EmbeddedServerStatus;
  error: string | null;
}

export interface EmbeddedServerState extends EmbeddedServerCoreState {
  restart: () => Promise<void>;
}

type LaunchGuard = () => boolean;

interface OpenCodeEndpointProbeResult {
  base_url: string;
  host: string;
  port: number;
  ok: boolean;
  detail: string;
}

type ProbeWindow = typeof window & {
  __ZCLAUDIA_OPENCODE_PROBE_RAN__?: boolean;
  __ZCLAUDIA_PROBE_ENDPOINT__?: (baseUrl: string) => Promise<OpenCodeEndpointProbeResult | null>;
};

const HEALTHCHECK_INTERVAL_MS = 5000;
const HEALTHCHECK_TIMEOUT_MS = 2000;
const HEALTHCHECK_FAILURE_LIMIT = 3;
const RECOVERY_MAX_DELAY_MS = 30000;
const RECOVERY_STABLE_MS = 60000;

const DEV_HEALTHCHECK_RETRY_DELAYS_MS = [150, 300, 500, 750, 1000, 1500];
const DEV_SERVER_PATH = '../../../server/dist/index.js';
const DEV_REPO_ROOT = '../../..';
const DEV_NATIVE_MODULE_CHECKER = '../../../scripts/hooks/check-native-modules.mjs';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

async function probeLocalServer(port: number, signal?: AbortSignal): Promise<boolean> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, HEALTHCHECK_TIMEOUT_MS);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    return response.ok;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

import { isDesktopTauriNonWindows, isWindows as isWindowsTauri } from '../utils/platform';

/**
 * Resolve the path to the server entry point.
 * In dev mode, this is relative to the Tauri app's working directory.
 * In production, the server is bundled as a Tauri resource.
 */
async function resolveServerPath(): Promise<string> {
  if (import.meta.env.DEV) {
    // Tauri dev cwd is apps/desktop/src-tauri/, so we need 3 levels up
    return DEV_SERVER_PATH;
  }
  return await resolveResource('server/server.mjs');
}

/**
 * Hook that spawns an embedded Node.js server process on a random available port.
 * Only active on desktop Tauri builds — on mobile/browser, returns { status: 'disabled' }.
 *
 * In dev mode, uses the Tauri JS shell plugin (Command.create) with system node.
 * In production, uses a Rust-side Tauri command that directly spawns the bundled
 * node sidecar and reads stdout for SERVER_READY:<port>.
 */
export function useEmbeddedServer(options?: { disabled?: boolean }): EmbeddedServerState {
  const disabled = options?.disabled ?? false;

  // Determine initial status based on platform
  const getInitialStatus = (): EmbeddedServerStatus => {
    if (disabled) return 'disabled';
    if (isWindowsTauri()) return 'wsl-mode';
    if (!isDesktopTauriNonWindows()) return 'disabled';
    return 'starting';
  };

  const [state, setState] = useState<EmbeddedServerCoreState>(() => ({
    port: null,
    status: getInitialStatus(),
    error: null,
  }));

  const stateRef = useLatestRef(state);
  const launchGenerationRef = useRef(0);
  const restartPendingRef = useRef(false);
  const recoveryAttemptsRef = useRef(0);
  const childRef = useRef<Child | null>(null);
  const isMounted = useIsMounted();
  const [restartNonce, setRestartNonce] = useState(0);

  const registerManualEndpointProbe = useCallback(() => {
    const probeWindow = window as ProbeWindow;
    if (probeWindow.__ZCLAUDIA_PROBE_ENDPOINT__) return;

    probeWindow.__ZCLAUDIA_PROBE_ENDPOINT__ = async (baseUrl: string) => {
      try {
        const result = await invoke<OpenCodeEndpointProbeResult>('probe_network_endpoint', {
          baseUrl,
        });
        const log = result.ok ? console.log : console.warn;
        log(
          `[EmbeddedServer] Manual endpoint probe ${result.ok ? 'ok' : 'failed'}: ${result.base_url} (${result.host}:${result.port}) -> ${result.detail}`
        );
        return result;
      } catch (err) {
        console.warn('[EmbeddedServer] Manual endpoint probe failed to run:', err);
        return null;
      }
    };
  }, []);

  const runOpencodeEndpointProbe = useCallback(async () => {
    const probeWindow = window as ProbeWindow;
    if (probeWindow.__ZCLAUDIA_OPENCODE_PROBE_RAN__) return;
    probeWindow.__ZCLAUDIA_OPENCODE_PROBE_RAN__ = true;

    try {
      const results = await invoke<OpenCodeEndpointProbeResult[]>('probe_opencode_endpoints');
      if (!Array.isArray(results) || results.length === 0) {
        console.warn(
          '[EmbeddedServer] OpenCode endpoint probe: no configured provider baseURL found'
        );
        return;
      }

      for (const result of results) {
        const log = result.ok ? console.log : console.warn;
        log(
          `[EmbeddedServer] OpenCode endpoint probe ${result.ok ? 'ok' : 'failed'}: ${result.base_url} (${result.host}:${result.port}) -> ${result.detail}`
        );
      }
    } catch (err) {
      console.warn('[EmbeddedServer] OpenCode endpoint probe failed to run:', err);
    }
  }, []);

  const startServerDev = useCallback(
    async (isCurrent: LaunchGuard) => {
      try {
        registerManualEndpointProbe();
        void runOpencodeEndpointProbe();
        const shellNetworkEnv = await invoke<Record<string, string>>('get_shell_network_env').catch(
          () => ({})
        );

        // In tauri dev, beforeDevCommand starts the workspace server on port 3100 in parallel.
        // Vite may become ready first, so give the existing dev server a short window to finish booting
        // before falling back to spawning a sidecar on a random port.
        for (let attempt = 0; attempt <= DEV_HEALTHCHECK_RETRY_DELAYS_MS.length; attempt++) {
          try {
            if (!isCurrent()) return;
            const healthy = await probeLocalServer(3100);
            if (!isCurrent()) return;
            if (healthy) {
              console.log('[EmbeddedServer] Server already running on port 3100, reusing');
              setState({ port: 3100, status: 'ready', error: null });
              return;
            }
          } catch {
            // Not ready yet, retry below.
          }

          if (attempt < DEV_HEALTHCHECK_RETRY_DELAYS_MS.length) {
            await sleep(DEV_HEALTHCHECK_RETRY_DELAYS_MS[attempt]);
          }
        }

        // Share the persistent dev profile with the dev launch scripts so a
        // standalone dev window also uses its own saved Gateway credential.
        const dataDir = await join(await homeDir(), '.zclaudia-dev');
        const serverPath = await resolveServerPath();
        if (!isCurrent()) return;

        console.log(`[EmbeddedServer] DEV mode: serverPath=${serverPath}, dataDir=${dataDir}`);

        // The sidecar Node version may differ from the user's current workspace
        // install. Re-run the existing ABI self-check before loading native modules
        // from server/dist in dev mode.
        const nativeModuleCheck = await Command.sidecar(
          'binaries/node',
          [DEV_NATIVE_MODULE_CHECKER],
          {
            cwd: DEV_REPO_ROOT,
            env: shellNetworkEnv,
          }
        ).execute();
        if (nativeModuleCheck.stdout.trim()) {
          console.log(`[EmbeddedServer] Native module check:\n${nativeModuleCheck.stdout.trim()}`);
        }
        if (nativeModuleCheck.stderr.trim()) {
          console.warn(
            `[EmbeddedServer] Native module check stderr:\n${nativeModuleCheck.stderr.trim()}`
          );
        }
        if (nativeModuleCheck.code !== 0) {
          throw new Error(
            'Native module compatibility check failed. Try running `pnpm rebuild` in the workspace.'
          );
        }

        if (!isCurrent()) return;

        // Use sidecar to avoid env var space issues with shell execute
        const command = Command.sidecar('binaries/node', [serverPath], {
          cwd: DEV_REPO_ROOT,
          env: {
            PORT: '0',
            SERVER_HOST: '127.0.0.1',
            ZCLAUDIA_DATA_DIR: dataDir,
            ZCLAUDIA_CHANNEL: 'dev',
            // Gateway environment settings inherited from the launching shell
            // may belong to production. The dev profile's database owns these.
            GATEWAY_URL: '',
            GATEWAY_SECRET: '',
            GATEWAY_NAME: '',
            GATEWAY_NAMESPACE: '',
            ...shellNetworkEnv,
          },
        });

        command.stdout.on('data', (line: string) => {
          const trimmed = line.trim();
          const match = trimmed.match(/^SERVER_READY:(\d+)$/);
          if (match && isCurrent()) {
            const port = parseInt(match[1], 10);
            console.log(`[EmbeddedServer] Ready on port ${port}`);
            setState({ port, status: 'ready', error: null });
          }
          if (!match) {
            console.log(`[EmbeddedServer] ${line}`);
          }
        });

        command.stderr.on('data', (line: string) => {
          console.warn(`[EmbeddedServer] ${line}`);
        });

        command.on('error', (error: string) => {
          console.error('[EmbeddedServer] Process error:', error);
          if (isCurrent()) {
            setState(prev => ({ ...prev, status: 'error', error }));
          }
        });

        command.on('close', (data: { code: number | null; signal: number | null }) => {
          console.log(`[EmbeddedServer] Process exited (code=${data.code}, signal=${data.signal})`);
          if (!isCurrent()) return;
          // A stale process may exit after another server has already taken over.
          // Probe outside the React state updater, and ignore superseded launches.
          const { port: recoveryPort } = stateRef.current;
          const reportExit = () => {
            if (!isCurrent()) return;
            setState({
              port: null,
              status: 'error',
              error: recoveryPort
                ? 'Server process exited unexpectedly'
                : `Server process crashed on startup (code=${data.code})`,
            });
          };
          if (!recoveryPort) {
            reportExit();
            return;
          }
          probeLocalServer(recoveryPort)
            .then(healthy => {
              if (!isCurrent()) return;
              if (healthy) {
                setState({ port: recoveryPort, status: 'ready', error: null });
              } else {
                reportExit();
              }
            })
            .catch(reportExit);
        });

        const child = await command.spawn();
        if (!isCurrent()) {
          await child.kill().catch(() => {});
          return;
        }
        childRef.current = child;
        console.log(`[EmbeddedServer] Spawned server process (pid=${child.pid})`);

        // Register PID with Rust so the exit hook can clean it up
        try {
          await invoke('register_dev_server_pid', { pid: child.pid });
        } catch (err) {
          console.warn('[EmbeddedServer] Failed to register dev server pid:', err);
          if (childRef.current === child) {
            childRef.current = null;
          }
          await child.kill().catch(killErr => {
            console.warn(
              '[EmbeddedServer] Failed to kill unregistered dev server process:',
              killErr
            );
          });
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to register dev server pid: ${message}`, { cause: err });
        }
      } catch (err) {
        console.error('[EmbeddedServer] Failed to start:', err);
        if (isCurrent()) {
          setState({
            port: null,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    [stateRef, registerManualEndpointProbe, runOpencodeEndpointProbe]
  );

  const startServerProd = useCallback(
    async (isCurrent: LaunchGuard) => {
      try {
        registerManualEndpointProbe();
        void runOpencodeEndpointProbe();

        const dataDir = await appDataDir();
        const serverPath = await resolveResource('server/server.mjs');

        console.log(`[EmbeddedServer] PROD mode: serverPath=${serverPath}, dataDir=${dataDir}`);

        if (!isCurrent()) return;

        // Use the Rust-side command to spawn node and capture SERVER_READY
        const result = await invoke<{ port: number }>('start_server', {
          serverPath,
          dataDir,
        });

        if (isCurrent()) {
          console.log(`[EmbeddedServer] Ready on port ${result.port}`);
          setState({ port: result.port, status: 'ready', error: null });
        }
      } catch (err) {
        console.error('[EmbeddedServer] Failed to start:', err);
        if (isCurrent()) {
          setState({
            port: null,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    [registerManualEndpointProbe, runOpencodeEndpointProbe]
  );

  const restart = useCallback(async () => {
    if (disabled || !isDesktopTauriNonWindows() || restartPendingRef.current) return;
    restartPendingRef.current = true;
    const generation = ++launchGenerationRef.current;

    setState(prev => ({
      ...prev,
      status: 'starting',
      error: null,
      port: null,
    }));

    try {
      if (import.meta.env.DEV) {
        const child = childRef.current;
        childRef.current = null;
        if (child) {
          await child.kill().catch(() => {});
        }
      } else {
        await invoke('stop_server');
      }

      if (isMounted() && generation === launchGenerationRef.current) {
        setRestartNonce(value => value + 1);
      }
    } catch (err) {
      if (isMounted() && generation === launchGenerationRef.current) {
        setState({ port: null, status: 'error', error: String(err) });
      }
    } finally {
      restartPendingRef.current = false;
    }
  }, [disabled, isMounted]);

  useEffect(() => {
    if (disabled || !isDesktopTauriNonWindows()) return;

    let cancelled = false;
    const generation = ++launchGenerationRef.current;
    const ownsLaunch = () => generation === launchGenerationRef.current;
    const isCurrent = () => !cancelled && isMounted() && ownsLaunch();

    if (import.meta.env.DEV) {
      void startServerDev(isCurrent);
    } else {
      void startServerProd(isCurrent);
    }

    return () => {
      cancelled = true;
      if (import.meta.env.DEV) {
        // Dev mode: do NOT kill the server process on cleanup.
        // React StrictMode unmount+remount causes a race condition:
        // cleanup kills the process, but the next mount's health check
        // may catch the dying process and "reuse" it, then it dies → stuck in ready state.
        // Leaving the server running lets the next mount genuinely reuse it.
        // The process will be cleaned up when the Tauri window closes.
      } else if (ownsLaunch()) {
        // Production: kill via Rust command
        invoke('stop_server').catch(() => {});
      }
    };
  }, [disabled, restartNonce, startServerDev, startServerProd, isMounted]);

  // Probe the local backend, not the gateway: a gateway outage alone must never
  // restart a healthy backend. Serial, bounded probes also cover production,
  // where the JS shell plugin does not receive the Rust child process's exit.
  useEffect(() => {
    if (disabled || !isDesktopTauriNonWindows() || state.status !== 'ready' || !state.port) return;
    let cancelled = false;
    let failures = 0;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const port = state.port;
    const check = async () => {
      controller = new AbortController();
      try {
        failures = (await probeLocalServer(port, controller.signal)) ? 0 : failures + 1;
      } catch {
        failures++;
      }
      if (cancelled) return;
      if (failures >= HEALTHCHECK_FAILURE_LIMIT) {
        console.warn('[EmbeddedServer] Local health checks failed; scheduling recovery');
        setState({ port: null, status: 'error', error: 'Local server is no longer responding' });
        return;
      }
      timer = setTimeout(() => void check(), HEALTHCHECK_INTERVAL_MS);
    };
    timer = setTimeout(() => void check(), HEALTHCHECK_INTERVAL_MS);
    const stableTimer = setTimeout(() => {
      recoveryAttemptsRef.current = 0;
    }, RECOVERY_STABLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(stableTimer);
      controller?.abort();
    };
  }, [disabled, state.status, state.port]);

  useEffect(() => {
    if (disabled || !isDesktopTauriNonWindows() || state.status !== 'error') return;
    const delay = Math.min(
      1000 * 2 ** Math.min(recoveryAttemptsRef.current, 5),
      RECOVERY_MAX_DELAY_MS
    );
    const timer = setTimeout(() => {
      recoveryAttemptsRef.current++;
      console.warn(
        `[EmbeddedServer] Automatically restarting (attempt ${recoveryAttemptsRef.current})`
      );
      void restart();
    }, delay);
    return () => clearTimeout(timer);
  }, [disabled, state, restart]);

  return useMemo(
    () => ({
      ...state,
      restart,
    }),
    [state, restart]
  );
}
