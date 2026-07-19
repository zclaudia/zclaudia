import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhaseEmitter } from '../active-run-phase.js';
import { RunDomainEventListenerRegistry } from '../run-domain-event-listeners.js';

const upsertAssistantMessageMock = vi.fn();
const cleanupPendingPermissionsMock = vi.fn();
const clearSessionMock = vi.fn();
const maybeCompactMock = vi.fn(async () => ({
  outcome: 'skipped',
  compacted: false,
  reason: 'below_threshold',
}));
const pluginEventsEmitMock = vi.fn(async () => {});

vi.mock('../run-lifecycle.js', () => ({
  cleanupPendingPermissions: cleanupPendingPermissionsMock,
  getSessionMessageVersion: vi.fn(() => 7),
  upsertAssistantMessage: upsertAssistantMessageMock,
}));

vi.mock('../../interactions/todo-state-tracker.js', () => ({
  clearSession: clearSessionMock,
  finalizeSession: vi.fn(() => []),
}));

vi.mock('../../compaction/compaction-service.js', () => ({
  maybeCompact: maybeCompactMock,
}));

vi.mock('../../../../infra/events/index.js', () => ({
  pluginEvents: {
    emit: pluginEventsEmitMock,
  },
}));

const providerRegistry = {
  getPolicy: vi.fn(() => undefined),
};

function buildRun(overrides: Record<string, unknown> = {}): any {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    assistantMessageId: 'assistant-1',
    providerType: 'zclaudia',
    collectedToolCalls: [],
    contentBlocks: [],
    fullContent: '',
    thinkingBlocks: [],
    pendingPermissions: new Map(),
    recentToolCalls: [],
    pendingBackgroundTasks: 0,
    phase: 'running',
    phaseEmitter: new PhaseEmitter(),
    ...overrides,
  };
}

describe('run terminal coordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertAssistantMessageMock.mockReturnValue(7);
  });

  it('persists, completes, emits plugin event, heartbeat, notification, and background update', async () => {
    const activeRun = buildRun({ sessionType: 'background' });
    const terminalSendPhases: string[] = [];
    const sendRunEvent = vi.fn(event => {
      if (event.type === 'run_completed') terminalSendPhases.push(activeRun.phase);
    });
    const broadcastHeartbeat = vi.fn();
    const notificationsService = { postItem: vi.fn() };
    const usage = {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const listeners = new RunDomainEventListenerRegistry();
    const runCompletedListener = vi.fn();
    listeners.on('run.completed', runCompletedListener);

    const { completeProviderTurn } = await import('../run-terminal-coordinator.js');

    completeProviderTurn({
      activeRun,
      broadcastHeartbeat,
      db: {} as any,
      input: 'hello',
      msg: { type: 'result', content: 'done', usage } as any,
      notificationService: { notify: vi.fn() } as any,
      notificationsService: notificationsService as any,
      providerRegistry: providerRegistry as any,
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent,
      sessionId: 'session-1',
      sessionType: 'background',
      state: {},
      listeners,
    });

    expect(activeRun.fullContent).toBe('done');
    expect(upsertAssistantMessageMock).toHaveBeenCalledWith(activeRun, {
      usage,
      indexMetadata: true,
    });
    expect(sendRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run_completed',
        runId: 'run-1',
        sessionId: 'session-1',
        usage,
      })
    );
    expect(activeRun.phase).toBe('completed');
    expect(terminalSendPhases).toEqual(['finalizing']);
    expect(runCompletedListener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run.completed',
        runId: 'run-1',
        sessionId: 'session-1',
        payload: {
          usage,
          assistantMessageId: 'assistant-1',
          messageVersion: 7,
          content: 'done',
          contentBlocks: [{ type: 'text', content: 'done' }],
        },
      })
    );
    expect(broadcastHeartbeat).toHaveBeenCalled();
    expect(notificationsService.postItem).toHaveBeenCalled();
    expect(sendRunEvent).toHaveBeenCalledWith({
      type: 'background_task_update',
      sessionId: 'session-1',
      status: 'completed',
    });
  });

  it('emits run_completed carrying the final accumulated content and blocks', async () => {
    // The live client accumulates the message purely from streamed deltas; the
    // terminal event must carry the authoritative final content so a lost tail
    // delta cannot leave the rendered message truncated until refresh.
    const activeRun = buildRun({
      fullContent: 'Full final text',
      contentBlocks: [
        { type: 'tool_use', toolUseId: 'tool-1' },
        { type: 'text', content: 'Full final text' },
      ],
    });
    const sendRunEvent = vi.fn();

    const { completeProviderTurn } = await import('../run-terminal-coordinator.js');

    completeProviderTurn({
      activeRun,
      broadcastHeartbeat: vi.fn(),
      db: {} as any,
      input: 'hello',
      msg: { type: 'result' } as any,
      notificationService: { notify: vi.fn() } as any,
      providerRegistry: providerRegistry as any,
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent,
      sessionId: 'session-1',
      sessionType: 'interactive',
      state: {},
    });

    expect(sendRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run_completed',
        runId: 'run-1',
        sessionId: 'session-1',
        content: 'Full final text',
        contentBlocks: [
          { type: 'tool_use', toolUseId: 'tool-1' },
          { type: 'text', content: 'Full final text' },
        ],
      })
    );
  });

  it('publishes the terminal snapshot without waiting for a stalled compaction', async () => {
    const usage = {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const activeRun = buildRun({
      fullContent: 'persisted final text',
      contentBlocks: [{ type: 'text', content: 'persisted final text' }],
      agentProfile: { id: 'agent-1', model: 'model-1' },
      llmProfile: { id: 'llm-1', providerType: 'zclaudia', models: [] },
    });
    let releaseCompaction!: (outcome: {
      outcome: 'skipped';
      compacted: false;
      reason: string;
    }) => void;
    maybeCompactMock.mockImplementationOnce(
      () => new Promise(resolve => (releaseCompaction = resolve))
    );
    const sendRunEvent = vi.fn();
    const broadcastHeartbeat = vi.fn();
    const { completeProviderTurn } = await import('../run-terminal-coordinator.js');

    completeProviderTurn({
      activeRun,
      broadcastHeartbeat,
      db: {} as any,
      input: 'hello',
      msg: { type: 'result', usage } as any,
      notificationService: { notify: vi.fn() } as any,
      providerRegistry: providerRegistry as any,
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent,
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
    });

    expect(activeRun.phase).toBe('completed');
    expect(broadcastHeartbeat).toHaveBeenCalledOnce();
    expect(sendRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run_completed',
        assistantMessageId: 'assistant-1',
        messageVersion: 7,
        content: 'persisted final text',
      })
    );

    releaseCompaction({ outcome: 'skipped', compacted: false, reason: 'below_threshold' });
    await Promise.resolve();
  });

  it('emits run_completed before asynchronous auto compaction succeeds', async () => {
    const usage = {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const activeRun = buildRun({
      agentProfile: { id: 'agent-1', model: 'model-1' },
      llmProfile: { id: 'llm-1', providerType: 'zclaudia', models: [] },
    });
    const sendRunEvent = vi.fn();
    const listeners = new RunDomainEventListenerRegistry();
    const compactionCompletedListener = vi.fn();
    listeners.on('compaction.completed', compactionCompletedListener);
    maybeCompactMock.mockResolvedValueOnce({
      outcome: 'compacted',
      compacted: true,
      compactionId: 'compaction-1',
      tokensBefore: 1234,
    });

    const { completeProviderTurn } = await import('../run-terminal-coordinator.js');

    completeProviderTurn({
      activeRun,
      broadcastHeartbeat: vi.fn(),
      db: {} as any,
      input: 'hello',
      msg: { type: 'result', content: 'done', usage } as any,
      notificationService: { notify: vi.fn() } as any,
      providerRegistry: providerRegistry as any,
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent,
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
      listeners,
    });

    expect(activeRun.phase).toBe('completed');
    await vi.waitFor(() => {
      expect(sendRunEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'run_completed' }));
    });
    const eventTypes = sendRunEvent.mock.calls.map(([event]) => event.type);
    expect(eventTypes.indexOf('compaction_completed')).toBeGreaterThanOrEqual(0);
    expect(eventTypes.indexOf('run_completed')).toBeLessThan(
      eventTypes.indexOf('compaction_completed')
    );
    expect(compactionCompletedListener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'compaction.completed',
        runId: 'run-1',
        sessionId: 'session-1',
        payload: {
          compactionId: 'compaction-1',
          tokensBefore: 1234,
        },
      })
    );
  });

  it('emits run_completed before asynchronous auto compaction fails', async () => {
    const usage = {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const activeRun = buildRun({
      agentProfile: { id: 'agent-1', model: 'model-1' },
      llmProfile: { id: 'llm-1', providerType: 'zclaudia', models: [] },
    });
    const sendRunEvent = vi.fn();
    const listeners = new RunDomainEventListenerRegistry();
    const compactionFailedListener = vi.fn();
    listeners.on('compaction.failed', compactionFailedListener);
    maybeCompactMock.mockResolvedValueOnce({
      outcome: 'failed',
      compacted: false,
      reason: 'summarizer unavailable',
      tokensBefore: 1234,
      breaker: {
        breakerOpen: true,
        nextRetryAtMs: 4567,
      },
    });

    const { completeProviderTurn } = await import('../run-terminal-coordinator.js');

    completeProviderTurn({
      activeRun,
      broadcastHeartbeat: vi.fn(),
      db: {} as any,
      input: 'hello',
      msg: { type: 'result', content: 'done', usage } as any,
      notificationService: { notify: vi.fn() } as any,
      providerRegistry: providerRegistry as any,
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent,
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
      listeners,
    });

    await vi.waitFor(() => {
      expect(sendRunEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'run_completed' }));
    });
    const eventTypes = sendRunEvent.mock.calls.map(([event]) => event.type);
    expect(eventTypes.indexOf('compaction_failed')).toBeGreaterThanOrEqual(0);
    expect(eventTypes.indexOf('run_completed')).toBeLessThan(
      eventTypes.indexOf('compaction_failed')
    );
    expect(compactionFailedListener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'compaction.failed',
        runId: 'run-1',
        sessionId: 'session-1',
        payload: {
          reason: 'summarizer unavailable',
          breakerOpen: true,
          nextRetryAtMs: 4567,
        },
      })
    );
  });

  it('fails provider turns with persistence, wire event, plugin event, cleanup, and notification', async () => {
    const activeRun = buildRun();
    const activeRuns = new Map([['run-1', activeRun]]);
    const sendRunEvent = vi.fn();
    const broadcastHeartbeat = vi.fn();
    const notificationsService = { postItem: vi.fn() };
    const listeners = new RunDomainEventListenerRegistry();
    const runFailedListener = vi.fn();
    listeners.on('run.failed', runFailedListener);

    const { failProviderTurn } = await import('../run-terminal-coordinator.js');

    failProviderTurn({
      activeRun,
      activeRuns,
      broadcastHeartbeat,
      cleanupReason: 'formatted provider error',
      db: {} as any,
      errorCode: 'BAD_MODEL',
      errorMessage: 'formatted provider error',
      notificationService: { notify: vi.fn() } as any,
      notificationsService: notificationsService as any,
      runId: 'run-1',
      sendRunEvent,
      sessionId: 'session-1',
      listeners,
    });

    expect(upsertAssistantMessageMock).toHaveBeenCalledWith(activeRun, { indexMetadata: true });
    expect(sendRunEvent).toHaveBeenCalledWith({
      type: 'run_failed',
      runId: 'run-1',
      sessionId: 'session-1',
      error: 'formatted provider error',
      errorCode: 'BAD_MODEL',
      assistantMessageId: 'assistant-1',
      messageVersion: 7,
    });
    expect(activeRun.phase).toBe('failed');
    expect(runFailedListener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run.failed',
        runId: 'run-1',
        sessionId: 'session-1',
        payload: {
          error: 'formatted provider error',
          errorCode: 'BAD_MODEL',
          assistantMessageId: 'assistant-1',
          messageVersion: 7,
        },
      })
    );
    expect(broadcastHeartbeat).toHaveBeenCalled();
    expect(notificationsService.postItem).toHaveBeenCalled();
    expect(clearSessionMock).toHaveBeenCalledWith('session-1');
    expect(cleanupPendingPermissionsMock).toHaveBeenCalledWith(
      activeRun,
      'formatted provider error'
    );
    expect(activeRuns.has('run-1')).toBe(false);
  });

  it('does not emit duplicate run.completed domain events for already terminal runs', async () => {
    const usage = {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const activeRun = buildRun({ phase: 'completed' });
    const listeners = new RunDomainEventListenerRegistry();
    const runCompletedListener = vi.fn();
    listeners.on('run.completed', runCompletedListener);
    const sendRunEvent = vi.fn();

    const { completeProviderTurn } = await import('../run-terminal-coordinator.js');

    completeProviderTurn({
      activeRun,
      broadcastHeartbeat: vi.fn(),
      db: {} as any,
      input: 'hello',
      msg: { type: 'result', content: 'done', usage } as any,
      notificationService: { notify: vi.fn() } as any,
      providerRegistry: providerRegistry as any,
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent,
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
      listeners,
    });

    expect(sendRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run_completed',
        usage,
      })
    );
    expect(runCompletedListener).not.toHaveBeenCalled();
  });
});
