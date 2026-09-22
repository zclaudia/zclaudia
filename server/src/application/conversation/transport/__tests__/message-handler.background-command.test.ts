import { describe, it, expect, vi } from 'vitest';
import { handleClientMessage } from '../message-handler.js';

function makeClient() {
  const send = vi.fn();
  return { client: { id: 'c1', ws: { readyState: 1, send } } as any, send };
}

function sentMessages(send: ReturnType<typeof vi.fn>) {
  return send.mock.calls.map(([raw]) => JSON.parse(raw as string));
}

function baseCtx(over: Record<string, unknown> = {}) {
  return {
    activeRuns: new Map([['r1', { sessionId: 's1', phase: 'running', providerType: 'pi' }]]),
    connectedClients: new Map(),
    processMonitor: null,
    handleRunStart: vi.fn(),
    cancelRun: vi.fn(),
    broadcastPluginState: vi.fn(),
    findProcessPidsByTaskCommand: vi.fn(),
    ...over,
  } as any;
}

async function send(ctx: unknown, client: unknown, toolUseId = 't1') {
  await handleClientMessage(
    client as never,
    { type: 'background_running_command', sessionId: 's1', toolUseId } as any,
    {} as any,
    new Map() as any,
    ctx as never
  );
}

describe('background_running_command routes through the session runtime adapter', () => {
  it('delegates to the adapter that owns the running command', async () => {
    const requestBackgroundForToolCall = vi.fn(() => ({ ok: true, command: 'sleep 30' }));
    const ctx = baseCtx({
      providerRegistry: {
        get: (type: string) => (type === 'pi' ? { requestBackgroundForToolCall } : undefined),
      },
    });
    const { client, send: wsSend } = makeClient();

    await send(ctx, client);

    expect(requestBackgroundForToolCall).toHaveBeenCalledWith('s1', 't1');
    expect(sentMessages(wsSend)).toEqual([]);
  });

  it('reports NO_INFLIGHT_COMMAND when the adapter cannot find the command', async () => {
    const ctx = baseCtx({
      providerRegistry: {
        get: () => ({ requestBackgroundForToolCall: () => ({ ok: false, reason: 'gone' }) }),
      },
    });
    const { client, send: wsSend } = makeClient();

    await send(ctx, client);

    expect(sentMessages(wsSend)).toEqual([
      { type: 'error', code: 'NO_INFLIGHT_COMMAND', message: 'gone' },
    ]);
  });

  it('degrades to BACKGROUND_UNSUPPORTED for runtimes without the port (claude/codex/cursor)', async () => {
    const ctx = baseCtx({
      activeRuns: new Map([['r1', { sessionId: 's1', phase: 'running', providerType: 'claude' }]]),
      providerRegistry: { get: () => ({ type: 'claude' }) },
    });
    const { client, send: wsSend } = makeClient();

    await send(ctx, client);

    expect(sentMessages(wsSend)).toEqual([
      expect.objectContaining({ type: 'error', code: 'BACKGROUND_UNSUPPORTED' }),
    ]);
  });

  it('reports NO_INFLIGHT_COMMAND when the session has no live run', async () => {
    const requestBackgroundForToolCall = vi.fn();
    const ctx = baseCtx({
      activeRuns: new Map([['r1', { sessionId: 's1', phase: 'completed', providerType: 'pi' }]]),
      providerRegistry: { get: () => ({ requestBackgroundForToolCall }) },
    });
    const { client, send: wsSend } = makeClient();

    await send(ctx, client);

    expect(requestBackgroundForToolCall).not.toHaveBeenCalled();
    expect(sentMessages(wsSend)).toEqual([
      expect.objectContaining({ type: 'error', code: 'NO_INFLIGHT_COMMAND' }),
    ]);
  });
});
