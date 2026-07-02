import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { hasLlmCredential } from '../credential.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';

function profile(p: Partial<LlmProfileConfig>): LlmProfileConfig {
  return {
    id: 'p1',
    name: 'P',
    providerType: 'anthropic',
    createdAt: 0,
    updatedAt: 0,
    ...p,
  } as LlmProfileConfig;
}

const ENV = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_BASE_URL'];
const SAVED: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) {
    SAVED[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

describe('hasLlmCredential (profile-only)', () => {
  it('codex usable only with oauth access token', () => {
    expect(hasLlmCredential(profile({ providerType: 'openai-codex' }))).toBe(false);
    expect(
      hasLlmCredential(
        profile({
          providerType: 'openai-codex',
          oauthCredentials: { access: 'tok', refresh: 'r', expires: 1, accountId: 'a' },
        })
      )
    ).toBe(true);
  });
  it('explicit apiKey is usable', () => {
    expect(hasLlmCredential(profile({ apiKey: 'sk-x' }))).toBe(true);
  });
  it('blank apiKey is not usable', () => {
    expect(hasLlmCredential(profile({ apiKey: '   ' }))).toBe(false);
  });
  it('no profile key is NOT usable even when credential env vars are set (env-independent)', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    process.env.OPENAI_API_KEY = 'sk-oai';
    process.env.OPENAI_BASE_URL = 'http://127.0.0.1:3000/v1';
    expect(hasLlmCredential(profile({ providerType: 'anthropic' }))).toBe(false);
    expect(hasLlmCredential(profile({ providerType: 'openai', baseUrl: 'http://x/v1' }))).toBe(
      false
    );
  });
});
