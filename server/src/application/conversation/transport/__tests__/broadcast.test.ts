import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApprovalInteractionMessage } from '@zclaudia/shared/interaction/forms';
import type { ActiveRun } from '../types.js';
import { interactionDispatcher } from '../../interactions/interaction-dispatcher.js';
import { buildStateHeartbeat } from '../broadcast.js';

describe('state heartbeat pending approvals', () => {
  beforeEach(() => {
    interactionDispatcher.setSendFunction(() => {});
    interactionDispatcher.cancelBySession('session-a');
    interactionDispatcher.cancelBySession('session-b');
  });

  afterEach(() => {
    interactionDispatcher.cancelBySession('session-a');
    interactionDispatcher.cancelBySession('session-b');
  });

  it('replays a real pending approval only with its active run and clears it after resolution', async () => {
    const event: ApprovalInteractionMessage = {
      type: 'interaction_approval',
      interactionId: 'approval-real-1',
      sessionId: 'session-b',
      source: 'tool_call',
      createdAt: 1,
      title: 'Approve action',
      message: 'Review action',
    };
    const run = {
      runId: 'run-b',
      sessionId: 'session-b',
      phase: 'running',
      startedAt: 1,
      lastActivityAt: 1,
      recentToolCalls: [],
      loopHeartbeatStreak: 0,
      pendingPermissions: new Map(),
      sessionType: 'regular',
    } as unknown as ActiveRun;
    const pending = interactionDispatcher.dispatchAndWait(
      event.interactionId,
      event.sessionId,
      event,
      null
    );

    expect(buildStateHeartbeat(new Map([['run-b', run]])).pendingApprovals).toEqual([
      { runId: 'run-b', interaction: event },
    ]);
    expect(
      buildStateHeartbeat(
        new Map([['run-a', { ...run, runId: 'run-a', sessionId: 'session-a' } as ActiveRun]])
      ).pendingApprovals
    ).toEqual([]);

    expect(interactionDispatcher.resolve(event.interactionId, { approved: true })).toBe(true);
    await expect(pending).resolves.toEqual({ approved: true });
    expect(buildStateHeartbeat(new Map([['run-b', run]])).pendingApprovals).toEqual([]);
  });

  it('binds approvals to exact sessions and omits ambiguous sessions instead of choosing a run', async () => {
    const eventA: ApprovalInteractionMessage = {
      type: 'interaction_approval',
      interactionId: 'approval-session-a',
      sessionId: 'session-a',
      source: 'tool_call',
      createdAt: 1,
      title: 'Approve A',
      message: 'A action',
    };
    const eventB: ApprovalInteractionMessage = {
      ...eventA,
      interactionId: 'approval-session-b',
      sessionId: 'session-b',
      title: 'Approve B',
      message: 'B action',
    };
    const makeRun = (runId: string, sessionId: string) =>
      ({
        runId,
        sessionId,
        phase: 'running',
        startedAt: 1,
        lastActivityAt: 1,
        recentToolCalls: [],
        loopHeartbeatStreak: 0,
        pendingPermissions: new Map(),
        sessionType: 'regular',
      }) as unknown as ActiveRun;
    const pendingA = interactionDispatcher.dispatchAndWait(
      eventA.interactionId,
      eventA.sessionId,
      eventA,
      null
    );
    const pendingB = interactionDispatcher.dispatchAndWait(
      eventB.interactionId,
      eventB.sessionId,
      eventB,
      null
    );

    expect(
      buildStateHeartbeat(
        new Map([
          ['run-a', makeRun('run-a', 'session-a')],
          ['run-b', makeRun('run-b', 'session-b')],
        ])
      ).pendingApprovals
    ).toEqual([
      { runId: 'run-a', interaction: eventA },
      { runId: 'run-b', interaction: eventB },
    ]);
    expect(
      buildStateHeartbeat(
        new Map([
          ['run-a', makeRun('run-a', 'session-a')],
          ['run-a-duplicate', makeRun('run-a-duplicate', 'session-a')],
          ['run-b', makeRun('run-b', 'session-b')],
        ])
      ).pendingApprovals
    ).toEqual([{ runId: 'run-b', interaction: eventB }]);

    interactionDispatcher.resolve(eventA.interactionId, { approved: true });
    interactionDispatcher.resolve(eventB.interactionId, { approved: true });
    await Promise.all([pendingA, pendingB]);
  });
});
