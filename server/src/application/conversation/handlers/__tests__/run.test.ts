// server/src/application/conversation/handlers/__tests__/run.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleRunSteer } from '../run.js';
import type { ActiveRun } from '../../transport/types.js';

function makeClient() {
  const sent: unknown[] = [];
  return {
    sent,
    client: {
      ws: {
        readyState: 1,
        send: (msg: string) => { sent.push(JSON.parse(msg)); },
      },
    } as never,
  };
}

describe('handleRunSteer', () => {
  let activeRuns: Map<string, ActiveRun>;
  let broadcastMock: ReturnType<typeof vi.fn>;
  let steerSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    broadcastMock = vi.fn();
    steerSpy = vi.fn();
    activeRuns = new Map();
  });

  it('forwards content to steerHandle, pushes pendingSteers, broadcasts message_appended', async () => {
    const { client, sent } = makeClient();
    activeRuns.set('r1', {
      runId: 'r1',
      sessionId: 's1',
      completed: false,
      steerHandle: { steer: steerSpy },
      pendingSteers: [],
    } as never);
    await handleRunSteer(
      client,
      { type: 'run_steer', runId: 'r1', content: '  also fix typo  ' },
      activeRuns,
      broadcastMock,
    );
    expect(steerSpy).toHaveBeenCalledWith(expect.objectContaining({
      role: 'user',
      content: [{ type: 'text', text: 'also fix typo' }],
      timestamp: expect.any(Number),
    }));
    expect(activeRuns.get('r1')!.pendingSteers).toHaveLength(1);
    expect(broadcastMock).toHaveBeenCalledWith(
      activeRuns.get('r1'),
      expect.objectContaining({
        type: 'message_appended',
        sessionId: 's1',
        runId: 'r1',
        role: 'user',
        content: 'also fix typo',
        steered: true,
      }),
    );
    expect(sent).toHaveLength(0);
  });

  it('rejects empty content', async () => {
    const { client, sent } = makeClient();
    activeRuns.set('r1', {
      runId: 'r1',
      sessionId: 's1',
      completed: false,
      steerHandle: { steer: steerSpy },
      pendingSteers: [],
    } as never);
    await handleRunSteer(
      client,
      { type: 'run_steer', runId: 'r1', content: '   ' },
      activeRuns,
      broadcastMock,
    );
    expect(steerSpy).not.toHaveBeenCalled();
    expect(broadcastMock).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({ type: 'error', code: 'STEER_EMPTY' });
  });

  it('rejects unknown runId', async () => {
    const { client, sent } = makeClient();
    await handleRunSteer(
      client,
      { type: 'run_steer', runId: 'r-nope', content: 'x' },
      activeRuns,
      broadcastMock,
    );
    expect(steerSpy).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({ type: 'error', code: 'STEER_NO_ACTIVE_RUN' });
  });

  it('rejects when steerHandle not yet registered', async () => {
    const { client, sent } = makeClient();
    activeRuns.set('r1', {
      runId: 'r1',
      sessionId: 's1',
      completed: false,
      pendingSteers: [],
    } as never);
    await handleRunSteer(
      client,
      { type: 'run_steer', runId: 'r1', content: 'x' },
      activeRuns,
      broadcastMock,
    );
    expect(steerSpy).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({ type: 'error', code: 'STEER_NOT_READY' });
  });

  it('rejects when run is already completed', async () => {
    const { client, sent } = makeClient();
    activeRuns.set('r1', {
      runId: 'r1',
      sessionId: 's1',
      completed: true,
      steerHandle: { steer: steerSpy },
      pendingSteers: [],
    } as never);
    await handleRunSteer(
      client,
      { type: 'run_steer', runId: 'r1', content: 'x' },
      activeRuns,
      broadcastMock,
    );
    expect(steerSpy).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({ type: 'error', code: 'STEER_NO_ACTIVE_RUN' });
  });
});
