import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';

vi.mock('../../../../domains/llm-profiles/codex-oauth-service.js', () => ({
  refreshIfNeeded: vi.fn(),
}));
vi.mock('../../../../domains/llm-profiles/repository-registry.js', () => ({
  getLlmProfileWriter: vi.fn(() => ({ updateOAuthCredentials: vi.fn() })),
}));

import { buildModel } from '../build-model.js';
import { refreshIfNeeded } from '../../../../domains/llm-profiles/codex-oauth-service.js';

function makeCodexProfile(): LlmProfileConfig {
  return {
    id: 'p1',
    name: 'codex',
    providerType: 'openai-codex',
    oauthCredentials: { access: 'a-token', refresh: 'r', expires: Date.now() + 60_000, accountId: 'acct_x' },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('buildModel — openai-codex', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps to openai-codex-responses API', () => {
    const { model } = buildModel(makeCodexProfile(), 'gpt-5-codex');
    expect(model.api).toBe('openai-codex-responses');
    expect(model.provider).toBe('openai-codex');
  });

  it('does NOT override baseUrl with OPENAI_BASE_URL env', () => {
    const prev = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = 'http://my-proxy';
    try {
      const { model } = buildModel(makeCodexProfile(), 'gpt-5-codex');
      expect(model.baseUrl).not.toBe('http://my-proxy');
    } finally {
      if (prev === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = prev;
    }
  });

  it('getApiKey delegates to refreshIfNeeded', async () => {
    (refreshIfNeeded as any).mockResolvedValue({ access: 'fresh-a', refresh: 'r', expires: 1, accountId: 'acct_x' });

    const { getApiKey } = buildModel(makeCodexProfile(), 'gpt-5-codex');
    expect(getApiKey).toBeDefined();
    const key = await getApiKey!('openai-codex');
    expect(key).toBe('fresh-a');
    expect(refreshIfNeeded).toHaveBeenCalled();
  });

  it('stamps ChatGPT-Account-Id and originator headers', () => {
    const { model } = buildModel(makeCodexProfile(), 'gpt-5-codex');
    expect(model.headers?.['ChatGPT-Account-Id']).toBe('acct_x');
    expect(model.headers?.['originator']).toBe('zclaudia');
  });
});
