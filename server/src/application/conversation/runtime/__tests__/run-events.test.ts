import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhaseEmitter, recomputePhase, computeBlockers } from '../active-run-phase.js';

const findProcessPidsByTaskCommandMock = vi.fn();
const cleanupPendingPermissionsMock = vi.fn();
const upsertAssistantMessageMock = vi.fn();
const pluginEventsEmitMock = vi.fn(async () => {});
const sendMessageMock = vi.fn();
const maybeCompactMock = vi.fn(async () => ({ outcome: 'skipped', compacted: false, reason: 'below_threshold' }));

vi.mock('../run-lifecycle.js', () => ({
  cleanupPendingPermissions: cleanupPendingPermissionsMock,
  findProcessPidsByTaskCommand: findProcessPidsByTaskCommandMock,
  upsertAssistantMessage: upsertAssistantMessageMock,
}));

vi.mock('../../compaction/compaction-service.js', () => ({
  maybeCompact: maybeCompactMock,
}));

const mockProviderRegistry = {
  get: vi.fn(() => ({
    getCliPid: vi.fn(() => 111),
    getTaskProcessInfo: vi.fn(() => ({
      command: 'sleep 30',
      rootPid: undefined,
    })),
  })),
  getPolicy: vi.fn(() => undefined),
  getOrDefault: vi.fn(),
};

vi.mock('../../../../infra/events/index.js', () => ({
  pluginEvents: {
    emit: pluginEventsEmitMock,
  },
}));

vi.mock('../../interactions/interaction-normalizer.js', () => ({
  normalizeFromToolUse: vi.fn(() => null),
}));

vi.mock('../../transport/broadcast.js', () => ({
  sendMessage: sendMessageMock,
}));

describe('ws/run-events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('persists system info and emits session_created on init', async () => {
    const runSqlMock = vi.fn();
    const sendRunEventMock = vi.fn();
    const persistSessionWorkingDirectoryMock = vi.fn();
    const state: Record<string, unknown> = {};
    const activeRun = {
      sessionId: 'session-1',
      latestSystemInfo: undefined,
      providerSessionId: undefined,
      collectedToolCalls: [],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
    } as any;

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: { prepare: vi.fn(() => ({ run: runSqlMock })) } as any,
      input: 'hello',
      modeValue: 'default',
      msg: {
        type: 'init',
        sessionId: 'sdk-session-1',
        systemInfo: {
          cwd: '/tmp/project',
          model: 'sonnet',
          claudeCodeVersion: '1.0.0',
          permissionMode: 'default',
          apiKeySource: 'env',
          tools: [],
          mcpServers: [],
          slashCommands: [],
          agents: [],
        },
      } as any,
      notificationService: {} as any,
      persistSessionWorkingDirectory: persistSessionWorkingDirectoryMock,
      providerType: 'claude',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'regular',
      state,
      toolUseIdToName: new Map(),
      providerRegistry: mockProviderRegistry as any,
    });

    expect(persistSessionWorkingDirectoryMock).toHaveBeenCalledWith('/tmp/project');
    expect(activeRun.latestSystemInfo).toEqual(expect.objectContaining({ cwd: '/tmp/project', model: 'sonnet' }));
    expect(activeRun.providerSessionId).toBe('sdk-session-1');
    expect(state.sdkSessionId).toBe('sdk-session-1');
    expect(runSqlMock).toHaveBeenCalledWith('sdk-session-1', expect.any(Number), 'session-1');
    expect(sendRunEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'system_info',
      runId: 'run-1',
      systemInfo: expect.objectContaining({ cwd: '/tmp/project', model: 'sonnet' }),
    }));
    expect(sendRunEventMock).toHaveBeenCalledWith({
      type: 'session_created',
      sessionId: 'session-1',
      sdkSessionId: 'sdk-session-1',
    });
  });

  it('completes result events, emits background completion, and notifies', async () => {
    const sendRunEventMock = vi.fn();
    const broadcastHeartbeatMock = vi.fn();
    const postItemMock = vi.fn();
    const activeRun = {
      sessionId: 'session-1',
      assistantMessageId: 'assistant-1',
      sessionType: 'background',
      providerType: 'claude',
      collectedToolCalls: [],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
      phase: 'running',
      phaseEmitter: new PhaseEmitter(),
      runId: 'run-1',
    } as any;

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map(),
      broadcastHeartbeat: broadcastHeartbeatMock,
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: {
        type: 'result',
        content: 'done',
        usage: { inputTokens: 1, outputTokens: 2 },
      } as any,
      notificationService: { notify: vi.fn() } as any,
      notificationsService: { postItem: postItemMock } as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'claude',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'background',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: mockProviderRegistry as any,
    });

    expect(activeRun.fullContent).toBe('done');
    expect(activeRun.phase).toBe('completed');
    expect(upsertAssistantMessageMock).toHaveBeenCalledWith(activeRun, {
      usage: { inputTokens: 1, outputTokens: 2 },
      indexMetadata: true,
    });
    expect(sendRunEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'delta',
      runId: 'run-1',
      content: 'done',
    }));
    expect(sendRunEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'run_completed',
      runId: 'run-1',
      sessionId: 'session-1',
      usage: { inputTokens: 1, outputTokens: 2 },
    }));
    expect(pluginEventsEmitMock).toHaveBeenCalledWith('run.completed', expect.objectContaining({
      runId: 'run-1',
      sessionId: 'session-1',
    }));
    expect(broadcastHeartbeatMock).toHaveBeenCalled();
    expect(postItemMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      title: 'Run completed: session-1',
      summary: 'Session response is ready.',
      status: 'completed',
      source: 'manual',
    }));
    expect(sendRunEventMock).toHaveBeenCalledWith({
      type: 'background_task_update',
      sessionId: 'session-1',
      status: 'completed',
    });
  });

  it('marks heartbeat dirty before broadcasting completion state', async () => {
    const sendRunEventMock = vi.fn();
    const broadcastHeartbeatMock = vi.fn();
    const activeRun = {
      sessionId: 'session-1',
      providerType: 'claude',
      phase: 'running',
      phaseEmitter: new PhaseEmitter(),
      runId: 'run-1',
      collectedToolCalls: [],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
    } as any;

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map([['run-1', activeRun]]),
      broadcastHeartbeat: broadcastHeartbeatMock,
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: { type: 'result', subtype: 'success', usage: { inputTokens: 1, outputTokens: 2 } } as any,
      notificationService: { notify: vi.fn() } as any,
      notificationsService: { postItem: vi.fn() } as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'claude',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: mockProviderRegistry as any,
    });

    expect(broadcastHeartbeatMock).toHaveBeenCalledTimes(1);
  });

  it('injects an emptyResultFallback delta from provider policy when a tool-only turn ends silently', async () => {
    const sendRunEventMock = vi.fn();
    const registry = {
      get: vi.fn(),
      getPolicy: vi.fn(() => ({ emptyResultFallback: 'fallback text' })),
    };
    const activeRun = {
      sessionId: 'session-1',
      providerType: 'zclaudia',
      assistantMessageId: 'a-1',
      sessionType: 'regular',
      collectedToolCalls: [{ toolUseId: 't1', name: 'Bash', input: {} }],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
      phase: 'running',
      phaseEmitter: new PhaseEmitter(),
      runId: 'run-1',
    } as any;

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map([['run-1', activeRun]]),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: { type: 'result', subtype: 'success', usage: { inputTokens: 1, outputTokens: 2 } } as any,
      notificationService: { notify: vi.fn() } as any,
      notificationsService: { postItem: vi.fn() } as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: registry as any,
    });

    expect(sendRunEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'delta',
      content: 'fallback text',
    }));
    expect(activeRun.fullContent).toBe('fallback text');
  });

  it('does not inject a fallback when provider policy declares none', async () => {
    const sendRunEventMock = vi.fn();
    const registry = {
      get: vi.fn(),
      getPolicy: vi.fn(() => ({})),
    };
    const activeRun = {
      sessionId: 'session-1',
      providerType: 'cursor',
      assistantMessageId: 'a-2',
      sessionType: 'regular',
      collectedToolCalls: [{ toolUseId: 't1', name: 'Read', input: {} }],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
      phase: 'running',
      phaseEmitter: new PhaseEmitter(),
      runId: 'run-1',
    } as any;

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map([['run-1', activeRun]]),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: { type: 'result', subtype: 'success', usage: { inputTokens: 1, outputTokens: 2 } } as any,
      notificationService: { notify: vi.fn() } as any,
      notificationsService: { postItem: vi.fn() } as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'cursor',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: registry as any,
    });

    expect(activeRun.fullContent).toBe('');
    // No delta event for a synthetic fallback.
    expect(sendRunEventMock).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'delta',
      content: expect.any(String),
    }));
  });

  it('fails runs on provider error and removes them from activeRuns', async () => {
    const sendRunEventMock = vi.fn();
    const broadcastHeartbeatMock = vi.fn();
    const postItemMock = vi.fn();
    const activeRun = {
      sessionId: 'session-1',
      providerType: 'claude',
      collectedToolCalls: [],
      contentBlocks: [],
      fullContent: 'partial',
      pendingPermissions: new Map(),
      recentToolCalls: [],
      phase: 'running',
      phaseEmitter: new PhaseEmitter(),
      runId: 'run-1',
    } as any;
    const activeRuns = new Map([['run-1', activeRun]]);

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns,
      broadcastHeartbeat: broadcastHeartbeatMock,
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: {
        type: 'error',
        error: 'provider exploded',
      } as any,
      notificationService: { notify: vi.fn() } as any,
      notificationsService: { postItem: postItemMock } as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'claude',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: mockProviderRegistry as any,
    });

    expect(upsertAssistantMessageMock).toHaveBeenCalledWith(activeRun, { indexMetadata: true });
    expect(sendRunEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'run_failed',
      runId: 'run-1',
      sessionId: 'session-1',
    }));
    expect(activeRun.phase).toBe('failed');
    expect(pluginEventsEmitMock).toHaveBeenCalledWith('run.error', expect.objectContaining({
      runId: 'run-1',
      sessionId: 'session-1',
    }));
    expect(broadcastHeartbeatMock).toHaveBeenCalled();
    expect(postItemMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      title: 'Run failed: session-1',
      error: 'provider exploded',
      status: 'failed',
      source: 'manual',
    }));
    expect(cleanupPendingPermissionsMock).toHaveBeenCalled();
    expect(activeRuns.has('run-1')).toBe(false);
  });

  // mode_transition is a provider-agnostic event. The runtime must react to it
  // identically regardless of which provider emitted it — that's the whole
  // point of normalizing plan-mode semantics into a single internal event.
  it('routes a mode_transition (enter) into mode_change + aiInitiatedPlanMode + setSessionMode', async () => {
    const sendRunEventMock = vi.fn();
    const setSessionModeMock = vi.fn();
    const registry = {
      get: vi.fn(() => ({ setSessionMode: setSessionModeMock })),
    };
    const activeRun = {
      sessionId: 'session-1',
      // providerType is intentionally an arbitrary string — the runtime must
      // not care what it is, only the manifest/adapter behavior matters.
      providerType: 'cursor',
      collectedToolCalls: [],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
    } as any;

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: {
        type: 'mode_transition',
        modeTransition: { mode: 'plan', reason: 'enter', sourceToolUseId: 'tu-1' },
      } as any,
      notificationService: {} as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'cursor',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: registry as any,
    });

    expect(sendRunEventMock).toHaveBeenCalledWith({
      type: 'mode_change', runId: 'run-1', sessionId: 'session-1', mode: 'plan',
    });
    expect(activeRun.aiInitiatedPlanMode).toBe(true);
    expect(activeRun.originalMode).toBe('default');
    expect(setSessionModeMock).toHaveBeenCalledWith('session-1', 'plan');
  });

  it('routes a mode_transition (exit) and clears aiInitiatedPlanMode', async () => {
    const sendRunEventMock = vi.fn();
    const setSessionModeMock = vi.fn();
    const registry = {
      get: vi.fn(() => ({ setSessionMode: setSessionModeMock })),
    };
    const activeRun = {
      sessionId: 'session-1',
      providerType: 'claude',
      aiInitiatedPlanMode: true,
      originalMode: 'default',
      collectedToolCalls: [],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
    } as any;

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'plan',
      msg: {
        type: 'mode_transition',
        modeTransition: { mode: 'default', reason: 'exit' },
      } as any,
      notificationService: {} as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'claude',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: registry as any,
    });

    expect(sendRunEventMock).toHaveBeenCalledWith({
      type: 'mode_change', runId: 'run-1', sessionId: 'session-1', mode: 'default',
    });
    expect(activeRun.aiInitiatedPlanMode).toBe(false);
    expect(setSessionModeMock).toHaveBeenCalledWith('session-1', 'default');
  });

  it('forwards normalized tool metadata from internal tool_use through to the wire event', async () => {
    const sendRunEventMock = vi.fn();
    const activeRun = {
      sessionId: 'session-1',
      providerType: 'cursor',
      collectedToolCalls: [],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
    } as any;

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: {
        type: 'tool_use',
        toolUseId: 'tu-x',
        toolName: 'createPlan',
        toolInput: { plan: '# Plan' },
        toolSemantic: 'plan_proposal',
        toolEffect: { kind: 'file_change', files: [{ path: 'src/a.ts', changeKind: 'modify' }] },
      } as any,
      notificationService: {} as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'cursor',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: mockProviderRegistry as any,
    });

    expect(sendRunEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool_use',
      toolName: 'createPlan',
      semantic: 'plan_proposal',
      effect: { kind: 'file_change', files: [{ path: 'src/a.ts', changeKind: 'modify' }] },
    }));
    expect(activeRun.collectedToolCalls[0]).toMatchObject({
      toolUseId: 'tu-x',
      effect: { kind: 'file_change', files: [{ path: 'src/a.ts', changeKind: 'modify' }] },
    });
  });

  it('backfills normalized tool effects from internal tool_result events', async () => {
    const sendRunEventMock = vi.fn();
    const effect = { kind: 'file_change', files: [{ path: 'src/a.ts', changeKind: 'modify', summary: '@@ diff' }] };
    const activeRun = {
      sessionId: 'session-1',
      providerType: 'cursor',
      collectedToolCalls: [{ toolUseId: 'tu-x', name: 'Edit', input: { path: 'src/a.ts' } }],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
    } as any;
    const toolUseIdToName = new Map([['tu-x', 'Edit']]);

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: {
        type: 'tool_result',
        toolUseId: 'tu-x',
        toolResult: 'updated',
        toolEffect: effect,
      } as any,
      notificationService: {} as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'cursor',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
      toolUseIdToName,
      providerRegistry: mockProviderRegistry as any,
    });

    expect(activeRun.collectedToolCalls[0]).toMatchObject({
      output: 'updated',
      effect,
    });
    expect(sendRunEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool_result',
      toolName: 'Edit',
      effect,
    }));
  });

  it('tracks background tasks from Bash tool_result text when SDK task notifications are absent', async () => {
    const sendRunEventMock = vi.fn();
    const activeRun = {
      sessionId: 'session-1',
      providerType: 'claude',
      collectedToolCalls: [{ toolUseId: 'bash-1', name: 'Bash', input: {} }],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
      pendingBackgroundTasks: 0,
      phase: 'running',
      phaseEmitter: new PhaseEmitter(),
      runId: 'run-1',
    } as any;
    const state: any = {};

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: {
        type: 'tool_result',
        toolUseId: 'bash-1',
        toolResult: 'Command running in background with ID: b1bh5uv01. Output is being written to: /tmp/out',
      } as any,
      notificationService: {} as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'claude',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'regular',
      state,
      toolUseIdToName: new Map([['bash-1', 'Bash']]),
      providerRegistry: mockProviderRegistry as any,
    });

    expect(activeRun.pendingBackgroundTasks).toBe(1);
    expect(state.backgroundTaskKeys.has('task:b1bh5uv01')).toBe(true);
    expect(sendRunEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool_result',
      toolName: 'Bash',
    }));
  });

  it('does not double count Monitor started text and matching SDK task notification', async () => {
    const activeRun = {
      sessionId: 'session-1',
      providerType: 'claude',
      providerSessionId: 'sdk-1',
      collectedToolCalls: [{ toolUseId: 'monitor-1', name: 'Monitor', input: {} }],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
      pendingBackgroundTasks: 0,
      phase: 'running',
      phaseEmitter: new PhaseEmitter(),
      runId: 'run-1',
    } as any;
    const state: any = {};

    const { handleProviderEvent } = await import('../run-events.js');
    const common = {
      activeRun,
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      notificationService: {} as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'claude',
      runId: 'run-1',
      sendRunEvent: vi.fn(),
      sessionId: 'session-1',
      sessionType: 'regular' as const,
      state,
      providerRegistry: mockProviderRegistry as any,
    };

    handleProviderEvent({
      ...common,
      msg: {
        type: 'tool_result',
        toolUseId: 'monitor-1',
        toolResult: 'Monitor started (task bve70ij13, timeout 300000ms). You will be notified on each event.',
      } as any,
      toolUseIdToName: new Map([['monitor-1', 'Monitor']]),
    });
    handleProviderEvent({
      ...common,
      msg: {
        type: 'task_notification',
        taskId: 'bve70ij13',
        taskStatus: 'started',
        taskMessage: 'started',
      } as any,
      toolUseIdToName: new Map(),
    });

    expect(activeRun.pendingBackgroundTasks).toBe(1);
    vi.clearAllTimers();
  });

  it('emits tool_activity from msg.toolUseId when the provider supplies it directly (pi-runtime path)', async () => {
    const sendRunEventMock = vi.fn();
    const activeRun = {
      sessionId: 'session-1',
      providerType: 'zclaudia',
      collectedToolCalls: [{ toolUseId: 'bash-1', name: 'Bash', input: {} }],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
      thinkingBlocks: [],
    } as any;

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: {
        type: 'tool_activity',
        toolUseId: 'bash-1',
        toolName: 'bash',
        content: 'partial stdout',
      } as any,
      notificationService: {} as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
      toolUseIdToName: new Map([['bash-1', 'Bash']]),
      providerRegistry: mockProviderRegistry as any,
    });

    expect(sendRunEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool_activity',
      runId: 'run-1',
      toolUseId: 'bash-1',
      content: 'partial stdout',
    }));
  });

  it('falls back to the latest uncompleted Agent tool when tool_activity has no toolUseId (Claude SDK path)', async () => {
    const sendRunEventMock = vi.fn();
    const activeRun = {
      sessionId: 'session-1',
      providerType: 'claude',
      collectedToolCalls: [
        { toolUseId: 'a-1', name: 'Agent', input: {}, output: 'done' },
        { toolUseId: 'a-2', name: 'Agent', input: {} },
      ],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
    } as any;

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: { type: 'tool_activity', content: 'sub-agent text' } as any,
      notificationService: {} as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'claude',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: mockProviderRegistry as any,
    });

    expect(sendRunEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool_activity',
      toolUseId: 'a-2',
      content: 'sub-agent text',
    }));
  });

  it('accumulates thinking_delta content into activeRun.thinkingBlocks (single block)', async () => {
    const sendRunEventMock = vi.fn();
    const activeRun = {
      sessionId: 'session-1',
      providerType: 'zclaudia',
      collectedToolCalls: [],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
      thinkingBlocks: [],
    } as any;

    const { handleProviderEvent } = await import('../run-events.js');

    const common = {
      activeRun,
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      notificationService: {} as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'regular' as const,
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: mockProviderRegistry as any,
    };

    handleProviderEvent({ ...common, msg: { type: 'thinking_delta', thinkingContent: 'step 1 ' } as any });
    handleProviderEvent({ ...common, msg: { type: 'thinking_delta', thinkingContent: 'step 2' } as any });

    expect(activeRun.thinkingBlocks).toHaveLength(1);
    expect(activeRun.thinkingBlocks[0].text).toBe('step 1 step 2');
    // thinking_delta does not yet emit a wire-level event — desktop receives
    // thinking blocks via final assistant message metadata.
    expect(sendRunEventMock).not.toHaveBeenCalled();
  });

  it('records signature on the current thinking block when thinkingSignature arrives', async () => {
    const sendRunEventMock = vi.fn();
    const activeRun = {
      sessionId: 'session-1',
      providerType: 'zclaudia',
      collectedToolCalls: [],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
      thinkingBlocks: [{ text: 'reasoning' }],
    } as any;

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: { type: 'thinking_delta', thinkingSignature: 'sig-1' } as any,
      notificationService: {} as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: mockProviderRegistry as any,
    });

    expect(activeRun.thinkingBlocks[0].signature).toBe('sig-1');
  });

  it('records redaction on the current thinking block when thinkingRedacted arrives', async () => {
    const sendRunEventMock = vi.fn();
    const activeRun = {
      sessionId: 'session-1',
      providerType: 'zclaudia',
      collectedToolCalls: [],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
      thinkingBlocks: [{ text: 'reasoning' }],
    } as any;

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: { type: 'thinking_delta', thinkingRedacted: true } as any,
      notificationService: {} as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: mockProviderRegistry as any,
    });

    expect(activeRun.thinkingBlocks[0].redacted).toBe(true);
  });

  it('initializes thinkingBlocks lazily when the run lacks the array', async () => {
    const sendRunEventMock = vi.fn();
    const activeRun = {
      sessionId: 'session-1',
      providerType: 'zclaudia',
      collectedToolCalls: [],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
      // thinkingBlocks intentionally undefined to simulate older bootstrap path
    } as any;

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: { type: 'thinking_delta', thinkingContent: 'hello' } as any,
      notificationService: {} as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: mockProviderRegistry as any,
    });

    expect(activeRun.thinkingBlocks).toEqual([{ text: 'hello' }]);
  });

  it('swallows PID backfill errors and logs a warning', async () => {
    findProcessPidsByTaskCommandMock.mockRejectedValue(new Error('ps failed'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun: {
        sessionId: 'session-1',
        providerType: 'claude',
        providerSessionId: 'sdk-1',
        collectedToolCalls: [],
        contentBlocks: [],
        fullContent: '',
        pendingPermissions: new Map(),
        recentToolCalls: [],
        phase: 'running',
        phaseEmitter: new PhaseEmitter(),
        runId: 'run-1',
      } as any,
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: {} as any,
      input: 'hello',
      modeValue: 'default',
      msg: {
        type: 'task_notification',
        taskId: 'task-1',
        taskStatus: 'started',
        taskMessage: 'started',
      } as any,
      notificationService: {} as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'claude',
      runId: 'run-1',
      sendRunEvent: vi.fn(),
      sessionId: 'session-1',
      sessionType: 'background',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: mockProviderRegistry as any,
    });

    await vi.runAllTimersAsync();

    expect(warnSpy).toHaveBeenCalledWith(
      '[Task Notification] Failed to backfill PID for taskId=task-1:',
      'ps failed',
    );
    warnSpy.mockRestore();
  });

  // A1: ActiveRun phase state machine — these tests prove that the run-events
  // dispatcher drives `activeRun.phase` correctly on the terminal `result` /
  // `error` events plus the `task_notification` background-task path. They
  // complement the unit tests in active-run-phase.test.ts by exercising the
  // actual integration with handleProviderEvent.
  describe('phase transitions (A1)', () => {
    function buildBaseActiveRun(overrides: Record<string, unknown> = {}): any {
      return {
        sessionId: 'session-1',
        assistantMessageId: 'assistant-1',
        sessionType: 'regular',
        providerType: 'claude',
        collectedToolCalls: [],
        contentBlocks: [],
        fullContent: '',
        pendingPermissions: new Map(),
        recentToolCalls: [],
        pendingBackgroundTasks: 0,
        phase: 'running',
        phaseEmitter: new PhaseEmitter(),
        runId: 'run-1',
        ...overrides,
      };
    }

    function commonParams(activeRun: any, msg: any, extras: Record<string, unknown> = {}) {
      return {
        activeRun,
        activeRuns: new Map([['run-1', activeRun]]),
        broadcastHeartbeat: vi.fn(),
        client: { ws: {} as any } as any,
        db: {} as any,
        input: 'hello',
        modeValue: 'default',
        msg,
        notificationService: { notify: vi.fn() } as any,
        notificationsService: { postItem: vi.fn() } as any,
        persistSessionWorkingDirectory: vi.fn(),
        providerType: 'claude',
        runId: 'run-1',
        sendRunEvent: vi.fn(),
        sessionId: 'session-1',
        sessionType: 'regular' as const,
        state: {},
        toolUseIdToName: new Map(),
        providerRegistry: mockProviderRegistry as any,
        ...extras,
      };
    }

    it('result event transitions phase to "completed"', async () => {
      const activeRun = buildBaseActiveRun();
      const { handleProviderEvent } = await import('../run-events.js');

      handleProviderEvent(commonParams(activeRun, {
        type: 'result',
        content: 'done',
        usage: { inputTokens: 1, outputTokens: 2 },
      } as any));

      expect(activeRun.phase).toBe('completed');
    });

    it('error event transitions phase to "failed"', async () => {
      const activeRun = buildBaseActiveRun();
      const { handleProviderEvent } = await import('../run-events.js');

      handleProviderEvent(commonParams(activeRun, {
        type: 'error',
        error: 'provider exploded',
      } as any));

      expect(activeRun.phase).toBe('failed');
    });

    it('background task started transitions phase to "awaiting_followup"', async () => {
      const activeRun = buildBaseActiveRun();
      const { handleProviderEvent } = await import('../run-events.js');

      handleProviderEvent(commonParams(activeRun, {
        type: 'task_notification',
        taskId: 'task-A',
        taskStatus: 'started',
        taskMessage: 'started',
      } as any));

      expect(activeRun.pendingBackgroundTasks).toBe(1);
      expect(activeRun.phase).toBe('awaiting_followup');
    });

    it('background task end transitions phase back to "running"', async () => {
      const activeRun = buildBaseActiveRun();
      const { handleProviderEvent } = await import('../run-events.js');

      handleProviderEvent(commonParams(activeRun, {
        type: 'task_notification',
        taskId: 'task-B',
        taskStatus: 'started',
        taskMessage: 'started',
      } as any));
      expect(activeRun.phase).toBe('awaiting_followup');

      handleProviderEvent(commonParams(activeRun, {
        type: 'task_notification',
        taskId: 'task-B',
        taskStatus: 'completed',
        taskMessage: 'done',
      } as any));

      expect(activeRun.pendingBackgroundTasks).toBe(0);
      expect(activeRun.phase).toBe('running');
    });
  });

  // A1: the permission queue mutates `pendingPermissions` from many sites
  // (run-permissions.set, permission-handler.delete, feature-domains.delete).
  // Each callsite is expected to call recomputePhase(activeRun, computeBlockers(activeRun))
  // after mutating the map. These tests directly exercise the helper pair to
  // confirm the phase priority logic (`awaiting_permission` beats
  // `awaiting_followup` beats `running`) used at every callsite.
  describe('permission queue — phase transitions (A1)', () => {
    function buildRun(overrides: Record<string, unknown> = {}): any {
      return {
        runId: 'run-1',
        phase: 'running',
        phaseEmitter: new PhaseEmitter(),
        pendingPermissions: new Map(),
        pendingBackgroundTasks: 0,
        ...overrides,
      };
    }

    it('first permission enqueue → awaiting_permission', () => {
      const activeRun = buildRun();
      activeRun.pendingPermissions.set('req-1', {} as any);
      recomputePhase(activeRun, computeBlockers(activeRun));
      expect(activeRun.phase).toBe('awaiting_permission');
    });

    it('last permission resolve → back to running', () => {
      const activeRun = buildRun();
      activeRun.pendingPermissions.set('req-1', {} as any);
      recomputePhase(activeRun, computeBlockers(activeRun));
      expect(activeRun.phase).toBe('awaiting_permission');

      activeRun.pendingPermissions.delete('req-1');
      recomputePhase(activeRun, computeBlockers(activeRun));
      expect(activeRun.phase).toBe('running');
    });

    it('permission resolved while background task in flight → awaiting_followup', () => {
      const activeRun = buildRun({ pendingBackgroundTasks: 1 });
      activeRun.pendingPermissions.set('req-1', {} as any);
      recomputePhase(activeRun, computeBlockers(activeRun));
      expect(activeRun.phase).toBe('awaiting_permission');

      activeRun.pendingPermissions.delete('req-1');
      recomputePhase(activeRun, computeBlockers(activeRun));
      expect(activeRun.phase).toBe('awaiting_followup');
    });
  });
});

describe('run-events agent_end -> maybeCompact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('calls maybeCompact when activeRun has agentProfile and llmProfile', async () => {
    const sendRunEventMock = vi.fn();
    const agentProfile = { id: 'ap1', model: 'claude-sonnet-4-6' } as any;
    const llmProfile = { id: 'lp1', providerType: 'anthropic', apiKey: 'k' } as any;
    const activeRun = {
      sessionId: 'session-1',
      assistantMessageId: 'assistant-1',
      sessionType: 'regular',
      providerType: 'zclaudia',
      collectedToolCalls: [],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
      phase: 'running',
      phaseEmitter: new PhaseEmitter(),
      runId: 'run-1',
      agentProfile,
      llmProfile,
    } as any;

    maybeCompactMock.mockResolvedValueOnce({ outcome: 'skipped', compacted: false, reason: 'below_threshold' });

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: { fake: true } as any,
      input: 'hi',
      modeValue: 'default',
      msg: {
        type: 'result',
        content: 'done',
        usage: { totalTokens: 1234 },
      } as any,
      notificationService: { notify: vi.fn() } as any,
      notificationsService: { postItem: vi.fn() } as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: mockProviderRegistry as any,
    });

    // maybeCompact is awaited inside an async branch — let microtasks flush.
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(maybeCompactMock).toHaveBeenCalledTimes(1);
    expect(maybeCompactMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      agentProfile,
      llmProfile,
      source: 'auto',
    }));
  });

  it('sends compaction_completed event before run_completed when compaction succeeds', async () => {
    const sendRunEventMock = vi.fn();
    const agentProfile = { id: 'ap1', model: 'claude-sonnet-4-6' } as any;
    const llmProfile = {
      id: 'lp1', providerType: 'anthropic', apiKey: 'k',
      // Tight per-model window forces compaction in the mocked maybeCompactMock,
      // but we don't rely on it here — the mock returns the canned result directly.
      models: [{ modelId: 'claude-sonnet-4-6', contextWindow: 100 }],
    } as any;
    const activeRun = {
      sessionId: 'session-1',
      assistantMessageId: 'assistant-1',
      sessionType: 'regular',
      providerType: 'zclaudia',
      collectedToolCalls: [],
      contentBlocks: [],
      fullContent: '',
      pendingPermissions: new Map(),
      recentToolCalls: [],
      phase: 'running',
      phaseEmitter: new PhaseEmitter(),
      runId: 'run-1',
      agentProfile,
      llmProfile,
    } as any;

    maybeCompactMock.mockResolvedValueOnce({
      outcome: 'compacted',
      compacted: true,
      compactionId: 'c1',
      tokensBefore: 500,
    });

    const { handleProviderEvent } = await import('../run-events.js');

    handleProviderEvent({
      activeRun,
      activeRuns: new Map(),
      broadcastHeartbeat: vi.fn(),
      client: { ws: {} as any } as any,
      db: { fake: true } as any,
      input: 'hi',
      modeValue: 'default',
      msg: {
        type: 'result',
        content: 'done',
        usage: { totalTokens: 500 },
      } as any,
      notificationService: { notify: vi.fn() } as any,
      notificationsService: { postItem: vi.fn() } as any,
      persistSessionWorkingDirectory: vi.fn(),
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      sessionId: 'session-1',
      sessionType: 'regular',
      state: {},
      toolUseIdToName: new Map(),
      providerRegistry: mockProviderRegistry as any,
    });

    await vi.runAllTimersAsync();
    await Promise.resolve();

    const calls = sendRunEventMock.mock.calls.map((c) => c[0]);
    const compactionIdx = calls.findIndex((e) => e?.type === 'compaction_completed');
    const completedIdx = calls.findIndex((e) => e?.type === 'run_completed');
    expect(compactionIdx).toBeGreaterThanOrEqual(0);
    expect(completedIdx).toBeGreaterThanOrEqual(0);
    expect(compactionIdx).toBeLessThan(completedIdx);
    expect(calls[compactionIdx]).toMatchObject({
      type: 'compaction_completed',
      runId: 'run-1',
      sessionId: 'session-1',
      compactionId: 'c1',
      tokensBefore: 500,
    });
  });
});
