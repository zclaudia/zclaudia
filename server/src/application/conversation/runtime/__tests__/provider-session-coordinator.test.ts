import { describe, expect, it, vi } from 'vitest';

describe('provider session coordinator', () => {
  it('persists system info, cwd, sdk session id, and emits wire events on init', async () => {
    const runSql = vi.fn();
    const sendRunEvent = vi.fn();
    const persistSessionWorkingDirectory = vi.fn();
    const activeRun = {
      sessionId: 'session-1',
      latestSystemInfo: undefined,
      providerSessionId: undefined,
    } as any;
    const state: any = {};

    const { handleProviderInit } = await import('../provider-session-coordinator.js');

    handleProviderInit({
      activeRun,
      db: { prepare: vi.fn(() => ({ run: runSql })) } as any,
      msg: {
        type: 'init',
        sessionId: 'sdk-1',
        systemInfo: {
          model: 'sonnet',
          cwd: '/repo',
          contextWindow: 200000,
          contextWindowSource: 'profile',
          permissionMode: 'default',
          apiKeySource: 'env',
          tools: ['Read'],
          mcpServers: [],
          slashCommands: [],
          agents: [],
        },
      } as any,
      persistSessionWorkingDirectory,
      runId: 'run-1',
      sendRunEvent,
      sessionId: 'session-1',
      state,
    });

    expect(state.systemInfo).toEqual(expect.objectContaining({ cwd: '/repo', model: 'sonnet' }));
    expect(activeRun.latestSystemInfo).toEqual(expect.objectContaining({ cwd: '/repo', model: 'sonnet' }));
    expect(persistSessionWorkingDirectory).toHaveBeenCalledWith('/repo');
    expect(runSql).toHaveBeenCalledWith('sdk-1', expect.any(Number), 'session-1');
    expect(state.sdkSessionId).toBe('sdk-1');
    expect(activeRun.providerSessionId).toBe('sdk-1');
    expect(sendRunEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'system_info',
      runId: 'run-1',
      systemInfo: expect.objectContaining({
        model: 'sonnet',
        cwd: '/repo',
        contextWindow: 200000,
      }),
    }));
    expect(sendRunEvent).toHaveBeenCalledWith({
      type: 'session_created',
      sessionId: 'session-1',
      sdkSessionId: 'sdk-1',
    });
  });

  it('does not re-emit session_created when sdk session id is unchanged', async () => {
    const sendRunEvent = vi.fn();
    const runSql = vi.fn();
    const { handleProviderInit } = await import('../provider-session-coordinator.js');

    handleProviderInit({
      activeRun: { sessionId: 'session-1' } as any,
      db: { prepare: vi.fn(() => ({ run: runSql })) } as any,
      msg: { type: 'init', sessionId: 'sdk-1' } as any,
      persistSessionWorkingDirectory: vi.fn(),
      runId: 'run-1',
      sendRunEvent,
      sessionId: 'session-1',
      state: { sdkSessionId: 'sdk-1' },
    });

    expect(runSql).not.toHaveBeenCalled();
    expect(sendRunEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'session_created' }));
  });
});
