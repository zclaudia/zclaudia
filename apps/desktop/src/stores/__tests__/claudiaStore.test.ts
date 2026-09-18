import { beforeEach, describe, expect, it } from 'vitest';
import { useClaudiaStore } from '../claudiaStore';

function resetStore() {
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: globalThis.localStorage },
    configurable: true,
    writable: true,
  });
  localStorage.clear();
  useClaudiaStore.setState({ slices: {}, isExpanded: false, lastViewedAt: 0 });
}

describe('claudiaStore (P0 backend-keyed state)', () => {
  beforeEach(resetStore);

  it('scopes run lifecycle to a single backend slice', () => {
    const store = useClaudiaStore.getState();
    store.ensureSlice('backend-a');
    store.startRun('backend-a', {
      clientRequestId: 'req-1',
      input: 'hello',
      projectId: 'project-1',
      threadId: null,
      status: 'submitting',
      createdAt: 1,
      updatedAt: 1,
    });

    expect(useClaudiaStore.getState().slices['backend-a']?.runs).toHaveLength(1);
    expect(useClaudiaStore.getState().slices['backend-b']).toBeUndefined();
  });

  it('keeps accepted run identity and streams text only in the target backend', () => {
    const store = useClaudiaStore.getState();
    store.ensureSlice('backend-a');
    store.startRun('backend-a', {
      clientRequestId: 'req-1',
      input: 'hello',
      projectId: 'project-1',
      threadId: null,
      status: 'submitting',
      createdAt: 1,
      updatedAt: 1,
    });
    store.acceptRun('backend-a', 'req-1', {
      projectId: 'project-1',
      branchId: 'branch-1',
      sessionId: 'session-1',
      runId: 'run-1',
      agentProfileId: 'agent-1',
      agentProfileSource: 'explicit',
    });
    store.appendRunDelta('backend-a', 'req-1', 'Hello ');
    store.appendRunDelta('backend-a', 'req-1', 'world');

    const slice = useClaudiaStore.getState().slices['backend-a'];
    expect(slice?.runs[0]).toMatchObject({
      status: 'running',
      sessionId: 'session-1',
      runId: 'run-1',
      agentProfileSource: 'explicit',
    });
    expect(slice?.streamingText['req-1']).toBe('Hello world');

    store.completeRun('backend-a', 'req-1', 'Hello world', {
      sessionId: 'session-1',
      runId: 'run-1',
    });
    const settled = useClaudiaStore.getState().slices['backend-a'];
    expect(settled?.runs[0]).toMatchObject({ status: 'completed', responseText: 'Hello world' });
    expect(settled?.streamingText['req-1']).toBeUndefined();
  });

  it('isolates snapshots and late events between backends (acceptance scenario 10)', () => {
    const store = useClaudiaStore.getState();
    store.ensureSlice('backend-a');
    store.ensureSlice('backend-b');

    // Each backend's snapshot replaces only its own tasks.
    store.setTasks('backend-a', [
      {
        id: 'task-a',
        sessionId: 'session-a',
        branchId: null,
        input: 'a',
        title: 'Task A',
        status: 'running',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    store.setTasks('backend-b', [
      {
        id: 'task-b',
        sessionId: 'session-b',
        branchId: null,
        input: 'b',
        title: 'Task B',
        status: 'running',
        createdAt: 2,
        updatedAt: 2,
      },
    ]);

    store.updateTask('backend-a', 'task-a', { status: 'completed' });

    const a = useClaudiaStore.getState().slices['backend-a'];
    const b = useClaudiaStore.getState().slices['backend-b'];
    expect(a?.tasks).toHaveLength(1);
    expect(a?.tasks[0]).toMatchObject({ id: 'task-a', status: 'completed' });
    expect(b?.tasks).toHaveLength(1);
    expect(b?.tasks[0]).toMatchObject({ id: 'task-b', status: 'running' });
  });

  it('threads and transcript reads are project/session scoped inside a backend', () => {
    const store = useClaudiaStore.getState();
    store.ensureSlice('backend-a');
    store.setThreads('backend-a', 'project-1', [
      {
        id: 'branch-1',
        projectId: 'project-1',
        title: 'Fix login',
        createdAt: 1,
        updatedAt: 2,
        lastTaskId: null,
        session: {
          id: 'session-1',
          name: null,
          agentProfileId: 'agent-1',
          lastRunStatus: null,
          updatedAt: 2,
        },
      },
    ]);
    store.setActiveThread('backend-a', 'project-1', 'branch-1');
    store.setSessionMessages('backend-a', 'session-1', [
      { id: 'm-1', role: 'user', text: 'hi', createdAt: 1 },
    ]);

    const slice = useClaudiaStore.getState().slices['backend-a'];
    expect(slice?.activeThreadIdByProject['project-1']).toBe('branch-1');
    expect(slice?.threadsByProject['project-1']).toHaveLength(1);
    expect(slice?.messagesBySession['session-1']).toHaveLength(1);
    expect(slice?.threadsByProject['project-2']).toBeUndefined();
  });

  it('rejectRun keeps the run with its rejection reason', () => {
    const store = useClaudiaStore.getState();
    store.ensureSlice('backend-a');
    store.startRun('backend-a', {
      clientRequestId: 'req-1',
      input: 'hello',
      projectId: 'project-1',
      threadId: 'branch-1',
      status: 'submitting',
      createdAt: 1,
      updatedAt: 1,
    });
    store.rejectRun('backend-a', 'req-1', 'SESSION_BUSY', 'Session is busy', {
      sessionId: 'session-1',
      runId: 'run-live',
    });

    const run = useClaudiaStore.getState().slices['backend-a']?.runs[0];
    expect(run).toMatchObject({
      status: 'rejected',
      rejectCode: 'SESSION_BUSY',
      sessionId: 'session-1',
      runId: 'run-live',
    });
  });

  it('clears all backend slices on reset', () => {
    const store = useClaudiaStore.getState();
    store.ensureSlice('backend-a');
    store.ensureSlice('backend-b');
    useClaudiaStore.getState().reset();

    expect(useClaudiaStore.getState().slices).toEqual({});
  });
});

describe('Claudia acceptance reconciliation', () => {
  beforeEach(resetStore);

  it('materializes the first conversation so subsequent messages reuse its session', () => {
    const store = useClaudiaStore.getState();
    store.startRun('a', {
      clientRequestId: 'r',
      input: 'hello',
      projectId: 'p',
      threadId: null,
      status: 'submitting',
      createdAt: 1,
      updatedAt: 1,
    });
    store.acceptRun('a', 'r', {
      projectId: 'p',
      branchId: 'b',
      sessionId: 's',
      runId: 'run',
      agentProfileId: 'agent',
    });
    const slice = useClaudiaStore.getState().slices.a;
    expect(slice.activeThreadIdByProject.p).toBe('b');
    expect(slice.threadsByProject.p[0]).toMatchObject({
      id: 'b',
      session: { id: 's', agentProfileId: 'agent' },
    });
  });

  it('does not resurrect a completed run when its accepted receipt is replayed', () => {
    const store = useClaudiaStore.getState();
    store.startRun('a', {
      clientRequestId: 'r',
      input: 'hello',
      projectId: 'p',
      threadId: null,
      status: 'submitting',
      createdAt: 1,
      updatedAt: 1,
    });
    const identity = { projectId: 'p', branchId: 'b', sessionId: 's', runId: 'run' };
    store.acceptRun('a', 'r', identity);
    store.completeRun('a', 'r', 'done');
    store.acceptRun('a', 'r', { ...identity, replay: true });
    expect(useClaudiaStore.getState().slices.a.runs[0].status).toBe('completed');
  });
  it('keeps a newly accepted thread when an older thread snapshot arrives', () => {
    const store = useClaudiaStore.getState();
    const requestedAt = Date.now();
    store.startRun('backend-a', {
      clientRequestId: 'req',
      input: 'hello',
      projectId: 'p',
      threadId: null,
      status: 'submitting',
      createdAt: requestedAt,
      updatedAt: requestedAt,
    });
    store.acceptRun('backend-a', 'req', {
      projectId: 'p',
      branchId: 'thread',
      sessionId: 'session',
      runId: 'run',
    });
    store.setThreads('backend-a', 'p', [], requestedAt);
    expect(useClaudiaStore.getState().slices['backend-a'].threadsByProject.p[0].id).toBe('thread');
  });

  it('does not let an older snapshot overwrite a newer streaming delta or replay it twice', () => {
    const store = useClaudiaStore.getState();
    store.startRun('backend-a', {
      clientRequestId: 'req',
      input: '',
      projectId: 'p',
      threadId: 'thread',
      sessionId: 'session',
      runId: 'run',
      status: 'running',
      createdAt: 1,
      updatedAt: 1,
    });
    store.applyRunSnapshot('backend-a', 'run', 'Hello', 2);
    store.appendRunDelta('backend-a', 'req', ' world', 3);
    store.applyRunSnapshot('backend-a', 'run', 'Hello', 2);
    store.appendRunDelta('backend-a', 'req', ' world', 3);
    expect(useClaudiaStore.getState().slices['backend-a'].streamingText.req).toBe('Hello world');
  });
});
