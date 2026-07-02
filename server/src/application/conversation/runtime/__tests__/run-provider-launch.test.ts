import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { LlmProfileRepository } from '../../../../domains/llm-profiles/repository.js';
import { RunDomainEventListenerRegistry } from '../run-domain-event-listeners.js';

const buildRunContextMock = vi.fn();
const negotiateProfileMock = vi.fn();
const upsertAssistantMessageMock = vi.fn();
const pluginEventsEmitMock = vi.fn(async () => {});
const mcpListStatusesMock = vi.fn();
const prepareDirectSkillInvocationMock = vi.fn();
const executePreparedDirectSkillInvocationMock = vi.fn();
const maybeCompactMock = vi.fn(async () => ({
  outcome: 'skipped',
  compacted: false,
  reason: 'below_threshold',
}));

vi.mock('../run-context.js', () => ({
  buildRunContext: buildRunContextMock,
}));

vi.mock('../../../../infra/providers/pcp-negotiator.js', () => ({
  negotiateProfile: negotiateProfileMock,
}));

vi.mock('../run-lifecycle.js', () => ({
  upsertAssistantMessage: upsertAssistantMessageMock,
}));

vi.mock('../../../../infra/events/index.js', () => ({
  pluginEvents: {
    emit: pluginEventsEmitMock,
  },
}));

vi.mock('../../../../utils/mcp-client-manager.js', () => ({
  mcpClientManager: {
    listStatuses: mcpListStatusesMock,
  },
}));

vi.mock('../../../../infra/providers/pi-runtime/skills.js', () => ({
  prepareDirectSkillInvocation: prepareDirectSkillInvocationMock,
  executePreparedDirectSkillInvocation: executePreparedDirectSkillInvocationMock,
}));

vi.mock('../../compaction/compaction-service.js', () => ({
  maybeCompact: maybeCompactMock,
}));

async function* providerStream() {
  yield {
    type: 'result',
    content: 'done',
    usage: { inputTokens: 1, outputTokens: 2 },
  } as any;
}

describe('ws/run-provider-launch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    buildRunContextMock.mockResolvedValue({
      nativeMode: 'default',
      runOptions: {
        cwd: '/tmp/project',
        mode: 'default',
      },
    });
    negotiateProfileMock.mockReturnValue({
      llmProfileId: 'pcp-claude',
      capabilities: [{ id: 'edit', enabled: true, mode: 'native', reliability: 'high' }],
    });
    mcpListStatusesMock.mockReturnValue([]);
    prepareDirectSkillInvocationMock.mockResolvedValue({ matched: false });
    executePreparedDirectSkillInvocationMock.mockReset();
    maybeCompactMock.mockResolvedValue({
      outcome: 'skipped',
      compacted: false,
      reason: 'below_threshold',
    });
  });

  it('emits run_started, background status, negotiates profile, and starts periodic save', async () => {
    const { launchProviderRun } = await import('../run-provider-launch.js');

    const trace = {
      log: vi.fn(),
      setMeta: vi.fn(),
    };
    const activeRun = {
      assistantMessageId: 'assistant-1',
      pendingSteers: [],
    } as any;
    const permissionCallback = vi.fn();
    const adapter = {
      manifest: { id: 'claude' },
      run: vi.fn(() => providerStream()),
      getRunState: vi.fn(() => ({ providerSessionId: 'sdk-1', providerCwd: '/tmp/project' })),
    } as any;
    const sendRunEventMock = vi.fn();
    const broadcastSessionCatalogUpdateMock = vi.fn();
    const listeners = new RunDomainEventListenerRegistry();
    const runStartedListener = vi.fn();
    listeners.on('run.started', runStartedListener);
    const { registerPluginDomainEventListener } =
      await import('../plugin-domain-event-listener.js');
    const unregisterPluginDomainEventListener = registerPluginDomainEventListener(listeners);

    const result = await launchProviderRun({
      activeRun,
      adapter,
      agentProfile: {
        id: 'agent-1',
        name: 'Test Agent',
        model: 'sonnet',
        systemPrompt: 'agent system prompt',
        enabledTools: [],
      } as any,
      broadcastSessionCatalogUpdate: broadcastSessionCatalogUpdateMock,
      client: { ws: {} as any } as any,
      cwd: '/tmp/project',
      db: {} as any,
      enabledTools: [],
      forcedPlanBySession: false,
      images: [],
      message: {
        type: 'run_start',
        sessionId: 'session-1',
        clientRequestId: 'req-1',
        input: 'hello',
      },
      modeValue: 'default',
      permissionCallback,
      processedInput: 'processed hello',
      providerConfig: {
        id: 'provider-1',
        providerType: 'claude',
        baseUrl: '/usr/bin/claude',
      } as any,
      llmProfileId: 'provider-1',
      providerType: 'claude',
      runId: 'run-1',
      sdkSessionId: 'sdk-prev',
      sendRunEvent: sendRunEventMock,
      serverPort: 3100,
      session: {
        id: 'session-1',
        project_id: 'project-1',
        name: 'Test Session',
        root_path: '/tmp/project',
        sdk_session_id: 'sdk-prev',
        session_type: 'background',
        working_directory: '/tmp/project',
        project_role: null,
        plan_status: null,
        task_id: null,
        llm_profile_id: 'provider-1',
        system_prompt: null,
      },
      sessionType: 'background',
      trace: trace as any,
      userMessageId: 'user-1',
      listeners,
    });

    expect(negotiateProfileMock).toHaveBeenCalled();
    expect(activeRun.effectiveProfile).toEqual(
      expect.objectContaining({
        llmProfileId: 'pcp-claude',
        sessionId: 'session-1',
      })
    );
    expect(sendRunEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run_started',
        runId: 'run-1',
        sessionId: 'session-1',
        clientRequestId: 'req-1',
        userMessageId: 'user-1',
        assistantMessageId: 'assistant-1',
        sessionType: 'background',
      })
    );
    expect(broadcastSessionCatalogUpdateMock).toHaveBeenCalled();
    expect(pluginEventsEmitMock).toHaveBeenCalledWith(
      'run.started',
      expect.objectContaining({
        runId: 'run-1',
        sessionId: 'session-1',
        llmProfileId: 'provider-1',
        providerType: 'claude',
      })
    );
    expect(runStartedListener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run.started',
        runId: 'run-1',
        sessionId: 'session-1',
        payload: expect.objectContaining({
          clientRequestId: 'req-1',
          assistantMessageId: 'assistant-1',
          userMessageId: 'user-1',
          sessionType: 'background',
          input: 'hello',
          llmProfileId: 'provider-1',
          providerType: 'claude',
        }),
      })
    );
    expect(sendRunEventMock).toHaveBeenCalledWith({
      type: 'background_task_update',
      sessionId: 'session-1',
      status: 'running',
    });
    expect(buildRunContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp/project',
        providerType: 'claude',
        sdkSessionId: 'sdk-prev',
        sessionType: 'background',
        providerConfig: expect.objectContaining({
          id: 'provider-1',
          providerType: 'claude',
        }),
      })
    );
    expect(adapter.run).toHaveBeenCalledWith(
      'processed hello',
      expect.objectContaining({
        cwd: '/tmp/project',
        mode: 'default',
        onAgentReady: expect.any(Function),
        onSteerConsumed: expect.any(Function),
      }),
      permissionCallback
    );
    expect(activeRun.providerType).toBe('claude');
    expect(activeRun.providerSessionId).toBe('sdk-1');
    expect(activeRun.providerCwd).toBe('/tmp/project');
    expect(trace.setMeta).toHaveBeenCalledWith({ provider: 'claude', cwd: '/tmp/project' });
    expect(result.providerRunner).toBeTruthy();
    unregisterPluginDomainEventListener();

    // onAgentReady mutates activeRun.steerHandle; onSteerConsumed clears
    // pendingSteers — verify both wirings work end-to-end through the closure.
    const runOptionsArg = (
      adapter.run as unknown as {
        mock: {
          calls: [
            string,
            { onAgentReady: (h: { steer: () => void }) => void; onSteerConsumed: () => void },
            unknown,
          ][];
        };
      }
    ).mock.calls[0][1];
    const fakeHandle = { steer: () => {} };
    runOptionsArg.onAgentReady(fakeHandle);
    expect(activeRun.steerHandle).toBe(fakeHandle);
    activeRun.pendingSteers.push({
      role: 'user',
      content: [{ type: 'text', text: 'x' }],
      timestamp: 0,
    } as never);
    runOptionsArg.onSteerConsumed();
    expect(activeRun.pendingSteers).toEqual([]);

    vi.advanceTimersByTime(5000);
    expect(upsertAssistantMessageMock).toHaveBeenCalledWith(activeRun);

    clearInterval(activeRun.saveInterval);
  });

  it('emits preflight compaction as a domain event before provider run starts', async () => {
    const { launchProviderRun } = await import('../run-provider-launch.js');
    const activeRun = {
      sessionId: 'session-1',
      assistantMessageId: 'assistant-1',
      pendingSteers: [],
      eventSeq: 0,
    } as any;
    const adapter = {
      run: vi.fn(() => providerStream()),
      getRunState: vi.fn(() => ({})),
    } as any;
    const sendRunEventMock = vi.fn();
    const listeners = new RunDomainEventListenerRegistry();
    const compactionCompletedListener = vi.fn();
    listeners.on('compaction.completed', compactionCompletedListener);
    maybeCompactMock.mockResolvedValueOnce({
      outcome: 'compacted',
      compacted: true,
      compactionId: 'compaction-1',
      tokensBefore: 1234,
    });

    await launchProviderRun({
      activeRun,
      adapter,
      agentProfile: {
        id: 'agent-1',
        name: 'Test Agent',
        model: 'sonnet',
        systemPrompt: 'agent system prompt',
        enabledTools: [],
      } as any,
      broadcastSessionCatalogUpdate: vi.fn(),
      client: { ws: {} as any } as any,
      cwd: '/tmp/project',
      db: {} as any,
      enabledTools: [],
      forcedPlanBySession: false,
      images: [],
      message: {
        type: 'run_start',
        sessionId: 'session-1',
        clientRequestId: 'req-1',
        input: 'hello',
      },
      modeValue: 'default',
      permissionCallback: vi.fn(),
      processedInput: 'processed hello',
      providerConfig: {
        id: 'provider-1',
        providerType: 'claude',
        baseUrl: '/usr/bin/claude',
      } as any,
      llmProfileId: 'provider-1',
      providerType: 'claude',
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      serverPort: 3100,
      session: {
        id: 'session-1',
        project_id: 'project-1',
        name: 'Test Session',
        root_path: '/tmp/project',
        sdk_session_id: null,
        session_type: 'regular',
        working_directory: '/tmp/project',
        project_role: null,
        plan_status: null,
        task_id: null,
        llm_profile_id: 'provider-1',
        system_prompt: null,
      },
      sessionType: 'regular',
      trace: { log: vi.fn(), setMeta: vi.fn() } as any,
      listeners,
    });

    expect(sendRunEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'compaction_completed',
        runId: 'run-1',
        sessionId: 'session-1',
        compactionId: 'compaction-1',
        tokensBefore: 1234,
      })
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
    expect(adapter.run).toHaveBeenCalled();

    clearInterval(activeRun.saveInterval);
  });

  it('uses the multimodal fallback profile and model for image runs before provider launch', async () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    const llmRepo = new LlmProfileRepository(db);
    const primary = llmRepo.create({
      name: 'Primary',
      providerType: 'openai',
      baseUrl: 'http://primary/v1',
      models: [{ modelId: 'primary-text', inputModalities: ['text'] }],
    });
    const fallback = llmRepo.create({
      name: 'Vision',
      providerType: 'openai',
      baseUrl: 'http://vision/v1',
      models: [{ modelId: 'vision-model', inputModalities: ['text', 'image'] }],
    });
    const { launchProviderRun } = await import('../run-provider-launch.js');
    const activeRun = {
      sessionId: 'session-1',
      assistantMessageId: 'assistant-1',
      pendingSteers: [],
      eventSeq: 0,
    } as any;
    const adapter = {
      run: vi.fn(() => providerStream()),
      getRunState: vi.fn(() => ({})),
    } as any;
    const sendRunEventMock = vi.fn();
    const listeners = new RunDomainEventListenerRegistry();
    const runStartedListener = vi.fn();
    listeners.on('run.started', runStartedListener);

    await launchProviderRun({
      activeRun,
      adapter,
      agentProfile: {
        id: 'agent-1',
        name: 'Test Agent',
        llmProfileId: primary.id,
        model: 'primary-text',
        systemPrompt: '',
        enabledTools: [],
        multimodalFallback: { llmProfileId: fallback.id, model: 'vision-model' },
      } as any,
      broadcastSessionCatalogUpdate: vi.fn(),
      client: { ws: {} as any } as any,
      cwd: '/tmp/project',
      db: db as any,
      enabledTools: [],
      forcedPlanBySession: false,
      images: [{ name: 'a.png', mimeType: 'image/png', data: 'abc' }],
      message: {
        type: 'run_start',
        sessionId: 'session-1',
        clientRequestId: 'req-1',
        input: 'look',
      },
      modeValue: 'default',
      permissionCallback: vi.fn(),
      processedInput: 'look',
      providerConfig: primary,
      llmProfileId: primary.id,
      providerType: primary.providerType,
      runId: 'run-1',
      sendRunEvent: sendRunEventMock,
      serverPort: 3100,
      session: {
        id: 'session-1',
        project_id: 'project-1',
        name: 'Test Session',
        root_path: '/tmp/project',
        sdk_session_id: null,
        session_type: 'regular',
        working_directory: '/tmp/project',
        project_role: null,
        plan_status: null,
        task_id: null,
      },
      sessionType: 'regular',
      trace: { log: vi.fn(), setMeta: vi.fn() } as any,
      listeners,
    });

    expect(buildRunContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfile: expect.objectContaining({
          llmProfileId: fallback.id,
          model: 'vision-model',
        }),
        providerConfig: expect.objectContaining({
          id: fallback.id,
          baseUrl: 'http://vision/v1',
        }),
        providerType: fallback.providerType,
      })
    );
    expect(runStartedListener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run.started',
        payload: expect.objectContaining({
          llmProfileId: fallback.id,
          providerType: fallback.providerType,
        }),
      })
    );
    expect(activeRun.agentProfile).toEqual(expect.objectContaining({ model: 'vision-model' }));
    expect(activeRun.llmProfile).toEqual(expect.objectContaining({ id: fallback.id }));

    clearInterval(activeRun.saveInterval);
  });

  it('persists MCP instructions delta before provider history is built', async () => {
    mcpListStatusesMock.mockReturnValue([
      {
        name: 'github',
        state: 'connected',
        hasInstructions: true,
        instructions: 'Use GitHub safely.',
      },
    ]);
    const inserted: unknown[][] = [];
    const db = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('SELECT metadata FROM messages')) {
          return { all: vi.fn(() => []) };
        }
        if (sql.includes('SELECT COALESCE(MAX(offset)')) {
          return { get: vi.fn(() => ({ nextOffset: 3 })) };
        }
        if (sql.includes('INSERT INTO messages')) {
          return { run: vi.fn((...args: unknown[]) => inserted.push(args)) };
        }
        return { run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) };
      }),
    };
    const { launchProviderRun } = await import('../run-provider-launch.js');
    const adapter = {
      run: vi.fn(() => providerStream()),
      getRunState: vi.fn(() => ({})),
    } as any;

    await launchProviderRun({
      activeRun: { assistantMessageId: 'assistant-1', pendingSteers: [] } as any,
      adapter,
      agentProfile: {
        id: 'agent-1',
        name: 'Agent',
        model: 'm',
        systemPrompt: '',
        enabledTools: [],
      } as any,
      broadcastSessionCatalogUpdate: vi.fn(),
      client: { ws: {} as any } as any,
      cwd: '/tmp/project',
      db: db as any,
      enabledTools: [],
      forcedPlanBySession: false,
      images: [],
      message: {
        type: 'run_start',
        sessionId: 'session-1',
        clientRequestId: 'req-1',
        input: 'hello',
      },
      modeValue: 'default',
      permissionCallback: vi.fn(),
      processedInput: 'hello',
      providerConfig: { id: 'provider-1', providerType: 'zclaudia' } as any,
      llmProfileId: 'provider-1',
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent: vi.fn(),
      serverPort: 3100,
      session: {
        id: 'session-1',
        project_id: 'project-1',
        name: 'Test Session',
        root_path: '/tmp/project',
        sdk_session_id: null,
        session_type: 'regular',
        working_directory: '/tmp/project',
        project_role: null,
        plan_status: null,
        task_id: null,
        llm_profile_id: 'provider-1',
        system_prompt: null,
      },
      sessionType: 'regular',
      trace: { log: vi.fn(), setMeta: vi.fn() } as any,
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0][2]).toContain('MCP server instructions updated');
    expect(JSON.parse(inserted[0][3] as string)).toEqual({
      type: 'mcp_instructions_delta',
      delta: expect.objectContaining({
        addedNames: ['github'],
        addedBlocks: ['## github\nUse GitHub safely.'],
        removedNames: [],
      }),
    });
    expect(adapter.run).toHaveBeenCalled();
  });

  it('loads direct slash skill before provider launch and runs provider with skill args', async () => {
    prepareDirectSkillInvocationMock.mockResolvedValueOnce({
      matched: true,
      ok: true,
      ref: { source: 'workspace', id: 'release-notes' },
      processedInput: 'ZOOM-1 Great feature',
      message: 'Loaded skill /release-notes for this turn.',
    });
    const { launchProviderRun } = await import('../run-provider-launch.js');
    const adapter = {
      run: vi.fn(() => providerStream()),
      getRunState: vi.fn(() => ({})),
    } as any;
    const activeRun = {
      assistantMessageId: 'assistant-1',
      pendingSteers: [],
      skillState: {
        discoverableSkills: [],
        pinnedSkills: [],
        loadedSkills: [],
        loadedSkillContents: {},
      },
    } as any;

    await launchProviderRun({
      activeRun,
      adapter,
      agentProfile: {
        id: 'agent-1',
        name: 'Agent',
        model: 'm',
        systemPrompt: '',
        enabledTools: [],
      } as any,
      broadcastSessionCatalogUpdate: vi.fn(),
      client: { ws: {} as any } as any,
      cwd: '/tmp/project',
      db: { prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) })) } as any,
      enabledTools: [],
      forcedPlanBySession: false,
      images: [],
      message: {
        type: 'run_start',
        sessionId: 'session-1',
        clientRequestId: 'req-1',
        input: '/release-notes ZOOM-1 Great feature',
      },
      modeValue: 'default',
      permissionCallback: vi.fn(),
      processedInput: '/release-notes ZOOM-1 Great feature',
      providerConfig: { id: 'provider-1', providerType: 'zclaudia' } as any,
      llmProfileId: 'provider-1',
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent: vi.fn(),
      serverPort: 3100,
      session: {
        id: 'session-1',
        project_id: 'project-1',
        name: 'Test Session',
        root_path: '/tmp/project',
        sdk_session_id: null,
        session_type: 'regular',
        working_directory: '/tmp/project',
        project_role: null,
        plan_status: null,
        task_id: null,
        llm_profile_id: 'provider-1',
        system_prompt: null,
      },
      sessionType: 'regular',
      trace: { log: vi.fn(), setMeta: vi.fn() } as any,
    });

    expect(prepareDirectSkillInvocationMock).toHaveBeenCalledWith(
      activeRun.skillState,
      '/release-notes ZOOM-1 Great feature',
      expect.objectContaining({ agentProfile: expect.any(Object) })
    );
    expect(adapter.run).toHaveBeenCalledWith(
      'ZOOM-1 Great feature',
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('completes locally and skips provider for direct model-only skill denial', async () => {
    prepareDirectSkillInvocationMock.mockResolvedValueOnce({
      matched: true,
      ok: false,
      error: 'skill_not_user_invocable',
      message: 'Skill model-only can only be invoked by the model.',
      ref: { source: 'workspace', id: 'model-only' },
    });
    const { launchProviderRun } = await import('../run-provider-launch.js');
    const adapter = {
      run: vi.fn(() => providerStream()),
      getRunState: vi.fn(() => ({})),
    } as any;
    const sendRunEvent = vi.fn();
    const activeRun = {
      assistantMessageId: 'assistant-1',
      pendingSteers: [],
      contentBlocks: [],
      fullContent: '',
      skillState: {
        discoverableSkills: [],
        pinnedSkills: [],
        loadedSkills: [],
        loadedSkillContents: {},
      },
      phase: 'running',
      phaseEmitter: { emit: vi.fn() },
    } as any;

    const result = await launchProviderRun({
      activeRun,
      adapter,
      agentProfile: {
        id: 'agent-1',
        name: 'Agent',
        model: 'm',
        systemPrompt: '',
        enabledTools: [],
      } as any,
      broadcastSessionCatalogUpdate: vi.fn(),
      client: { ws: {} as any } as any,
      cwd: '/tmp/project',
      db: { prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) })) } as any,
      enabledTools: [],
      forcedPlanBySession: false,
      images: [],
      message: {
        type: 'run_start',
        sessionId: 'session-1',
        clientRequestId: 'req-1',
        input: '/model-only',
      },
      modeValue: 'default',
      permissionCallback: vi.fn(),
      processedInput: '/model-only',
      providerConfig: { id: 'provider-1', providerType: 'zclaudia' } as any,
      llmProfileId: 'provider-1',
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent,
      serverPort: 3100,
      session: {
        id: 'session-1',
        project_id: 'project-1',
        name: 'Test Session',
        root_path: '/tmp/project',
        sdk_session_id: null,
        session_type: 'regular',
        working_directory: '/tmp/project',
        project_role: null,
        plan_status: null,
        task_id: null,
        llm_profile_id: 'provider-1',
        system_prompt: null,
      },
      sessionType: 'regular',
      trace: { log: vi.fn(), setMeta: vi.fn() } as any,
    });

    expect(adapter.run).not.toHaveBeenCalled();
    expect(activeRun.fullContent).toContain('can only be invoked by the model');
    expect(upsertAssistantMessageMock).toHaveBeenCalledWith(activeRun, { indexMetadata: true });
    expect(sendRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'delta',
        content: expect.stringContaining('can only be invoked by the model'),
      })
    );
    expect(sendRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run_completed',
        runId: 'run-1',
        sessionId: 'session-1',
      })
    );
    expect(result.providerRunner).toBeTruthy();
  });

  it('executes direct fork slash skill locally and skips provider launch', async () => {
    prepareDirectSkillInvocationMock.mockResolvedValueOnce({
      matched: true,
      ok: true,
      mode: 'fork',
      ref: { source: 'workspace', id: 'security-audit' },
      task: 'auth changes',
      args: 'auth changes',
      message: 'Running skill /security-audit.',
    });
    executePreparedDirectSkillInvocationMock.mockResolvedValueOnce({
      ok: true,
      mode: 'fork',
      ref: { source: 'workspace', id: 'security-audit' },
      result: 'Fork result: reviewed auth changes.',
    });
    const { launchProviderRun } = await import('../run-provider-launch.js');
    const adapter = {
      run: vi.fn(() => providerStream()),
      getRunState: vi.fn(() => ({})),
    } as any;
    const sendRunEvent = vi.fn();
    const activeRun = {
      assistantMessageId: 'assistant-1',
      pendingSteers: [],
      contentBlocks: [],
      fullContent: '',
      skillState: {
        discoverableSkills: [],
        pinnedSkills: [],
        loadedSkills: [],
        loadedSkillContents: {},
      },
      phase: 'running',
      phaseEmitter: { emit: vi.fn() },
    } as any;

    await launchProviderRun({
      activeRun,
      adapter,
      agentProfile: {
        id: 'agent-1',
        name: 'Agent',
        model: 'm',
        systemPrompt: '',
        enabledTools: [],
      } as any,
      broadcastSessionCatalogUpdate: vi.fn(),
      client: { ws: {} as any } as any,
      cwd: '/tmp/project',
      db: { prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) })) } as any,
      enabledTools: ['Read', 'Grep', 'Write'],
      forcedPlanBySession: false,
      images: [],
      message: {
        type: 'run_start',
        sessionId: 'session-1',
        clientRequestId: 'req-1',
        input: '/security-audit auth changes',
      },
      modeValue: 'default',
      permissionCallback: vi.fn(),
      processedInput: '/security-audit auth changes',
      providerConfig: { id: 'provider-1', providerType: 'zclaudia' } as any,
      llmProfileId: 'provider-1',
      providerType: 'zclaudia',
      runId: 'run-1',
      sendRunEvent,
      serverPort: 3100,
      session: {
        id: 'session-1',
        project_id: 'project-1',
        name: 'Test Session',
        root_path: '/tmp/project',
        sdk_session_id: null,
        session_type: 'regular',
        working_directory: '/tmp/project',
        project_role: null,
        plan_status: null,
        task_id: null,
        llm_profile_id: 'provider-1',
        system_prompt: null,
      },
      sessionType: 'regular',
      trace: { log: vi.fn(), setMeta: vi.fn() } as any,
    });

    expect(adapter.run).not.toHaveBeenCalled();
    expect(executePreparedDirectSkillInvocationMock).toHaveBeenCalledWith(
      activeRun.skillState,
      expect.objectContaining({ mode: 'fork', ref: { source: 'workspace', id: 'security-audit' } }),
      expect.objectContaining({
        cwd: '/tmp/project',
        enabledTools: ['Read', 'Grep', 'Write'],
        agentProfile: expect.any(Object),
        llmProfileConfig: expect.any(Object),
        permissionCallback: expect.any(Function),
      })
    );
    expect(activeRun.fullContent).toBe('Fork result: reviewed auth changes.');
    expect(sendRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'delta',
        content: 'Fork result: reviewed auth changes.',
      })
    );
    expect(sendRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run_completed',
        runId: 'run-1',
        sessionId: 'session-1',
      })
    );
    expect(upsertAssistantMessageMock).toHaveBeenCalledWith(activeRun, { indexMetadata: true });
  });
});
