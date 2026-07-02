import { beforeEach, describe, expect, it } from 'vitest';
import {
  captureContextSnapshot,
  clearContextSnapshots,
  computeContextUsage,
  estimateTokens,
  getContextSnapshot,
  recordContextUsage,
} from '../context-snapshot.js';

const baseCapture = {
  sessionId: 's1',
  model: 'claude-sonnet-4-6',
  contextWindow: 200_000,
  contextWindowSource: 'pi_ai_registry' as const,
  // 400 chars → 100 tokens
  systemPromptText: 'a'.repeat(400),
  // 80 chars → 20 tokens
  skillCatalogText: 'b'.repeat(80),
  tools: [
    // name(4) + description(36) = 40 chars → 10 tokens
    { name: 'Read', description: 'c'.repeat(36) },
    // name(4) + description(16) + JSON.stringify(parameters)(17 chars) = 37 chars → 10 tokens
    { name: 'Bash', description: 'd'.repeat(16), parameters: { type: 'object' } },
  ],
};

describe('estimateTokens', () => {
  it('estimates ceil(chars / 4) and returns 0 for empty text', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('context snapshot store', () => {
  beforeEach(() => {
    clearContextSnapshots();
  });

  it('captures a snapshot with chars/4 estimates per category', () => {
    captureContextSnapshot(baseCapture);
    const snap = getContextSnapshot('s1');
    expect(snap).toMatchObject({
      sessionId: 's1',
      model: 'claude-sonnet-4-6',
      contextWindow: 200_000,
      contextWindowSource: 'pi_ai_registry',
      systemPromptTokens: 100,
      skillCatalogTokens: 20,
      toolTokens: 20,
      toolCount: 2,
    });
    expect(snap?.lastUsage).toBeUndefined();
  });

  it('returns undefined for unknown sessions', () => {
    expect(getContextSnapshot('nope')).toBeUndefined();
  });

  it('recordContextUsage backfills lastUsage and is a no-op for unknown sessions', () => {
    recordContextUsage('nope', { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 });
    expect(getContextSnapshot('nope')).toBeUndefined();

    captureContextSnapshot(baseCapture);
    recordContextUsage('s1', { input: 500, output: 80, cacheRead: 4500, cacheWrite: 0 });
    expect(getContextSnapshot('s1')?.lastUsage).toEqual({
      input: 500,
      output: 80,
      cacheRead: 4500,
      cacheWrite: 0,
    });
  });

  it('re-capture preserves the previous lastUsage (mid-run query keeps last real occupancy)', () => {
    captureContextSnapshot(baseCapture);
    recordContextUsage('s1', { input: 500, output: 80, cacheRead: 4500, cacheWrite: 0 });
    captureContextSnapshot({ ...baseCapture, systemPromptText: 'a'.repeat(800) });
    const snap = getContextSnapshot('s1');
    expect(snap?.systemPromptTokens).toBe(200);
    expect(snap?.lastUsage).toEqual({ input: 500, output: 80, cacheRead: 4500, cacheWrite: 0 });
  });
});

describe('computeContextUsage', () => {
  beforeEach(() => {
    clearContextSnapshots();
  });

  it('with real usage: usedTokens = input + cacheRead, messages = residual', () => {
    captureContextSnapshot(baseCapture);
    recordContextUsage('s1', { input: 500, output: 80, cacheRead: 4500, cacheWrite: 0 });
    const payload = computeContextUsage(getContextSnapshot('s1')!);
    expect(payload.usedTokens).toBe(5000);
    expect(payload.usedTokensFromUsage).toBe(true);
    // residual = 5000 − (100 + 20 + 20) = 4860
    expect(payload.breakdown.messages).toEqual({ tokens: 4860, estimated: true, clamped: false });
    expect(payload.breakdown.systemPrompt).toEqual({ tokens: 100, estimated: true });
    expect(payload.breakdown.tools).toEqual({ tokens: 20, estimated: true, count: 2 });
    expect(payload.breakdown.skills).toEqual({ tokens: 20, estimated: true });
    expect(payload.breakdown.freeSpace.tokens).toBe(195_000);
    expect(payload.breakdown.freeSpace.percent).toBe(97.5);
  });

  it('without usage: usedTokens falls back to the estimate sum, messages = 0', () => {
    captureContextSnapshot(baseCapture);
    const payload = computeContextUsage(getContextSnapshot('s1')!);
    expect(payload.usedTokens).toBe(140);
    expect(payload.usedTokensFromUsage).toBe(false);
    expect(payload.breakdown.messages).toEqual({ tokens: 0, estimated: true, clamped: false });
  });

  it('clamps a negative residual to 0 and flags it', () => {
    captureContextSnapshot(baseCapture);
    // real usage (100) below the estimate sum (140) → raw residual −40
    recordContextUsage('s1', { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 });
    const payload = computeContextUsage(getContextSnapshot('s1')!);
    expect(payload.usedTokens).toBe(100);
    expect(payload.breakdown.messages).toEqual({ tokens: 0, estimated: true, clamped: true });
  });
});
