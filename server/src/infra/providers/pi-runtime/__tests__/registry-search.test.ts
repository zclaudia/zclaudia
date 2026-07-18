import { describe, it, expect, vi } from 'vitest';

// Mock pi-ai's registry so we can exercise hit/miss paths deterministically.
vi.mock('@earendil-works/pi-ai', () => {
  const providers: Record<
    string,
    Array<{ id: string; contextWindow?: number; provider?: string }>
  > = {
    anthropic: [
      { id: 'claude-opus-4-7', contextWindow: 200_000 },
      { id: 'claude-sonnet-4-6', contextWindow: 200_000 },
    ],
    openai: [
      { id: 'gpt-5', contextWindow: 400_000 },
      { id: 'gpt-4o', contextWindow: 128_000 },
    ],
    deepseek: [{ id: 'deepseek-v4-flash', contextWindow: 1_000_000 }],
    // Same id under multiple providers — tie-breaker: largest contextWindow wins.
    openrouter: [
      { id: 'gpt-4o', contextWindow: 64_000 },
      { id: 'shared-model', contextWindow: 50_000 },
    ],
    vercel: [{ id: 'shared-model', contextWindow: 100_000 }],
  };

  return {
    getProviders: vi.fn(() => Object.keys(providers)),
    getModels: vi.fn((provider: string) => providers[provider] ?? []),
    getModel: vi.fn((provider: string, modelId: string) =>
      providers[provider]?.find(m => m.id === modelId)
    ),
  };
});

import {
  tryGetRegistryModel,
  findInRegistryCrossProvider,
  findRegistryProvidersForModel,
} from '../registry-search.js';

describe('tryGetRegistryModel', () => {
  it('returns the model + provider when same-provider lookup hits', () => {
    const hit = tryGetRegistryModel('anthropic', 'claude-opus-4-7');
    expect(hit).toBeDefined();
    expect(hit?.provider).toBe('anthropic');
    expect(hit?.model.contextWindow).toBe(200_000);
  });

  it('returns undefined when the provider has no such model id', () => {
    const hit = tryGetRegistryModel('anthropic', 'gpt-5');
    expect(hit).toBeUndefined();
  });

  it('returns undefined for an unknown provider entirely', () => {
    const hit = tryGetRegistryModel('not-a-real-provider', 'claude-opus-4-7');
    expect(hit).toBeUndefined();
  });
});

describe('findInRegistryCrossProvider', () => {
  it('finds a model under a provider key other than the configured providerType', () => {
    // The deepseek-v4-flash example from the spec: user runs it through an
    // openai-compat proxy, so the same-provider lookup with providerType=
    // `openai` misses; the cross-provider sweep finds it under `deepseek`.
    const hit = findInRegistryCrossProvider('deepseek-v4-flash');
    expect(hit).toBeDefined();
    expect(hit?.provider).toBe('deepseek');
    expect(hit?.model.contextWindow).toBe(1_000_000);
  });

  it('picks the largest contextWindow when the same id is registered under multiple providers', () => {
    // shared-model is in both openrouter (50k) and vercel (100k).
    const hit = findInRegistryCrossProvider('shared-model');
    expect(hit).toBeDefined();
    expect(hit?.provider).toBe('vercel');
    expect(hit?.model.contextWindow).toBe(100_000);
  });

  it('also handles tie-breaker when the larger entry is registered first or last', () => {
    // gpt-4o exists in both openai (128k) and openrouter (64k).
    const hit = findInRegistryCrossProvider('gpt-4o');
    expect(hit?.provider).toBe('openai');
    expect(hit?.model.contextWindow).toBe(128_000);
  });

  it('returns undefined when no provider has the requested model id', () => {
    const hit = findInRegistryCrossProvider('nonexistent-model');
    expect(hit).toBeUndefined();
  });
});

describe('findRegistryProvidersForModel', () => {
  it('returns every provider a model id is registered under', () => {
    expect(findRegistryProvidersForModel('deepseek-v4-flash')).toContain('deepseek');
    // gpt-4o is registered under both openai and openrouter.
    expect(findRegistryProvidersForModel('gpt-4o')).toEqual(['openai', 'openrouter']);
  });

  it('returns an empty array for an unknown model id', () => {
    expect(findRegistryProvidersForModel('nonexistent-model')).toEqual([]);
  });
});
