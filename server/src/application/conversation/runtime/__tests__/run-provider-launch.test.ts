import { beforeEach, describe, expect, it, vi } from 'vitest';

const buildRunContextMock = vi.fn();
const negotiateProfileMock = vi.fn();
const upsertAssistantMessageMock = vi.fn();
const pluginEventsEmitMock = vi.fn(async () => {});
const mcpListStatusesMock = vi.fn();

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
      message: {
        type: 'run_start',
        sessionId: 'session-1',
        clientRequestId: 'req-1',
        input: 'hello',
      },
      modeValue: 'default',
      permissionCallback,
      processedInput: 'processed hello',
      providerConfig: { id: 'provider-1', providerType: 'claude', baseUrl: '/usr/bin/claude' } as any,
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
    });

    expect(negotiateProfileMock).toHaveBeenCalled();
    expect(activeRun.effectiveProfile).toEqual(expect.objectContaining({
      llmProfileId: 'pcp-claude',
      sessionId: 'session-1',
    }));
    expect(sendRunEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'run_started',
      runId: 'run-1',
      sessionId: 'session-1',
      clientRequestId: 'req-1',
      userMessageId: 'user-1',
      assistantMessageId: 'assistant-1',
      sessionType: 'background',
    }));
    expect(broadcastSessionCatalogUpdateMock).toHaveBeenCalled();
    expect(pluginEventsEmitMock).toHaveBeenCalledWith('run.started', expect.objectContaining({
      runId: 'run-1',
      sessionId: 'session-1',
      llmProfileId: 'provider-1',
      providerType: 'claude',
    }));
    expect(sendRunEventMock).toHaveBeenCalledWith({
      type: 'background_task_update',
      sessionId: 'session-1',
      status: 'running',
    });
    expect(buildRunContextMock).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/tmp/project',
      providerType: 'claude',
      sdkSessionId: 'sdk-prev',
      sessionType: 'background',
      providerConfig: expect.objectContaining({
        id: 'provider-1',
        providerType: 'claude',
      }),
    }));
    expect(adapter.run).toHaveBeenCalledWith(
      'processed hello',
      expect.objectContaining({
        cwd: '/tmp/project',
        mode: 'default',
        onAgentReady: expect.any(Function),
        onSteerConsumed: expect.any(Function),
      }),
      permissionCallback,
    );
    expect(activeRun.providerType).toBe('claude');
    expect(activeRun.providerSessionId).toBe('sdk-1');
    expect(activeRun.providerCwd).toBe('/tmp/project');
    expect(trace.setMeta).toHaveBeenCalledWith({ provider: 'claude', cwd: '/tmp/project' });
    expect(result.providerRunner).toBeTruthy();

    // onAgentReady mutates activeRun.steerHandle; onSteerConsumed clears
    // pendingSteers — verify both wirings work end-to-end through the closure.
    const runOptionsArg = (adapter.run as unknown as { mock: { calls: [string, { onAgentReady: (h: { steer: () => void }) => void; onSteerConsumed: () => void }, unknown][] } }).mock.calls[0][1];
    const fakeHandle = { steer: () => {} };
    runOptionsArg.onAgentReady(fakeHandle);
    expect(activeRun.steerHandle).toBe(fakeHandle);
    activeRun.pendingSteers.push({ role: 'user', content: [{ type: 'text', text: 'x' }], timestamp: 0 } as never);
    runOptionsArg.onSteerConsumed();
    expect(activeRun.pendingSteers).toEqual([]);

    vi.advanceTimersByTime(5000);
    expect(upsertAssistantMessageMock).toHaveBeenCalledWith(activeRun);

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
      agentProfile: { id: 'agent-1', name: 'Agent', model: 'm', systemPrompt: '', enabledTools: [] } as any,
      broadcastSessionCatalogUpdate: vi.fn(),
      client: { ws: {} as any } as any,
      cwd: '/tmp/project',
      db: db as any,
      enabledTools: [],
      forcedPlanBySession: false,
      message: { type: 'run_start', sessionId: 'session-1', clientRequestId: 'req-1', input: 'hello' },
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
});
