import { describe, it, expect } from 'vitest';
import { resolveContextWindow } from '../context-windows.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';

describe('resolveContextWindow', () => {
  it('returns hardcoded value for known model', () => {
    expect(resolveContextWindow({ model: 'claude-opus-4-7' })).toBe(200_000);
  });

  it('returns fallback for unknown model', () => {
    expect(resolveContextWindow({ model: 'unknown-model' })).toBe(100_000);
  });

  it('uses llm_profile.models entry contextWindow when present', () => {
    const llm: LlmProfileConfig = {
      id: 'p', name: 'a', providerType: 'anthropic',
      models: [{ modelId: 'claude-opus-4-7', contextWindow: 1_000_000 }],
      createdAt: 0, updatedAt: 0,
    };
    expect(resolveContextWindow({ model: 'claude-opus-4-7' }, undefined, llm)).toBe(1_000_000);
  });

  it('treats entry.contextWindow=0 as no override (falls back to hardcoded)', () => {
    const llm: LlmProfileConfig = {
      id: 'p', name: 'a', providerType: 'anthropic',
      // contextWindow=0 violates the routes validator, but resolveContextWindow
      // must still degrade gracefully if a malformed value somehow lands in the DB.
      models: [{ modelId: 'claude-opus-4-7', contextWindow: 0 }],
      createdAt: 0, updatedAt: 0,
    };
    expect(resolveContextWindow({ model: 'claude-opus-4-7' }, undefined, llm)).toBe(200_000);
  });

  it('accepts null profile with modelOverride', () => {
    expect(resolveContextWindow(null, 'claude-sonnet-4-6')).toBe(200_000);
  });

  it('uses llmProfileConfig.baseUrl-derived contextWindow when models entry + hardcoded both miss', () => {
    const llm: LlmProfileConfig = {
      id: 'p', name: 'c', providerType: 'openai-custom',
      baseUrl: 'https://custom.example.com/v1', apiKey: 'sk-test',
      createdAt: 0, updatedAt: 0,
    };
    // buildModel for openai-custom returns contextWindow: 128_000 default
    expect(resolveContextWindow({ model: 'unknown-custom-model' }, undefined, llm)).toBe(128_000);
  });

  it('returns FALLBACK_CONTEXT_WINDOW when llmProfileConfig is undefined and registry misses', () => {
    expect(resolveContextWindow({ model: 'totally-unknown' }, undefined, undefined)).toBe(100_000);
  });

  it('llm_profile.models entry wins over hardcoded MODEL_CONTEXT_WINDOWS', () => {
    const llm: LlmProfileConfig = {
      id: 'p', name: 'a', providerType: 'anthropic',
      models: [{ modelId: 'gpt-5', contextWindow: 50_000 }],
      createdAt: 0, updatedAt: 0,
    };
    expect(resolveContextWindow({ model: 'gpt-5' }, undefined, llm)).toBe(50_000);
  });
});
