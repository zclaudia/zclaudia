import { beforeEach, describe, expect, it, vi } from 'vitest';
const { applySnapshotEvent, settleInvocation } = vi.hoisted(() => ({
  applySnapshotEvent: vi.fn(),
  settleInvocation: vi.fn(),
}));
vi.mock('../../../../domains/usage/recorder.js', () => ({
  getUsageRecorder: () => ({ applySnapshotEvent, settleInvocation }),
}));

import { RunDomainEventListenerRegistry } from '../run-domain-event-listeners.js';

/** Minimal db stub: terminal run events persist last_run_status. */
const stubDb = () =>
  ({ prepare: () => ({ run: () => {}, get: () => undefined, all: () => [] }) }) as any;
const sendMessageMock = vi.fn();
const broadcastToOtherAuthenticatedClientsMock = vi.fn();
const upsertAssistantMessageMock = vi.fn();
const postRunCompletedNotificationMock = vi.fn();

vi.mock('../../transport/broadcast.js', () => ({
  sendMessage: sendMessageMock,
  broadcastToOtherAuthenticatedClients: broadcastToOtherAuthenticatedClientsMock,
}));

vi.mock('../run-lifecycle.js', () => ({
  upsertAssistantMessage: upsertAssistantMessageMock,
}));

vi.mock('../run-terminal-notifications.js', () => ({
  postRunCompletedNotification: postRunCompletedNotificationMock,
}));

vi.mock('../../agent/permission-evaluator.js', () => ({
  loadSessionRememberedDecisions: vi.fn(() => new Map()),
  loadProjectAllowedOutsideWorkspaceRoots: vi.fn(() => new Set()),
}));

async function flushPromises(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('background follow-up consumer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists late cumulative usage even without a follow-up UI message', async () => {
    const snapshot = { final: true, revision: 2 };
    const iterator = (async function* () {
      yield { type: 'provider_usage_updated', snapshot } as any;
    })();
    const { spawnBackgroundFollowUpConsumer } = await import('../background-follow-up.js');
    spawnBackgroundFollowUpConsumer(iterator, {
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: {} as any,
      connectedClients: new Map(),
      db: stubDb(),
      sessionId: 'session-1',
      projectId: 'project-1',
      providerType: 'claude',
      providerRegistry: {} as any,
      notificationService: {} as any,
      initialPendingTasks: 0,
      workspaceRoot: '/repo',
      usageInvocationId: 'original',
    });
    await vi.waitFor(() =>
      expect(settleInvocation).toHaveBeenCalledWith({
        invocationId: 'original',
        executionState: 'completed',
      })
    );
    expect(applySnapshotEvent).toHaveBeenCalledWith('original', snapshot);
  });

  it('emits backgroundFollowup started and finished domain events', async () => {
    const listeners = new RunDomainEventListenerRegistry();
    const startedListener = vi.fn();
    const finishedListener = vi.fn();
    listeners.on('backgroundFollowup.started', startedListener);
    listeners.on('backgroundFollowup.finished', finishedListener);
    const iterator = (async function* () {
      yield { type: 'assistant', content: 'background done' } as any;
      yield { type: 'result', content: 'background done' } as any;
    })();
    const activeRuns = new Map();
    const { spawnBackgroundFollowUpConsumer } = await import('../background-follow-up.js');

    spawnBackgroundFollowUpConsumer(iterator, {
      activeRuns,
      broadcastHeartbeat: vi.fn(),
      client: { id: 'client-1', ws: {} } as any,
      connectedClients: new Map(),
      db: stubDb(),
      sessionId: 'session-1',
      projectId: 'project-1',
      providerType: 'zclaudia',
      providerRegistry: { getPolicy: vi.fn(() => undefined) } as any,
      notificationService: { notify: vi.fn() } as any,
      initialPendingTasks: 0,
      workspaceRoot: '/repo',
      listeners,
    });

    await vi.waitFor(() => {
      expect(finishedListener).toHaveBeenCalled();
    });
    await flushPromises();

    const startedEvent = startedListener.mock.calls[0][0];
    expect(startedListener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'backgroundFollowup.started',
        runId: startedEvent.runId,
        sessionId: 'session-1',
        payload: { followupRunId: startedEvent.runId },
      })
    );
    expect(finishedListener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'backgroundFollowup.finished',
        runId: startedEvent.runId,
        sessionId: 'session-1',
        payload: { followupRunId: startedEvent.runId },
      })
    );
    expect(activeRuns.size).toBe(0);
  });
});
