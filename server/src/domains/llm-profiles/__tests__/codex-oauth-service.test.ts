import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { refreshIfNeeded, _resetCodexOAuthLocksForTest } from '../codex-oauth-service.js';
import { CODEX_REFRESH_MARGIN_MS } from '../codex-oauth-pi.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';

vi.mock('../codex-oauth-pi.js', async importActual => ({
  ...(await importActual<typeof import('../codex-oauth-pi.js')>()),
  codexOAuth: vi.fn(),
}));
import { codexOAuth } from '../codex-oauth-pi.js';

/** Installs a fake `OAuthAuth` and returns its `refresh` spy. */
function mockRefresh(
  impl: (...args: unknown[]) => unknown
): ReturnType<typeof vi.fn> {
  const refresh = vi.fn(impl);
  (codexOAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    name: 'OpenAI (test)',
    login: vi.fn(),
    refresh,
    toAuth: vi.fn(),
  });
  return refresh;
}

/** Comfortably outside the refresh margin, so no rotation is due. */
const FRESH_EXPIRY = () => Date.now() + CODEX_REFRESH_MARGIN_MS + 60_000;
/** Inside the margin: still valid, but close enough that pi would rotate it. */
const STALE_EXPIRY = () => Date.now() + 30_000;

function makeProfile(overrides: Partial<LlmProfileConfig> = {}): LlmProfileConfig {
  return {
    id: 'p1',
    name: 'codex',
    providerType: 'openai-codex',
    oauthCredentials: { access: 'a', refresh: 'r', expires: STALE_EXPIRY(), accountId: 'acct_x' },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as LlmProfileConfig;
}

describe('refreshIfNeeded', () => {
  let repo: { updateOAuthCredentials: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    _resetCodexOAuthLocksForTest();
    repo = { updateOAuthCredentials: vi.fn() };
  });
  afterEach(() => vi.restoreAllMocks());

  it('throws NOT_AUTHENTICATED when oauthCredentials missing', async () => {
    const profile = makeProfile({ oauthCredentials: undefined });
    await expect(refreshIfNeeded(profile, repo as any)).rejects.toThrow('NOT_AUTHENTICATED');
  });

  it('does not call pi-ai at all while the token is outside the refresh margin', async () => {
    // pi 0.84 dropped the helper that decided this for us, so the margin check
    // is ours; without it every request would burn a token exchange.
    const refresh = mockRefresh(() => {
      throw new Error('should not refresh');
    });
    const creds = { access: 'a', refresh: 'r', expires: FRESH_EXPIRY(), accountId: 'acct_x' };

    const result = await refreshIfNeeded(makeProfile({ oauthCredentials: creds }), repo as any);
    expect(result).toEqual(creds);
    expect(refresh).not.toHaveBeenCalled();
    expect(repo.updateOAuthCredentials).not.toHaveBeenCalled();
  });

  it('refreshes and persists once the token is inside the margin', async () => {
    const rotated = {
      type: 'oauth',
      access: 'b',
      refresh: 'r2',
      expires: FRESH_EXPIRY(),
      accountId: 'acct_x',
    };
    const refresh = mockRefresh(async () => rotated);

    const result = await refreshIfNeeded(makeProfile(), repo as any);
    expect(refresh).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'oauth', refresh: 'r' }),
      expect.any(AbortSignal)
    );
    // Stored without pi's type tag.
    const stored = { access: 'b', refresh: 'r2', expires: rotated.expires, accountId: 'acct_x' };
    expect(result).toEqual(stored);
    expect(repo.updateOAuthCredentials).toHaveBeenCalledWith('p1', stored);
  });

  it('treats a refreshed credential with no accountId as transient failure', async () => {
    mockRefresh(async () => ({ type: 'oauth', access: 'b', refresh: 'r2', expires: 1 }));
    await expect(refreshIfNeeded(makeProfile(), repo as any)).rejects.toMatchObject({
      code: 'REFRESH_FAILED_TRANSIENT',
    });
    expect(repo.updateOAuthCredentials).not.toHaveBeenCalled();
  });

  it('single-flight: 10 concurrent calls trigger only 1 refresh', async () => {
    let calls = 0;
    mockRefresh(async () => {
      calls += 1;
      await new Promise(r => setTimeout(r, 20));
      return { type: 'oauth', access: 'a', refresh: 'r', expires: FRESH_EXPIRY(), accountId: 'x' };
    });

    const profile = makeProfile();
    await Promise.all(Array.from({ length: 10 }, () => refreshIfNeeded(profile, repo as any)));
    expect(calls).toBe(1);
  });

  it('classifies refresh_token errors as REFRESH_FAILED_TERMINAL and clears creds', async () => {
    mockRefresh(() => Promise.reject(new Error('refresh_token_expired')));

    await expect(refreshIfNeeded(makeProfile(), repo as any)).rejects.toMatchObject({
      code: 'REFRESH_FAILED_TERMINAL',
    });
    expect(repo.updateOAuthCredentials).toHaveBeenCalledWith('p1', null);
  });

  it('classifies network errors as REFRESH_FAILED_TRANSIENT and leaves creds alone', async () => {
    mockRefresh(() => Promise.reject(new Error('fetch failed: ENETUNREACH')));

    await expect(refreshIfNeeded(makeProfile(), repo as any)).rejects.toMatchObject({
      code: 'REFRESH_FAILED_TRANSIENT',
    });
    expect(repo.updateOAuthCredentials).not.toHaveBeenCalled();
  });
});
