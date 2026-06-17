import { describe, expect, it, vi } from 'vitest';

function buildRun(overrides: Record<string, unknown> = {}): any {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    providerType: 'zclaudia',
    aiInitiatedPlanMode: false,
    originalMode: undefined,
    fullContent: '',
    contentBlocks: [],
    collectedToolCalls: [],
    recentToolCalls: [],
    pendingPermissions: new Map(),
    eventSeq: 0,
    ...overrides,
  };
}

describe('mode transition coordinator', () => {
  it('enters AI-initiated plan mode, emits mode_change, and syncs provider session mode', async () => {
    const setSessionMode = vi.fn();
    const sendRunEvent = vi.fn();
    const activeRun = buildRun({ providerType: 'zclaudia' });
    const { handleModeTransition } = await import('../mode-transition-coordinator.js');

    handleModeTransition({
      activeRun,
      modeValue: 'default',
      msg: {
        type: 'mode_transition',
        modeTransition: { mode: 'plan', reason: 'enter', sourceToolUseId: 'tool-1' },
      } as any,
      providerRegistry: { get: vi.fn(() => ({ setSessionMode })) } as any,
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent,
    });

    expect(sendRunEvent).toHaveBeenCalledWith({
      type: 'mode_change',
      runId: 'run-1',
      sessionId: 'session-1',
      mode: 'plan',
    });
    expect(activeRun.aiInitiatedPlanMode).toBe(true);
    expect(activeRun.originalMode).toBe('default');
    expect(setSessionMode).toHaveBeenCalledWith('session-1', 'plan');
  });

  it('exits AI-initiated plan mode and syncs provider session mode', async () => {
    const setSessionMode = vi.fn();
    const sendRunEvent = vi.fn();
    const activeRun = buildRun({
      aiInitiatedPlanMode: true,
      originalMode: 'default',
      providerType: 'zclaudia',
    });
    const { handleModeTransition } = await import('../mode-transition-coordinator.js');

    handleModeTransition({
      activeRun,
      modeValue: 'plan',
      msg: {
        type: 'mode_transition',
        modeTransition: { mode: 'default', reason: 'exit' },
      } as any,
      providerRegistry: { get: vi.fn(() => ({ setSessionMode })) } as any,
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent,
    });

    expect(sendRunEvent).toHaveBeenCalledWith({
      type: 'mode_change',
      runId: 'run-1',
      sessionId: 'session-1',
      mode: 'default',
    });
    expect(activeRun.aiInitiatedPlanMode).toBe(false);
    expect(setSessionMode).toHaveBeenCalledWith('session-1', 'default');
  });

  it('does nothing when provider event lacks a mode transition payload', async () => {
    const sendRunEvent = vi.fn();
    const activeRun = buildRun();
    const { handleModeTransition } = await import('../mode-transition-coordinator.js');

    handleModeTransition({
      activeRun,
      modeValue: 'default',
      msg: { type: 'mode_transition' } as any,
      providerRegistry: { get: vi.fn() } as any,
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent,
    });

    expect(sendRunEvent).not.toHaveBeenCalled();
    expect(activeRun.aiInitiatedPlanMode).toBe(false);
  });
});
