import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { refreshIfNeeded, _resetCodexOAuthLocksForTest } from '../codex-oauth-service.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';

// Mock pi-ai oauth helpers
vi.mock('@earendil-works/pi-ai/oauth', () => ({
  getOAuthApiKey: vi.fn(),
}));
import { getOAuthApiKey } from '@earendil-works/pi-ai/oauth';

function makeProfile(overrides: Partial<LlmProfileConfig> = {}): LlmProfileConfig {
  return {
    id: 'p1',
    name: 'codex',
    providerType: 'openai-codex',
    oauthCredentials: { access: 'a', refresh: 'r', expires: Date.now() + 60_000, accountId: 'acct_x' },
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

  it('returns existing credentials when pi-ai returns same object', async () => {
    const creds = { access: 'a', refresh: 'r', expires: Date.now() + 60_000, accountId: 'acct_x' };
    (getOAuthApiKey as any).mockResolvedValue({ apiKey: 'a', newCredentials: creds });

    const profile = makeProfile({ oauthCredentials: creds });
    const result = await refreshIfNeeded(profile, repo as any);
    expect(result.access).toBe('a');
    expect(repo.updateOAuthCredentials).not.toHaveBeenCalled();
  });

  it('persists new credentials when pi-ai refreshed them', async () => {
    const newCreds = { access: 'b', refresh: 'r2', expires: Date.now() + 1_000_000, accountId: 'acct_x' };
    (getOAuthApiKey as any).mockResolvedValue({ apiKey: 'b', newCredentials: newCreds });

    const profile = makeProfile();
    await refreshIfNeeded(profile, repo as any);
    expect(repo.updateOAuthCredentials).toHaveBeenCalledWith('p1', newCreds);
  });

  it('single-flight: 10 concurrent calls trigger only 1 pi-ai call', async () => {
    let calls = 0;
    (getOAuthApiKey as any).mockImplementation(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return { apiKey: 'a', newCredentials: makeProfile().oauthCredentials };
    });

    const profile = makeProfile();
    const promises = Array.from({ length: 10 }, () => refreshIfNeeded(profile, repo as any));
    await Promise.all(promises);
    expect(calls).toBe(1);
  });

  it('classifies refresh_token errors as REFRESH_FAILED_TERMINAL and clears creds', async () => {
    (getOAuthApiKey as any).mockRejectedValue(new Error('refresh_token_expired'));

    const profile = makeProfile();
    await expect(refreshIfNeeded(profile, repo as any)).rejects.toMatchObject({ code: 'REFRESH_FAILED_TERMINAL' });
    expect(repo.updateOAuthCredentials).toHaveBeenCalledWith('p1', null);
  });

  it('classifies network errors as REFRESH_FAILED_TRANSIENT and leaves creds alone', async () => {
    (getOAuthApiKey as any).mockRejectedValue(new Error('fetch failed: ENETUNREACH'));

    const profile = makeProfile();
    await expect(refreshIfNeeded(profile, repo as any)).rejects.toMatchObject({ code: 'REFRESH_FAILED_TRANSIENT' });
    expect(repo.updateOAuthCredentials).not.toHaveBeenCalled();
  });
});
