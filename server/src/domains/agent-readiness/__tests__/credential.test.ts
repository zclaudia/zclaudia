import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { hasLlmCredential } from '../credential.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';

function profile(p: Partial<LlmProfileConfig>): LlmProfileConfig {
  return {
    id: 'p1', name: 'P', providerType: 'anthropic',
    createdAt: 0, updatedAt: 0, ...p,
  } as LlmProfileConfig;
}

const SAVED: Record<string, string | undefined> = {};
const ENV_KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_BASE_URL'];
beforeEach(() => { for (const k of ENV_KEYS) { SAVED[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of ENV_KEYS) { if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k]; } });

describe('hasLlmCredential', () => {
  it('codex usable only with oauth access token', () => {
    expect(hasLlmCredential(profile({ providerType: 'openai-codex' }))).toBe(false);
    expect(hasLlmCredential(profile({ providerType: 'openai-codex', oauthCredentials: { access: 'tok', refresh: 'r', expires: 1, accountId: 'a' } }))).toBe(true);
  });
  it('explicit apiKey is usable for any provider', () => {
    expect(hasLlmCredential(profile({ providerType: 'anthropic', apiKey: 'sk-x' }))).toBe(true);
  });
  it('blank apiKey is not usable', () => {
    expect(hasLlmCredential(profile({ providerType: 'anthropic', apiKey: '   ' }))).toBe(false);
  });
  it('anthropic falls back to ANTHROPIC_API_KEY env', () => {
    expect(hasLlmCredential(profile({ providerType: 'anthropic' }))).toBe(false);
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    expect(hasLlmCredential(profile({ providerType: 'anthropic' }))).toBe(true);
  });
  it('openai falls back to OPENAI_API_KEY env', () => {
    process.env.OPENAI_API_KEY = 'sk-oai';
    expect(hasLlmCredential(profile({ providerType: 'openai' }))).toBe(true);
  });
  it('custom baseUrl routes through OPENAI_API_KEY', () => {
    expect(hasLlmCredential(profile({ providerType: 'anthropic', baseUrl: 'https://proxy/v1' }))).toBe(false);
    process.env.OPENAI_API_KEY = 'sk-proxy';
    expect(hasLlmCredential(profile({ providerType: 'anthropic', baseUrl: 'https://proxy/v1' }))).toBe(true);
  });
  it('unknown provider type is generously usable', () => {
    expect(hasLlmCredential(profile({ providerType: 'some-future-provider' as any }))).toBe(true);
  });
});
