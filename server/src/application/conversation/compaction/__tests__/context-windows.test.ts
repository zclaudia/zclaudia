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
});
