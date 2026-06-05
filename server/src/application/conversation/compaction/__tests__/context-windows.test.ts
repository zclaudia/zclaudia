import { describe, it, expect } from 'vitest';
import { resolveContextWindow } from '../context-windows.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';

describe('resolveContextWindow', () => {
  it('returns hardcoded value for known model with hardcoded_table source', () => {
    expect(resolveContextWindow({ model: 'claude-opus-4-7' })).toEqual({
      value: 200_000,
      source: 'hardcoded_table',
    });
  });

  it('returns fallback for unknown model with fallback source', () => {
    expect(resolveContextWindow({ model: 'unknown-model' })).toEqual({
      value: 100_000,
      source: 'fallback',
    });
  });

  it('uses llm_profile.models entry contextWindow when present (profile_entry source)', () => {
    const llm: LlmProfileConfig = {
      id: 'p', name: 'a', providerType: 'anthropic',
      models: [{ modelId: 'claude-opus-4-7', contextWindow: 1_000_000 }],
      createdAt: 0, updatedAt: 0,
    };
    expect(resolveContextWindow({ model: 'claude-opus-4-7' }, undefined, llm)).toEqual({
      value: 1_000_000,
      source: 'profile_entry',
    });
  });

  it('treats entry.contextWindow=0 as no override (falls back to hardcoded_table)', () => {
    const llm: LlmProfileConfig = {
      id: 'p', name: 'a', providerType: 'anthropic',
      // contextWindow=0 violates the routes validator, but resolveContextWindow
      // must still degrade gracefully if a malformed value somehow lands in the DB.
      models: [{ modelId: 'claude-opus-4-7', contextWindow: 0 }],
      createdAt: 0, updatedAt: 0,
    };
    expect(resolveContextWindow({ model: 'claude-opus-4-7' }, undefined, llm)).toEqual({
      value: 200_000,
      source: 'hardcoded_table',
    });
  });

  it('accepts null profile with modelOverride', () => {
    expect(resolveContextWindow(null, 'claude-sonnet-4-6')).toEqual({
      value: 200_000,
      source: 'hardcoded_table',
    });
  });

  it('uses llmProfileConfig.baseUrl-derived contextWindow with pi_ai_registry source', () => {
    const llm: LlmProfileConfig = {
      id: 'p', name: 'c', providerType: 'openai',
      baseUrl: 'https://custom.example.com/v1', apiKey: 'sk-test',
      createdAt: 0, updatedAt: 0,
    };
    // buildModel for openai+baseUrl returns contextWindow: 128_000 default.
    // Source is pi_ai_registry: from the resolver's perspective, any window
    // surfaced via buildModel() — whether pi-ai's registry lookup or the
    // openai-compat literal default — is "what the model itself declares".
    expect(resolveContextWindow({ model: 'unknown-custom-model' }, undefined, llm)).toEqual({
      value: 128_000,
      source: 'pi_ai_registry',
    });
  });

  it('returns fallback when llmProfileConfig is undefined and registry misses', () => {
    expect(resolveContextWindow({ model: 'totally-unknown' }, undefined, undefined)).toEqual({
      value: 100_000,
      source: 'fallback',
    });
  });

  it('llm_profile.models entry wins over hardcoded MODEL_CONTEXT_WINDOWS', () => {
    const llm: LlmProfileConfig = {
      id: 'p', name: 'a', providerType: 'anthropic',
      models: [{ modelId: 'gpt-5', contextWindow: 50_000 }],
      createdAt: 0, updatedAt: 0,
    };
    expect(resolveContextWindow({ model: 'gpt-5' }, undefined, llm)).toEqual({
      value: 50_000,
      source: 'profile_entry',
    });
  });
});
