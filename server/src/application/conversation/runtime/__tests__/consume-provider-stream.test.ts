import { describe, expect, it, vi } from 'vitest';
import { PhaseEmitter } from '../active-run-phase.js';

const handleProviderEventMock = vi.fn();
const failProviderTurnMock = vi.fn();

vi.mock('../run-events.js', () => ({
  handleProviderEvent: handleProviderEventMock,
}));

vi.mock('../run-terminal-coordinator.js', () => ({
  failProviderTurn: failProviderTurnMock,
}));

describe('consumeProviderStream', () => {
  it('stops reading once a terminal provider event marks the run completed', async () => {
    const firstMessage = { type: 'result', content: 'done' };
    let nextCallCount = 0;

    const providerRunner: AsyncIterable<any> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            nextCallCount += 1;
            if (nextCallCount === 1) {
              return Promise.resolve({ value: firstMessage, done: false });
            }
            return new Promise(() => {});
          },
        };
      },
    };

    handleProviderEventMock.mockImplementation(
      ({ activeRun }: { activeRun: { phase: string } }) => {
        activeRun.phase = 'completed';
      }
    );

    const { consumeProviderStream } = await import('../consume-provider-stream.js');

    const activeRun = {
      phase: 'running',
      phaseEmitter: new PhaseEmitter(),
      lastActivityAt: 0,
      db: {},
    } as any;

    await Promise.race([
      consumeProviderStream({
        activeRun,
        activeRuns: new Map([['run-1', activeRun]]),
        broadcastHeartbeat: vi.fn(),
        client: {} as any,
        cwd: '/tmp',
        db: {} as any,
        input: 'hello',
        modeValue: 'default',
        notificationService: {} as any,
        notificationsService: undefined,
        persistSessionWorkingDirectory: vi.fn(),
        providerRunner,
        providerRegistry: {} as any,
        providerType: 'claude',
        runId: 'run-1',
        sendRunEvent: vi.fn(),
        sessionId: 'session-1',
        sessionType: 'regular',
        state: {},
        toolUseIdToName: new Map(),
        trace: { log: vi.fn(), setMeta: vi.fn() } as any,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('consumeProviderStream did not settle')), 100)
      ),
    ]);

    expect(handleProviderEventMock).toHaveBeenCalledTimes(1);
    expect(['completed', 'failed', 'cancelled']).toContain(activeRun.phase);
    expect(nextCallCount).toBe(1);
    expect(failProviderTurnMock).not.toHaveBeenCalled();
  });

  it('fails a run when the provider stream ends without a terminal event', async () => {
    const providerRunner: AsyncIterable<any> = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'assistant_delta', content: 'partial' };
      },
    };
    handleProviderEventMock.mockImplementation(() => {});

    const { consumeProviderStream } = await import('../consume-provider-stream.js');
    const activeRun = {
      phase: 'running',
      phaseEmitter: new PhaseEmitter(),
      lastActivityAt: 0,
      db: {},
    } as any;
    const activeRuns = new Map([['run-1', activeRun]]);
    const traceLog = vi.fn();

    await consumeProviderStream({
      activeRun,
      activeRuns,
      broadcastHeartbeat: vi.fn(),
      client: {} as any,
      cwd: '/tmp',
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      notificationService: {} as any,
      notificationsService: undefined,
      persistSessionWorkingDirectory: vi.fn(),
      providerRunner,
      providerRegistry: {} as any,
      providerType: 'claude',
      runId: 'run-1',
      sendRunEvent: vi.fn(),
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
      toolUseIdToName: new Map(),
      trace: { log: traceLog, setMeta: vi.fn() } as any,
    });

    expect(failProviderTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeRun,
        activeRuns,
        errorCode: 'STREAM_ENDED',
        errorMessage: 'Provider stream ended without a terminal event.',
      })
    );
    expect(traceLog).toHaveBeenCalledWith(
      'server_norm',
      'stream_ended_without_terminal',
      { runId: 'run-1', providerType: 'claude' },
      'Provider stream ended without a terminal event.'
    );
  });
});
