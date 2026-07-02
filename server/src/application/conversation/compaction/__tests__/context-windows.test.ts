import { describe, it, expect } from 'vitest';
import { resolveContextWindow } from '../context-windows.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';

describe('resolveContextWindow', () => {
  it('returns the pi-ai registry value for a known model with pi_ai_registry source + matchedProvider', () => {
    // claude-opus-4-7 is registered under the anthropic provider in pi-ai's
    // registry. Same-provider lookup hits, so matchedProvider === 'anthropic'.
    const resolved = resolveContextWindow({ model: 'claude-opus-4-7' });
    expect(resolved.source).toBe('pi_ai_registry');
    expect(resolved.matchedProvider).toBe('anthropic');
    expect(resolved.value).toBeGreaterThan(100_000);
  });

  it('returns fallback for an unknown model when providerType defaults to anthropic', () => {
    // No profile, no agent profile, no override → providerType defaults to
    // anthropic. anthropic has no openai-compat default, so we land on the
    // 100k last-resort fallback.
    expect(resolveContextWindow({ model: 'totally-unknown-claude-variant' })).toEqual({
      value: 100_000,
      source: 'fallback',
    });
  });

  it('uses llm_profile.models entry contextWindow when present (profile_entry source)', () => {
    const llm: LlmProfileConfig = {
      id: 'p',
      name: 'a',
      providerType: 'anthropic',
      models: [{ modelId: 'claude-opus-4-7', contextWindow: 1_000_000 }],
      createdAt: 0,
      updatedAt: 0,
    };
    expect(resolveContextWindow({ model: 'claude-opus-4-7' }, undefined, llm)).toEqual({
      value: 1_000_000,
      source: 'profile_entry',
    });
  });

  it('treats entry.contextWindow=0 as no override (falls back to registry / pi_ai_registry)', () => {
    const llm: LlmProfileConfig = {
      id: 'p',
      name: 'a',
      providerType: 'anthropic',
      // contextWindow=0 violates the routes validator, but resolveContextWindow
      // must still degrade gracefully if a malformed value somehow lands in the DB.
      models: [{ modelId: 'claude-opus-4-7', contextWindow: 0 }],
      createdAt: 0,
      updatedAt: 0,
    };
    const resolved = resolveContextWindow({ model: 'claude-opus-4-7' }, undefined, llm);
    expect(resolved.source).toBe('pi_ai_registry');
    expect(resolved.matchedProvider).toBe('anthropic');
    expect(resolved.value).toBeGreaterThan(100_000);
  });

  it('accepts null profile with modelOverride and resolves via registry', () => {
    const resolved = resolveContextWindow(null, 'claude-sonnet-4-6');
    expect(resolved.source).toBe('pi_ai_registry');
    expect(resolved.matchedProvider).toBe('anthropic');
    expect(resolved.value).toBeGreaterThan(100_000);
  });

  it('reports openai_compat_default for an unknown model under an openai-compat proxy', () => {
    const llm: LlmProfileConfig = {
      id: 'p',
      name: 'c',
      providerType: 'openai',
      baseUrl: 'https://custom.example.com/v1',
      apiKey: 'sk-test',
      createdAt: 0,
      updatedAt: 0,
    };
    // Model id is not registered under any pi-ai provider, so we fall
    // through same-provider AND cross-provider lookups to the openai-compat
    // literal default — and tag the source distinctly so the UI doesn't
    // claim it came from the registry.
    expect(resolveContextWindow({ model: 'totally-unregistered-id-xyz' }, undefined, llm)).toEqual({
      value: 128_000,
      source: 'openai_compat_default',
    });
  });

  it('cross-provider sweep finds a model under a different pi-ai provider key', () => {
    // The motivating example: user runs claude-opus-4-7 through an
    // openai-compat proxy with providerType=openai. Same-provider lookup
    // misses (claude-opus-4-7 is registered under `anthropic`, not
    // `openai`), but the cross-provider sweep catches it and surfaces
    // matchedProvider === 'anthropic'.
    const llm: LlmProfileConfig = {
      id: 'p',
      name: 'proxy',
      providerType: 'openai',
      baseUrl: 'https://proxy.example.com/v1',
      apiKey: 'sk-x',
      createdAt: 0,
      updatedAt: 0,
    };
    const resolved = resolveContextWindow({ model: 'claude-opus-4-7' }, undefined, llm);
    expect(resolved.source).toBe('pi_ai_registry');
    expect(resolved.matchedProvider).toBe('anthropic');
    expect(resolved.value).toBeGreaterThan(100_000);
  });

  it('returns fallback 100k for unknown id under anthropic providerType (no openai-compat default)', () => {
    expect(resolveContextWindow({ model: 'totally-unknown' }, undefined, undefined)).toEqual({
      value: 100_000,
      source: 'fallback',
    });
  });

  it('llm_profile.models entry wins over registry lookup', () => {
    const llm: LlmProfileConfig = {
      id: 'p',
      name: 'a',
      providerType: 'anthropic',
      models: [{ modelId: 'claude-opus-4-7', contextWindow: 50_000 }],
      createdAt: 0,
      updatedAt: 0,
    };
    expect(resolveContextWindow({ model: 'claude-opus-4-7' }, undefined, llm)).toEqual({
      value: 50_000,
      source: 'profile_entry',
    });
  });
});
