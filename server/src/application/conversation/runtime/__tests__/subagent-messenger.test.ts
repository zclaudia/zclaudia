import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ActiveRun } from '../../transport/types.js';
import {
  __resetPendingTaskNoticesForTests,
  drainPendingTaskNotices,
} from '../pending-task-notices.js';
import { createSubagentMessenger, findActiveRunForSession } from '../subagent-messenger.js';

function fakeRun(overrides: Partial<ActiveRun> = {}): ActiveRun {
  return {
    runId: 'run-1',
    sessionId: 'child-session',
    phase: 'running',
    pendingSteers: [],
    steerHandle: { steer: vi.fn() },
    broadcast: vi.fn(),
    db: undefined,
    ...overrides,
  } as unknown as ActiveRun;
}

describe('subagent messenger', () => {
  afterEach(() => __resetPendingTaskNoticesForTests());

  it('finds only non-terminal runs for a session', () => {
    const done = fakeRun({ runId: 'r-done', phase: 'completed' });
    const live = fakeRun({ runId: 'r-live' });
    const activeRuns = new Map<string, ActiveRun>([
      ['r-done', done],
      ['r-live', live],
    ]);
    expect(findActiveRunForSession(activeRuns, 'child-session')).toBe(live);
    expect(findActiveRunForSession(activeRuns, 'other')).toBeUndefined();
  });

  it('steer pushes a user message into the live run, tracks it, and broadcasts it', () => {
    const run = fakeRun();
    const messenger = createSubagentMessenger({
      activeRuns: new Map([['run-1', run]]),
    });

    expect(messenger.steer('child-session', '  do the thing  ')).toEqual({ delivery: 'steered' });

    const steer = run.steerHandle!.steer as ReturnType<typeof vi.fn>;
    expect(steer).toHaveBeenCalledTimes(1);
    const message = steer.mock.calls[0][0];
    expect(message.role).toBe('user');
    expect(message.content).toEqual([{ type: 'text', text: 'do the thing' }]);
    expect(run.pendingSteers).toHaveLength(1);
    expect(run.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'message_appended',
        sessionId: 'child-session',
        runId: 'run-1',
        role: 'user',
        content: 'do the thing',
        steered: true,
      })
    );
  });

  it('steer reports no_active_run and not_ready without touching state', () => {
    const notReady = fakeRun({ steerHandle: undefined });
    const messenger = createSubagentMessenger({
      activeRuns: new Map([['run-1', notReady]]),
    });
    expect(messenger.steer('child-session', 'hi')).toEqual({ delivery: 'not_ready' });
    expect(messenger.steer('missing', 'hi')).toEqual({ delivery: 'no_active_run' });
    expect(notReady.pendingSteers).toHaveLength(0);
  });

  it('keeps steer timestamps monotonic within a run', () => {
    const run = fakeRun({ lastSteerAt: Date.now() + 10_000 });
    const messenger = createSubagentMessenger({
      activeRuns: new Map([['run-1', run]]),
    });
    messenger.steer('child-session', 'a');
    const first = run.lastSteerAt!;
    messenger.steer('child-session', 'b');
    expect(run.lastSteerAt).toBe(first + 1);
  });

  it('notify steers a system notice when live and queues it otherwise', () => {
    const run = fakeRun({ sessionId: 'parent' });
    const messenger = createSubagentMessenger({
      activeRuns: new Map([['run-1', run]]),
    });
    expect(messenger.notify('parent', '<system-reminder>x</system-reminder>')).toEqual({
      delivery: 'steered',
    });
    // Notices are not persisted/broadcast as user messages.
    expect(run.pendingSteers).toHaveLength(0);
    expect(run.broadcast).not.toHaveBeenCalled();

    expect(messenger.notify('idle-parent', 'later')).toEqual({ delivery: 'queued' });
    expect(drainPendingTaskNotices('idle-parent')).toEqual(['later']);
  });

  it('notify falls back to the queue when the steer handle throws', () => {
    const run = fakeRun({
      sessionId: 'parent',
      steerHandle: {
        steer: () => {
          throw new Error('agent gone');
        },
      },
    });
    const messenger = createSubagentMessenger({
      activeRuns: new Map([['run-1', run]]),
    });
    expect(messenger.notify('parent', 'n')).toEqual({ delivery: 'queued' });
    expect(drainPendingTaskNotices('parent')).toEqual(['n']);
  });
});
