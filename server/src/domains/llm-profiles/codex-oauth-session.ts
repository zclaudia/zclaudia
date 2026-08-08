import { randomUUID } from 'node:crypto';
import type { AuthEvent, AuthPrompt, ProviderAuthInteraction } from '@earendil-works/pi-ai';
import type { CodexOAuthCredentials } from '@zclaudia/shared/core/llm-profile';
import { CodexOAuthError, type CodexOAuthErrorCode } from './codex-oauth-errors.js';
import {
  CODEX_LOGIN_METHOD,
  codexOAuth,
  toCodexCredentials,
  type CodexLoginMethod,
} from './codex-oauth-pi.js';
import type { OAuthCredentialsWriter } from './codex-oauth-service.js';

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
const DEVICE_AUTH_CHALLENGE_MESSAGE = [
  'OpenAI blocked the Codex device-code request with a browser verification challenge.',
  'Enable device code login in ChatGPT security settings or workspace permissions, wait a moment, then retry.',
  'If this keeps failing, use browser login from a local Codex app or CLI session instead.',
].join(' ');

interface LoginErrorClassification {
  code: CodexOAuthErrorCode;
  message: string;
}

export class CodexOAuthSessionManager {
  private sessions = new Map<string, InternalSession>();
  private cleanupTimer: NodeJS.Timeout;

  constructor(private readonly writer?: OAuthCredentialsWriter) {
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  dispose(): void {
    clearInterval(this.cleanupTimer);
    for (const s of this.sessions.values()) {
      try {
        s.controller.abort();
      } catch {
        /* ignore */
      }
    }
    this.sessions.clear();
  }

  async startBrowserFlow(profileId: string): Promise<CodexOAuthStartResult> {
    const { sessionId, first } = this.start(profileId, CODEX_LOGIN_METHOD.browser);
    const event = await first;
    if (event.type !== 'auth_url') {
      this.sessions.delete(sessionId);
      throw new CodexOAuthError('OAUTH_TIMEOUT', `Unexpected login event: ${event.type}`);
    }
    return {
      sessionId,
      method: 'browser',
      authUrl: event.url,
      instructions: event.instructions,
    };
  }

  async startDeviceCodeFlow(profileId: string): Promise<CodexOAuthStartResult> {
    const { sessionId, first } = this.start(profileId, CODEX_LOGIN_METHOD.deviceCode);
    const event = await first;
    if (event.type !== 'device_code') {
      this.sessions.delete(sessionId);
      throw new CodexOAuthError('OAUTH_TIMEOUT', `Unexpected login event: ${event.type}`);
    }
    return {
      sessionId,
      method: 'device_code',
      userCode: event.userCode,
      verificationUri: event.verificationUri,
      expiresAt: Date.now() + (event.expiresInSeconds ?? 900) * 1000,
    };
  }

  /**
   * Runs `OAuthAuth.login` against a scripted interaction and registers the
   * session. Resolves `first` with the event that carries what the caller must
   * show the user — the auth URL for a browser login, the user code for a
   * device-code login — which is the point where the HTTP request can return
   * while the flow keeps running in the background.
   */
  private start(
    profileId: string,
    method: CodexLoginMethod
  ): { sessionId: string; first: Promise<AuthEvent> } {
    const sessionId = randomUUID();
    const controller = new AbortController();

    let resolveFirst!: (event: AuthEvent) => void;
    let rejectFirst!: (err: Error) => void;
    let settled = false;
    const first = new Promise<AuthEvent>((res, rej) => {
      resolveFirst = event => {
        if (settled) return;
        settled = true;
        res(event);
      };
      rejectFirst = err => {
        if (settled) return;
        settled = true;
        rej(err);
      };
    });

    const interaction: ProviderAuthInteraction = {
      signal: controller.signal,
      prompt: (prompt: AuthPrompt) => this.answerPrompt(prompt, method, controller.signal),
      notify: (event: AuthEvent) => {
        if (event.type === 'auth_url' || event.type === 'device_code') resolveFirst(event);
      },
    };

    // The credential shape check belongs inside the chain, not in the success
    // handler: a login that returns something unexpected has to land in the
    // same error path as a login that threw, or it escapes unhandled and the
    // session sits at `pending` forever.
    const promise = (async () => toCodexCredentials(await codexOAuth().login(interaction)))()
      .then(
        async credentials => {
          await this.markSuccess(sessionId, credentials);
        },
        (err: unknown) => {
          if (controller.signal.aborted) {
            this.markCancelled(sessionId);
            rejectFirst(new CodexOAuthError('OAUTH_CANCELLED', 'OAuth login cancelled.'));
            return;
          }
          const classified = this.classifyLoginError(err);
          this.markError(sessionId, classified.code, classified.message);
          rejectFirst(new CodexOAuthError(classified.code, classified.message));
        }
      );

    this.sessions.set(sessionId, {
      sessionId,
      profileId,
      createdAt: Date.now(),
      controller,
      promise,
      status: { state: 'pending' },
    });

    return {
      sessionId,
      first: first.catch(err => {
        this.sessions.delete(sessionId);
        throw err;
      }),
    };
  }

  /**
   * Answers the prompts `openaiCodexOAuth.login` asks.
   *
   * The method `select` is answered from the endpoint the caller hit. The
   * browser flow then races its local callback server against a `manual_code`
   * prompt for pasting the redirect URL — there is nowhere to paste one in an
   * HTTP flow, so that prompt stays unanswered until the flow ends. It must
   * still settle on abort: pi awaits the prompt when the callback server
   * returns no code, so resolving it never would hang a cancelled login.
   */
  private answerPrompt(
    prompt: AuthPrompt,
    method: CodexLoginMethod,
    signal: AbortSignal
  ): Promise<string> {
    if (prompt.type === 'select') return Promise.resolve(method);
    if (prompt.type === 'manual_code') {
      return new Promise<string>((_resolve, reject) => {
        const abort = () =>
          reject(new CodexOAuthError('OAUTH_CANCELLED', 'OAuth login cancelled.'));
        if (signal.aborted || prompt.signal?.aborted) return abort();
        signal.addEventListener('abort', abort, { once: true });
        prompt.signal?.addEventListener('abort', abort, { once: true });
      });
    }
    return Promise.reject(
      new CodexOAuthError('OAUTH_TIMEOUT', `Unsupported login prompt: ${prompt.type}`)
    );
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
    try {
      s.controller.abort();
    } catch {
      /* ignore */
    }
    this.sessions.delete(sessionId);
  }

  private async markSuccess(sessionId: string, creds: CodexOAuthCredentials): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    if (this.writer) {
      try {
        await this.writer.updateOAuthCredentials(s.profileId, creds);
      } catch (err) {
        console.error('[codex-oauth-session] failed to persist credentials', err);
        this.markError(
          sessionId,
          'REFRESH_FAILED_TRANSIENT',
          err instanceof Error ? err.message : String(err)
        );
        return;
      }
    }
    if (s.controller.signal.aborted) {
      this.markCancelled(sessionId);
      return;
    }
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

  private classifyLoginError(err: unknown): LoginErrorClassification {
    const msg = err instanceof Error ? err.message : String(err);
    if (/EADDRINUSE.*1455/i.test(msg)) {
      return {
        code: 'OAUTH_PORT_CONFLICT',
        message: 'localhost:1455 is occupied by another process',
      };
    }
    if (this.isDeviceAuthChallenge(msg)) {
      return { code: 'OAUTH_DEVICE_AUTH_CHALLENGE', message: DEVICE_AUTH_CHALLENGE_MESSAGE };
    }
    if (/state mismatch/i.test(msg))
      return {
        code: 'OAUTH_STATE_MISMATCH',
        message: 'OAuth state mismatch. Please retry the sign-in flow.',
      };
    if (/timeout/i.test(msg))
      return { code: 'OAUTH_TIMEOUT', message: 'OAuth login timed out. Please retry.' };
    if (/cancel/i.test(msg)) return { code: 'OAUTH_CANCELLED', message: 'OAuth login cancelled.' };
    return { code: 'OAUTH_TIMEOUT', message: this.compactErrorMessage(msg) };
  }

  private isDeviceAuthChallenge(message: string): boolean {
    return (
      /OpenAI Codex device code request failed with status 429/i.test(message) ||
      (/deviceauth\/(?:usercode|token)|OpenAI Codex device auth/i.test(message) &&
        /<!doctype html|<html|cloudflare|challenges\.cloudflare\.com|Enable JavaScript and cookies|Just a moment|__cf_chl/i.test(
          message
        ))
    );
  }

  private compactErrorMessage(message: string): string {
    if (/<!doctype html|<html/i.test(message)) {
      return 'OAuth login failed because the provider returned an HTML error page. Please retry, or use browser login from a local Codex app or CLI session.';
    }
    return message.length > 500 ? `${message.slice(0, 500)}...` : message;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [sid, s] of this.sessions) {
      if (now - s.createdAt > SESSION_TTL_MS) {
        try {
          s.controller.abort();
        } catch {
          /* ignore */
        }
        this.sessions.delete(sid);
      }
    }
  }
}
