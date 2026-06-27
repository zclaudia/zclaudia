import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CodexOAuthSessionManager } from '../codex-oauth-session.js';

vi.mock('@earendil-works/pi-ai/oauth', () => ({
  loginOpenAICodex: vi.fn(),
  loginOpenAICodexDeviceCode: vi.fn(),
}));
import { loginOpenAICodex, loginOpenAICodexDeviceCode } from '@earendil-works/pi-ai/oauth';

describe('CodexOAuthSessionManager', () => {
  let mgr: CodexOAuthSessionManager;
  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new CodexOAuthSessionManager();
  });
  afterEach(() => mgr.dispose());

  it('startBrowser fires onAuth callback and returns auth URL', async () => {
    let capturedOnAuth: ((info: { url: string; instructions?: string }) => void) | null = null;
    (loginOpenAICodex as any).mockImplementation((opts: any) => {
      capturedOnAuth = opts.onAuth;
      return new Promise(() => {});  // never resolves in this test
    });

    const startPromise = mgr.startBrowserFlow('p1');
    // Wait a microtask for loginOpenAICodex to be called
    await new Promise((r) => setImmediate(r));
    capturedOnAuth!({ url: 'https://auth.openai.com/oauth/authorize?x=1' });

    const session = await startPromise;
    expect(session.method).toBe('browser');
    expect(session.authUrl).toBe('https://auth.openai.com/oauth/authorize?x=1');
    expect(mgr.getStatus(session.sessionId)?.state).toBe('pending');
  });

  it('startDeviceCode returns user_code and verification_uri', async () => {
    let captured: ((info: any) => void) | null = null;
    (loginOpenAICodexDeviceCode as any).mockImplementation((opts: any) => {
      captured = opts.onDeviceCode;
      return new Promise(() => {});
    });

    const startPromise = mgr.startDeviceCodeFlow('p1');
    await new Promise((r) => setImmediate(r));
    captured!({ userCode: 'ABCD-1234', verificationUri: 'https://auth.openai.com/codex/device' });

    const session = await startPromise;
    expect(session.method).toBe('device_code');
    expect(session.userCode).toBe('ABCD-1234');
    expect(session.verificationUri).toBe('https://auth.openai.com/codex/device');
  });

  it('sanitizes Cloudflare HTML device-code failures', async () => {
    (loginOpenAICodexDeviceCode as any).mockRejectedValue(new Error(
      'OpenAI Codex device code request failed with status 429: <!DOCTYPE html><html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue<script>window._cf_chl_opt = {}</script></body></html>',
    ));

    try {
      await mgr.startDeviceCodeFlow('p1');
      throw new Error('expected startDeviceCodeFlow to reject');
    } catch (err) {
      expect(err).toMatchObject({
        code: 'OAUTH_DEVICE_AUTH_CHALLENGE',
        message: expect.stringContaining('OpenAI blocked the Codex device-code request'),
      });
      expect(err instanceof Error ? err.message : String(err)).not.toMatch(/<!DOCTYPE html|_cf_chl/i);
    }
  });

  it('on success, status becomes success with credentials', async () => {
    const credsFromPiAi = { access: 'a', refresh: 'r', expires: 1, accountId: 'acct_x' };
    (loginOpenAICodex as any).mockImplementation(async (opts: any) => {
      opts.onAuth({ url: 'http://x' });
      return credsFromPiAi;
    });

    const session = await mgr.startBrowserFlow('p1');
    await new Promise((r) => setTimeout(r, 5));
    const status = mgr.getStatus(session.sessionId);
    expect(status?.state).toBe('success');
    expect(status?.credentials).toEqual(credsFromPiAi);
  });

  it('does not report success until credentials are persisted', async () => {
    mgr.dispose();
    let resolvePersist!: () => void;
    const writer = {
      updateOAuthCredentials: vi.fn(() => new Promise<void>((resolve) => {
        resolvePersist = resolve;
      })),
    };
    mgr = new CodexOAuthSessionManager(writer);
    const credsFromPiAi = { access: 'a', refresh: 'r', expires: 1, accountId: 'acct_x' };
    (loginOpenAICodex as any).mockImplementation(async (opts: any) => {
      opts.onAuth({ url: 'http://x' });
      return credsFromPiAi;
    });

    const session = await mgr.startBrowserFlow('p1');
    await new Promise((r) => setTimeout(r, 5));

    expect(writer.updateOAuthCredentials).toHaveBeenCalledWith('p1', credsFromPiAi);
    expect(mgr.getStatus(session.sessionId)?.state).toBe('pending');

    resolvePersist();
    await new Promise((r) => setTimeout(r, 5));

    const status = mgr.getStatus(session.sessionId);
    expect(status?.state).toBe('success');
    expect(status).toMatchObject({ accountId: 'acct_x' });
  });

  it('cancel aborts the flow', async () => {
    let receivedSignal: AbortSignal | undefined;
    (loginOpenAICodex as any).mockImplementation((opts: any) => {
      receivedSignal = opts.signal;
      opts.onAuth({ url: 'http://x' });
      return new Promise((_, reject) => {
        opts.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });

    const session = await mgr.startBrowserFlow('p1');
    mgr.cancel(session.sessionId);
    await new Promise((r) => setTimeout(r, 5));
    expect(receivedSignal?.aborted).toBe(true);
    expect(mgr.getStatus(session.sessionId)?.state).toBe('cancelled');
  });

  it('port 1455 conflict surfaces as OAUTH_PORT_CONFLICT', async () => {
    (loginOpenAICodex as any).mockImplementation(() => {
      const err = new Error('listen EADDRINUSE 127.0.0.1:1455');
      return Promise.reject(err);
    });

    const startPromise = mgr.startBrowserFlow('p1');
    await expect(startPromise).rejects.toMatchObject({ code: 'OAUTH_PORT_CONFLICT' });
  });
});
