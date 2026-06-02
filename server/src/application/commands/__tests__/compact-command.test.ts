import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../registry.js';

const forceCompactMock = vi.fn();

vi.mock('../../conversation/compaction/compaction-service.js', () => ({
  forceCompact: (...args: unknown[]) => forceCompactMock(...args),
}));

// The handler is registered inside init.ts when the module is imported. Re-import
// in a fresh module isn't possible here because vitest caches; instead grab the
// handler off the registry after importing init.
const initImport = await import('../init.js');
initImport.ensureBuiltinCommandsRegistered();
const { commandRegistry } = await import('../registry.js');

function ctxWithDeps(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    sessionId: 's1',
    db: {} as CommandContext['db'],
    agentProfile: { id: 'ap1', model: 'm', llmProfileId: 'lp1' } as CommandContext['agentProfile'],
    llmProfile: { id: 'lp1', apiKey: 'k' } as CommandContext['llmProfile'],
    ...overrides,
  };
}

describe('/compact command handler', () => {
  beforeEach(() => {
    forceCompactMock.mockReset();
  });

  afterEach(() => {
    // sendEvent mocks scoped per-test
  });

  it('returns ok:false when sessionId is missing', async () => {
    const res = await commandRegistry.execute('/compact', [], {});
    expect(res.data?.ok).toBe(false);
    expect(String(res.data?.message)).toMatch(/missing session context/i);
    expect(forceCompactMock).not.toHaveBeenCalled();
  });

  it('returns ok:false when db / agentProfile / llmProfile are missing', async () => {
    const res = await commandRegistry.execute('/compact', [], { sessionId: 's1' });
    expect(res.data?.ok).toBe(false);
    expect(forceCompactMock).not.toHaveBeenCalled();
  });

  it('calls forceCompact with joined args as customInstructions when args present', async () => {
    forceCompactMock.mockResolvedValue({ compacted: true, compactionId: 'c1', tokensBefore: 9000 });
    const res = await commandRegistry.execute('/compact', ['focus', 'on', 'auth'], ctxWithDeps());
    expect(forceCompactMock).toHaveBeenCalledTimes(1);
    const callArg = forceCompactMock.mock.calls[0][0];
    expect(callArg.customInstructions).toBe('focus on auth');
    expect(callArg.source).toBe('manual');
    expect(res.data?.ok).toBe(true);
    expect(res.data?.compactionId).toBe('c1');
    expect(res.data?.tokensBefore).toBe(9000);
  });

  it('passes undefined customInstructions when args are empty/whitespace', async () => {
    forceCompactMock.mockResolvedValue({ compacted: true, compactionId: 'c2', tokensBefore: 1 });
    await commandRegistry.execute('/compact', ['  ', ''], ctxWithDeps());
    expect(forceCompactMock.mock.calls[0][0].customInstructions).toBeUndefined();
  });

  it('emits compaction_completed via sendEvent on success', async () => {
    forceCompactMock.mockResolvedValue({ compacted: true, compactionId: 'cX', tokensBefore: 4242 });
    const sendEvent = vi.fn();
    await commandRegistry.execute('/compact', [], ctxWithDeps({ sendEvent }));
    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect(sendEvent.mock.calls[0][0]).toEqual({
      type: 'compaction_completed',
      sessionId: 's1',
      compactionId: 'cX',
      tokensBefore: 4242,
    });
  });

  it('does NOT emit compaction_completed when forceCompact reports not compacted', async () => {
    forceCompactMock.mockResolvedValue({ compacted: false, reason: 'no_cut_point' });
    const sendEvent = vi.fn();
    const res = await commandRegistry.execute('/compact', [], ctxWithDeps({ sendEvent }));
    expect(sendEvent).not.toHaveBeenCalled();
    expect(res.data?.ok).toBe(false);
    expect(res.data?.reason).toBe('no_cut_point');
  });
});
