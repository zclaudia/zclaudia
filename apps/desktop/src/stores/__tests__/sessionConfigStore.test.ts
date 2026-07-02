import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionConfigStore } from '../sessionConfigStore';

const reset = () =>
  useSessionConfigStore.setState({
    systemInfoBySession: {},
    modeBySession: {},
    runtimeModes: {},
    sessionUsage: {},
    compactionNotice: {},
  });

describe('sessionConfigStore', () => {
  beforeEach(reset);

  it('mode getter returns empty string by default', () => {
    expect(useSessionConfigStore.getState().getMode('s1')).toBe('');
    useSessionConfigStore.getState().setMode('s1', 'plan');
    expect(useSessionConfigStore.getState().getMode('s1')).toBe('plan');
  });

  it('runtime mode set/get/clear', () => {
    useSessionConfigStore.getState().setRuntimeMode('s1', 'plan');
    expect(useSessionConfigStore.getState().getRuntimeMode('s1')).toBe('plan');
    useSessionConfigStore.getState().clearRuntimeMode('s1');
    expect(useSessionConfigStore.getState().getRuntimeMode('s1')).toBe('');
  });

  it('accumulates session usage', () => {
    useSessionConfigStore
      .getState()
      .addSessionUsage('s1', { input: 10, output: 5, cacheRead: 1, cacheWrite: 2 } as never);
    useSessionConfigStore.getState().addSessionUsage('s1', { input: 3, output: 2 } as never);
    const u = useSessionConfigStore.getState().sessionUsage.s1;
    expect(u.inputTokens).toBe(13);
    expect(u.outputTokens).toBe(7);
    expect(u.latestInputTokens).toBe(3);
  });

  it('stores the real context occupancy when provided by the runtime', () => {
    useSessionConfigStore.getState().addSessionUsage('s1', {
      input: 100,
      output: 5,
      cacheRead: 900,
      cacheWrite: 0,
      contextUsedTokens: 32_900,
    } as never);
    const u = useSessionConfigStore.getState().sessionUsage.s1;
    expect(u.contextUsedTokens).toBe(32_900);
  });

  it('setSystemInfo syncs contextWindow into usage (intra-store)', () => {
    useSessionConfigStore.getState().setSystemInfo('s1', { contextWindow: 200000 } as never);
    expect(useSessionConfigStore.getState().sessionUsage.s1.contextWindow).toBe(200000);
    expect(useSessionConfigStore.getState().getSystemInfo('s1')).toEqual({ contextWindow: 200000 });
  });

  it('compaction notice set/clear', () => {
    useSessionConfigStore.getState().setCompactionNotice('s1', {
      sessionId: 's1',
      reason: 'overflow',
      breakerOpen: false,
      receivedAt: 1,
    });
    expect(useSessionConfigStore.getState().compactionNotice.s1?.reason).toBe('overflow');
    useSessionConfigStore.getState().clearCompactionNotice('s1');
    expect(useSessionConfigStore.getState().compactionNotice.s1).toBeUndefined();
  });
});
