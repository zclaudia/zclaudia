import { describe, it, expect } from 'vitest';
import { resolveContextWindow } from '../context-windows.js';

describe('resolveContextWindow', () => {
  it('returns hardcoded value for known model', () => {
    expect(resolveContextWindow({ model: 'claude-opus-4-7', contextWindow: null })).toBe(200_000);
  });

  it('returns fallback for unknown model', () => {
    expect(resolveContextWindow({ model: 'unknown-model', contextWindow: null })).toBe(100_000);
  });

  it('uses agent profile override when present and > 0', () => {
    expect(resolveContextWindow({ model: 'claude-opus-4-7', contextWindow: 150_000 })).toBe(150_000);
  });

  it('treats contextWindow=0 as no override (falls back to hardcoded)', () => {
    expect(resolveContextWindow({ model: 'claude-opus-4-7', contextWindow: 0 })).toBe(200_000);
  });

  it('accepts null profile with modelOverride', () => {
    expect(resolveContextWindow(null, 'claude-sonnet-4-6')).toBe(200_000);
  });

  it('falls back to llmProfileConfig.baseUrl-derived contextWindow when profile and model registry both miss', () => {
    const profile = { model: 'unknown-custom-model', contextWindow: null };
    const llmProfileConfig = {
      providerType: 'openai',
      baseUrl: 'https://custom.example.com/v1',
      apiKey: 'sk-test',
    };
    // buildModel for openai-custom returns contextWindow: 128_000 by default
    const window = resolveContextWindow(profile as any, undefined, llmProfileConfig as any);
    expect(window).toBe(128_000);
  });

  it('returns FALLBACK_CONTEXT_WINDOW when llmProfileConfig is undefined and registry misses', () => {
    const profile = { model: 'totally-unknown', contextWindow: null };
    const window = resolveContextWindow(profile as any, undefined, undefined);
    expect(window).toBe(100_000);
  });
});
