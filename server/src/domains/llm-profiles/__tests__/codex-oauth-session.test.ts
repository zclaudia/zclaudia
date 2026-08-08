import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProviderAuthInteraction } from '@earendil-works/pi-ai';
import { CodexOAuthSessionManager } from '../codex-oauth-session.js';

// The seam is our own adapter rather than a pi-ai module path: pi 0.84 folded
// the standalone login functions into `OAuthAuth`, and pinning the tests to the
// adapter keeps them honest about the contract we drive rather than about which
// file pi happens to publish it from.
vi.mock('../codex-oauth-pi.js', async importActual => ({
  ...(await importActual<typeof import('../codex-oauth-pi.js')>()),
  codexOAuth: vi.fn(),
}));
import { codexOAuth } from '../codex-oauth-pi.js';

type Login = (interaction: ProviderAuthInteraction) => Promise<unknown>;

/** Installs a fake `OAuthAuth` whose `login` is the given implementation. */
function mockLogin(login: Login): void {
  (codexOAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    name: 'OpenAI (test)',
    login,
    refresh: vi.fn(),
    toAuth: vi.fn(),
  });
}

const CREDENTIAL = {
  type: 'oauth' as const,
  access: 'a',
  refresh: 'r',
  expires: 1,
  accountId: 'acct_x',
};
/** What we store — pi's credential minus its type tag. */
const STORED = { access: 'a', refresh: 'r', expires: 1, accountId: 'acct_x' };

describe('CodexOAuthSessionManager', () => {
  let mgr: CodexOAuthSessionManager;
  beforeEach(() => {
    vi.clearAllMocks();
    mgr = new CodexOAuthSessionManager();
  });
  afterEach(() => mgr.dispose());

  it('answers the method prompt with browser and returns the auth URL it is notified of', async () => {
    let method: string | undefined;
    mockLogin(async interaction => {
      method = await interaction.prompt({ type: 'select', message: 'pick', options: [] });
      interaction.notify({
        type: 'auth_url',
        url: 'https://auth.openai.com/oauth/authorize?x=1',
        instructions: 'open me',
      });
      return new Promise(() => {}); // login stays in flight
    });

    const session = await mgr.startBrowserFlow('p1');
    expect(method).toBe('browser');
    expect(session.method).toBe('browser');
    expect(session).toMatchObject({
      authUrl: 'https://auth.openai.com/oauth/authorize?x=1',
      instructions: 'open me',
    });
    expect(mgr.getStatus(session.sessionId)?.state).toBe('pending');
  });

  it('answers the method prompt with device_code and returns the user code', async () => {
    let method: string | undefined;
    mockLogin(async interaction => {
      method = await interaction.prompt({ type: 'select', message: 'pick', options: [] });
      interaction.notify({
        type: 'device_code',
        userCode: 'ABCD-1234',
        verificationUri: 'https://auth.openai.com/codex/device',
        expiresInSeconds: 600,
      });
      return new Promise(() => {});
    });

    const session = await mgr.startDeviceCodeFlow('p1');
    expect(method).toBe('device_code');
    expect(session).toMatchObject({
      method: 'device_code',
      userCode: 'ABCD-1234',
      verificationUri: 'https://auth.openai.com/codex/device',
    });
  });

  it('leaves the manual-code prompt unanswered but settles it on cancel', async () => {
    // pi awaits this prompt when the callback server yields no code, so a
    // promise that never settles would hang a cancelled browser login.
    let promptSettled: 'resolved' | 'rejected' | 'pending' = 'pending';
    mockLogin(async interaction => {
      await interaction.prompt({ type: 'select', message: 'pick', options: [] });
      interaction.notify({ type: 'auth_url', url: 'http://x' });
      interaction
        .prompt({ type: 'manual_code', message: 'paste' })
        .then(
          () => (promptSettled = 'resolved'),
          () => (promptSettled = 'rejected')
        );
      return new Promise((_resolve, reject) => {
        interaction.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });

    const session = await mgr.startBrowserFlow('p1');
    await new Promise(r => setTimeout(r, 5));
    expect(promptSettled).toBe('pending');

    mgr.cancel(session.sessionId);
    await new Promise(r => setTimeout(r, 5));
    expect(promptSettled).toBe('rejected');
  });

  it('sanitizes Cloudflare HTML device-code failures', async () => {
    mockLogin(() =>
      Promise.reject(
        new Error(
          'OpenAI Codex device code request failed with status 429: <!DOCTYPE html><html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue<script>window._cf_chl_opt = {}</script></body></html>'
        )
      )
    );

    await expect(mgr.startDeviceCodeFlow('p1')).rejects.toMatchObject({
      code: 'OAUTH_DEVICE_AUTH_CHALLENGE',
      message: expect.stringContaining('OpenAI blocked the Codex device-code request'),
    });
    await expect(mgr.startDeviceCodeFlow('p1')).rejects.not.toMatchObject({
      message: expect.stringMatching(/<!DOCTYPE html|_cf_chl/i),
    });
  });

  it('on success, status becomes success with the credentials stripped of their type tag', async () => {
    mockLogin(async interaction => {
      interaction.notify({ type: 'auth_url', url: 'http://x' });
      return CREDENTIAL;
    });

    const session = await mgr.startBrowserFlow('p1');
    await new Promise(r => setTimeout(r, 5));
    const status = mgr.getStatus(session.sessionId);
    expect(status?.state).toBe('success');
    expect(status).toMatchObject({ credentials: STORED, accountId: 'acct_x' });
  });

  it('rejects a login whose credentials carry no accountId', async () => {
    mockLogin(async interaction => {
      interaction.notify({ type: 'auth_url', url: 'http://x' });
      return { type: 'oauth', access: 'a', refresh: 'r', expires: 1 };
    });

    const session = await mgr.startBrowserFlow('p1');
    await new Promise(r => setTimeout(r, 5));
    expect(mgr.getStatus(session.sessionId)?.state).toBe('error');
  });

  it('does not report success until credentials are persisted', async () => {
    mgr.dispose();
    let resolvePersist!: () => void;
    const writer = {
      updateOAuthCredentials: vi.fn(
        () =>
          new Promise<void>(resolve => {
            resolvePersist = resolve;
          })
      ),
    };
    mgr = new CodexOAuthSessionManager(writer);
    mockLogin(async interaction => {
      interaction.notify({ type: 'auth_url', url: 'http://x' });
      return CREDENTIAL;
    });

    const session = await mgr.startBrowserFlow('p1');
    await new Promise(r => setTimeout(r, 5));

    expect(writer.updateOAuthCredentials).toHaveBeenCalledWith('p1', STORED);
    expect(mgr.getStatus(session.sessionId)?.state).toBe('pending');

    resolvePersist();
    await new Promise(r => setTimeout(r, 5));
    expect(mgr.getStatus(session.sessionId)).toMatchObject({
      state: 'success',
      accountId: 'acct_x',
    });
  });

  it('cancel aborts the flow', async () => {
    let receivedSignal: AbortSignal | undefined;
    mockLogin(interaction => {
      receivedSignal = interaction.signal;
      interaction.notify({ type: 'auth_url', url: 'http://x' });
      return new Promise((_resolve, reject) => {
        interaction.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });

    const session = await mgr.startBrowserFlow('p1');
    mgr.cancel(session.sessionId);
    await new Promise(r => setTimeout(r, 5));
    expect(receivedSignal?.aborted).toBe(true);
    expect(mgr.getStatus(session.sessionId)?.state).toBe('cancelled');
  });

  it('port 1455 conflict surfaces as OAUTH_PORT_CONFLICT', async () => {
    mockLogin(() => Promise.reject(new Error('listen EADDRINUSE 127.0.0.1:1455')));
    await expect(mgr.startBrowserFlow('p1')).rejects.toMatchObject({
      code: 'OAUTH_PORT_CONFLICT',
    });
  });
});
