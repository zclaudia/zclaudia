import { randomUUID } from 'node:crypto';
import { loginOpenAICodex, loginOpenAICodexDeviceCode } from '@earendil-works/pi-ai/oauth';
import type { CodexOAuthCredentials } from '@zclaudia/shared/core/llm-profile';
import { CodexOAuthError } from './codex-oauth-errors.js';

interface BaseSession {
  sessionId: string;
  profileId: string;
  createdAt: number;
  controller: AbortController;
  promise: Promise<void>;
}

interface BrowserStartInfo {
  sessionId: string;
  method: 'browser';
  authUrl: string;
  instructions?: string;
}

interface DeviceCodeStartInfo {
  sessionId: string;
  method: 'device_code';
  userCode: string;
  verificationUri: string;
  expiresAt: number;
}

export type CodexOAuthStartResult = BrowserStartInfo | DeviceCodeStartInfo;

export type CodexOAuthStatus =
  | { state: 'pending' }
  | { state: 'success'; credentials: CodexOAuthCredentials; accountId: string }
  | { state: 'error'; code: string; message: string }
  | { state: 'cancelled' };

interface InternalSession extends BaseSession {
  status: CodexOAuthStatus;
}

const SESSION_TTL_MS = 15 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

export class CodexOAuthSessionManager {
  private sessions = new Map<string, InternalSession>();
  private cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  dispose(): void {
    clearInterval(this.cleanupTimer);
    for (const s of this.sessions.values()) {
      try { s.controller.abort(); } catch { /* ignore */ }
    }
    this.sessions.clear();
  }

  async startBrowserFlow(profileId: string): Promise<CodexOAuthStartResult> {
    const sessionId = randomUUID();
    const controller = new AbortController();
    let resolveAuth!: (info: { url: string; instructions?: string }) => void;
    let rejectAuth!: (err: Error) => void;
    const authReady = new Promise<{ url: string; instructions?: string }>((res, rej) => {
      resolveAuth = res;
      rejectAuth = rej;
    });

    const promise = (loginOpenAICodex as any)({
      originator: 'zclaudia',
      onAuth: (info: { url: string; instructions?: string }) => resolveAuth(info),
      onPrompt: async () => { throw new CodexOAuthError('OAUTH_TIMEOUT', 'Manual prompt not supported via HTTP flow'); },
      signal: controller.signal,
    } as any).then(
      (creds: unknown) => {
        this.markSuccess(sessionId, creds as any);
      },
      (err: unknown) => {
        if (controller.signal.aborted) {
          this.markCancelled(sessionId);
          return;
        }
        const code = this.classifyLoginError(err);
        this.markError(sessionId, code, err instanceof Error ? err.message : String(err));
        if (code === 'OAUTH_PORT_CONFLICT') {
          rejectAuth(new CodexOAuthError('OAUTH_PORT_CONFLICT', 'localhost:1455 is occupied by another process'));
        } else {
          rejectAuth(err instanceof Error ? err : new Error(String(err)));
        }
      },
    );

    this.sessions.set(sessionId, {
      sessionId,
      profileId,
      createdAt: Date.now(),
      controller,
      promise,
      status: { state: 'pending' },
    });

    try {
      const info = await authReady;
      return { sessionId, method: 'browser', authUrl: info.url, instructions: info.instructions };
    } catch (err) {
      this.sessions.delete(sessionId);
      throw err;
    }
  }

  async startDeviceCodeFlow(profileId: string): Promise<CodexOAuthStartResult> {
    const sessionId = randomUUID();
    const controller = new AbortController();
    let resolveDevice!: (info: { userCode: string; verificationUri: string; expiresInSeconds?: number }) => void;
    let rejectDevice!: (err: Error) => void;
    const deviceReady = new Promise<{ userCode: string; verificationUri: string; expiresInSeconds?: number }>((res, rej) => {
      resolveDevice = res;
      rejectDevice = rej;
    });

    const promise = loginOpenAICodexDeviceCode({
      onDeviceCode: (info) => resolveDevice(info),
      signal: controller.signal,
    }).then(
      (creds) => this.markSuccess(sessionId, creds as any),
      (err) => {
        if (controller.signal.aborted) {
          this.markCancelled(sessionId);
          return;
        }
        const code = this.classifyLoginError(err);
        this.markError(sessionId, code, err instanceof Error ? err.message : String(err));
        rejectDevice(err instanceof Error ? err : new Error(String(err)));
      },
    );

    this.sessions.set(sessionId, {
      sessionId,
      profileId,
      createdAt: Date.now(),
      controller,
      promise,
      status: { state: 'pending' },
    });

    try {
      const info = await deviceReady;
      const expiresAt = Date.now() + (info.expiresInSeconds ?? 900) * 1000;
      return {
        sessionId,
        method: 'device_code',
        userCode: info.userCode,
        verificationUri: info.verificationUri,
        expiresAt,
      };
    } catch (err) {
      this.sessions.delete(sessionId);
      throw err;
    }
  }

  getStatus(sessionId: string): CodexOAuthStatus | undefined {
    return this.sessions.get(sessionId)?.status;
  }

  cancel(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.controller.abort();
  }

  remove(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    try { s.controller.abort(); } catch { /* ignore */ }
    this.sessions.delete(sessionId);
  }

  private markSuccess(sessionId: string, creds: CodexOAuthCredentials): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.status = { state: 'success', credentials: creds, accountId: creds.accountId };
  }

  private markError(sessionId: string, code: string, message: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.status = { state: 'error', code, message };
  }

  private markCancelled(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.status = { state: 'cancelled' };
  }

  private classifyLoginError(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    if (/EADDRINUSE.*1455/i.test(msg)) return 'OAUTH_PORT_CONFLICT';
    if (/state mismatch/i.test(msg)) return 'OAUTH_STATE_MISMATCH';
    if (/timeout/i.test(msg)) return 'OAUTH_TIMEOUT';
    if (/cancel/i.test(msg)) return 'OAUTH_CANCELLED';
    return 'OAUTH_TIMEOUT';
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [sid, s] of this.sessions) {
      if (now - s.createdAt > SESSION_TTL_MS) {
        try { s.controller.abort(); } catch { /* ignore */ }
        this.sessions.delete(sid);
      }
    }
  }
}
