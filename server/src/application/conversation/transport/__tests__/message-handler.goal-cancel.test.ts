import { describe, it, expect, vi } from 'vitest';
import { handleClientMessage } from '../message-handler.js';

function baseCtx(over: Record<string, unknown> = {}) {
  return {
    activeRuns: new Map([['r1', { sessionId: 's1', phase: 'running' }]]),
    connectedClients: new Map(),
    processMonitor: null,
    handleRunStart: vi.fn(),
    cancelRun: vi.fn(),
    broadcastPluginState: vi.fn(),
    findProcessPidsByTaskCommand: vi.fn(),
    pauseActiveGoalForSession: vi.fn(),
    ...over,
  } as any;
}

describe('run_cancel pauses the active goal', () => {
  it('cancels the run and pauses the goal for that session', async () => {
    const ctx = baseCtx();
    const client = { id: 'c1' } as any;
    const clients = new Map() as any;

    await handleClientMessage(
      client,
      { type: 'run_cancel', runId: 'r1' } as any,
      {} as any,
      clients,
      ctx
    );

    expect(ctx.cancelRun).toHaveBeenCalledWith('r1');
    expect(ctx.pauseActiveGoalForSession).toHaveBeenCalledWith('s1');
  });

  it('does not pause the goal when the run is already in a terminal phase', async () => {
    const ctx = baseCtx({ activeRuns: new Map([['r1', { sessionId: 's1', phase: 'completed' }]]) });
    const client = { id: 'c1' } as any;
    const clients = new Map() as any;

    await handleClientMessage(
      client,
      { type: 'run_cancel', runId: 'r1' } as any,
      {} as any,
      clients,
      ctx
    );

    expect(ctx.cancelRun).toHaveBeenCalledWith('r1');
    expect(ctx.pauseActiveGoalForSession).not.toHaveBeenCalled();
  });

  it('does not pause the goal when the run is not in activeRuns', async () => {
    const ctx = baseCtx({ activeRuns: new Map() });
    const client = { id: 'c1' } as any;
    const clients = new Map() as any;

    await handleClientMessage(
      client,
      { type: 'run_cancel', runId: 'r1' } as any,
      {} as any,
      clients,
      ctx
    );

    expect(ctx.cancelRun).toHaveBeenCalledWith('r1');
    expect(ctx.pauseActiveGoalForSession).not.toHaveBeenCalled();
  });

  it('does not throw when pauseActiveGoalForSession is absent on the context', async () => {
    const ctx = baseCtx({ pauseActiveGoalForSession: undefined });
    const client = { id: 'c1' } as any;
    const clients = new Map() as any;

    await expect(
      handleClientMessage(
        client,
        { type: 'run_cancel', runId: 'r1' } as any,
        {} as any,
        clients,
        ctx
      )
    ).resolves.not.toThrow();

    expect(ctx.cancelRun).toHaveBeenCalledWith('r1');
  });
});
