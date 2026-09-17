import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { buildPiInvocationSnapshot } from '../usage-snapshot.js';

const call = (usage?: Record<string, number>): AgentMessage =>
  ({ role: 'assistant', model: 'm', usage }) as AgentMessage;

describe('Pi usage evidence', () => {
  it('derives a total from complete classifications when totalTokens is absent', () => {
    const result = buildPiInvocationSnapshot(
      [call({ input: 10, cacheRead: 20, cacheWrite: 0, output: 5 })],
      { errored: false }
    );
    expect(result.tokens.total).toBe(35);
    expect(result.status).toBe('complete');
  });
  it('distinguishes observed zero, empty usage, and failed placeholder counters', () => {
    const zero = call({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, totalTokens: 0 });
    expect(buildPiInvocationSnapshot([zero], { errored: false })).toMatchObject({
      status: 'complete',
      tokens: { total: 0 },
    });
    expect(buildPiInvocationSnapshot([call({})], { errored: false }).status).toBe('missing');
    expect(buildPiInvocationSnapshot([zero], { errored: true }).status).toBe('missing');
  });
  it('keeps known consumption partial when another call has no usage', () => {
    const result = buildPiInvocationSnapshot([call({ totalTokens: 50 }), call()], {
      errored: false,
    });
    expect(result.status).toBe('partial');
    expect(result.tokens.total).toBe(50);
    expect(result.tokens.output).toBeNull();
  });
  it('does not count the same assistant object twice', () => {
    const message = call({ totalTokens: 50 });
    expect(buildPiInvocationSnapshot([message, message], { errored: false }).tokens.total).toBe(50);
  });
});
