import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPermissionCallback } from '../run-permissions.js';
import { PhaseEmitter } from '../active-run-phase.js';
import { RunDomainEventListenerRegistry } from '../run-domain-event-listeners.js';

async function shortRace<T>(promise: Promise<T>): Promise<T | 'pending'> {
  return Promise.race([
    promise,
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 5)),
  ]);
}

const {
  broadcastRunMessageMock,
  normalizeFromAskUserMock,
  permissionEvaluatorEvaluateMock,
  evaluateMcpToolTrustPolicyMock,
  getAgentPermissionPolicyMock,
  writePermissionLogMock,
  permissionWorkflowResolverMock,
  mcpInventoryCacheMock,
} = vi.hoisted(() => ({
  broadcastRunMessageMock: vi.fn(),
  normalizeFromAskUserMock: vi.fn(),
  permissionEvaluatorEvaluateMock: vi.fn(() => 'ask'),
  evaluateMcpToolTrustPolicyMock: vi.fn(() => 'escalate'),
  getAgentPermissionPolicyMock: vi.fn(() => ({
    enabled: false,
    profile: {
      fileRead: 'ask',
      fileWrite: 'ask',
      shellSafe: 'ask',
      networkOps: 'ask',
      destructiveOps: 'ask',
      userQuestions: 'ask',
    },
    globalGuards: {
      blockSensitiveFiles: true,
      blockOutsideWorkspace: true,
    },
    customRules: [],
    escalateAlways: [],
    aiReview: {
      enabled: true,
      timeoutBeforeReview: 60,
      confidenceThreshold: 0.8,
      maxAutoApprovalsPerMinute: 10,
    },
  })),
  writePermissionLogMock: vi.fn(),
  permissionWorkflowResolverMock: {
    triggerPermissionEscalation: vi.fn(async () => ({
      resolved: { workflowId: 'wf-system', source: 'system_fallback' },
      run: { id: 'wf-run-1' },
    })),
  },
  mcpInventoryCacheMock: {
    configHash: vi.fn(() => 'hash-1'),
    getCached: vi.fn(),
  },
}));

vi.mock('../../transport/broadcast.js', () => ({
  broadcastRunMessage: broadcastRunMessageMock,
}));

vi.mock('../../interactions/interaction-normalizer.js', () => ({
  normalizeFromAskUser: normalizeFromAskUserMock,
}));

vi.mock('../../agent/permission-log-writer.js', () => ({
  writePermissionLog: writePermissionLogMock,
}));

vi.mock('../../agent/permission-evaluator.js', () => ({
  buildRememberKey: vi.fn(() => 'remember-key'),
  classify: vi.fn(() => 'destructiveOps'),
  extractBashCommand: vi.fn(() => 'grep -n "foo" /tmp/outside/file'),
  getAgentPermissionPolicy: getAgentPermissionPolicyMock,
  getMatchedPermissionRule: vi.fn(() => 'Outside workspace access'),
  getOutsideWorkspacePaths: vi.fn(() => ['/tmp/outside/file']),
  getProjectPermissionOverride: vi.fn(() => undefined),
  isInternalInteractionTool: vi.fn(() => false),
  isOutsideWorkspacePathAllowed: vi.fn(() => false),
  mergePolicy: vi.fn((globalPolicy) => globalPolicy),
  normalizePolicy: vi.fn((policy) => policy),
  evaluateMcpToolTrustPolicy: evaluateMcpToolTrustPolicyMock,
  PermissionEvaluator: class {
    evaluate(...args: unknown[]) {
      return permissionEvaluatorEvaluateMock(...args);
    }
  },
  resolveRememberedDecision: vi.fn(() => undefined),
}));

vi.mock('../../../../utils/mcp-inventory-cache.js', () => ({
  mcpInventoryCache: mcpInventoryCacheMock,
}));

vi.mock('../../../../utils/server-utils.js', () => ({
  isBashLikeTool: vi.fn(() => true),
  isSudoCommand: vi.fn(() => false),
}));

function createInput() {
  const dbPrepare = vi.fn((sql: string) => ({
    run: vi.fn(),
    get: vi.fn(() => {
      if (sql.includes('FROM mcp_servers')) {
        return {
          name: 'github',
          command: 'node',
          args: '[]',
          env: null,
          enabled: 1,
          trust_policy: JSON.stringify({
            trustLevel: 'trusted-readonly',
            trustReadOnlyHint: true,
            defaultRiskAction: 'ask',
            riskActions: { high: 'deny' },
          }),
        };
      }
      return undefined;
    }),
  }));
  return {
    activeRun: {
      rememberedDecisions: new Map(),
      allowedOutsideWorkspaceRoots: new Set(),
      pendingPermissions: new Map(),
      workspaceRoot: '/Users/test/workspace',
      phase: 'running' as const,
      phaseEmitter: new PhaseEmitter(),
      runId: 'run-1',
    },
    cwd: '/Users/test/workspace',
    db: { prepare: dbPrepare },
    forcedPlanBySession: false,
    markPendingResolutionResumed: vi.fn(),
    message: { sessionId: 'session-1' },
    modeValue: 'default',
    notificationService: { notify: vi.fn(async () => {}) },
    permissionBridge: { register: vi.fn(), setWorkflowRunId: vi.fn() },
    permissionWorkflowResolver: permissionWorkflowResolverMock,
    providerType: 'zclaudia',
    runId: 'run-1',
    sendRunEvent: vi.fn(),
    session: { project_id: 'project-1' },
    sessionType: 'regular' as const,
  };
}

describe('createPermissionCallback workflow routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAgentPermissionPolicyMock.mockReturnValue({
      enabled: false,
      profile: {
        fileRead: 'ask',
        fileWrite: 'ask',
        shellSafe: 'ask',
        networkOps: 'ask',
        destructiveOps: 'ask',
        userQuestions: 'ask',
      },
      globalGuards: {
        blockSensitiveFiles: true,
        blockOutsideWorkspace: true,
      },
      customRules: [],
      escalateAlways: [],
      aiReview: {
        enabled: true,
        timeoutBeforeReview: 60,
        confidenceThreshold: 0.8,
        maxAutoApprovalsPerMinute: 10,
      },
    });
    permissionWorkflowResolverMock.triggerPermissionEscalation.mockResolvedValue({
      resolved: { workflowId: 'wf-system', source: 'system_fallback' },
      run: { id: 'wf-run-1' },
    });
    permissionEvaluatorEvaluateMock.mockReturnValue('ask');
    evaluateMcpToolTrustPolicyMock.mockReturnValue('escalate');
    mcpInventoryCacheMock.getCached.mockReturnValue({
      tools: [{
        name: 'read_issue',
        annotations: { readOnlyHint: true, openWorldHint: false },
        inputSchema: { type: 'object' },
      }],
    });
  });

  it('auto-approves readonly MCP tools when trusted by server policy', async () => {
    evaluateMcpToolTrustPolicyMock.mockReturnValue('approve');
    const listeners = new RunDomainEventListenerRegistry();
    const autoResolvedListener = vi.fn();
    listeners.on('permission.autoResolved', autoResolvedListener);
    const input = { ...createInput(), listeners };
    const callback = createPermissionCallback(input as any);

    const decision = await shortRace(callback({
      requestId: 'mcp-approve-1',
      toolName: 'mcp__github__read_issue',
      toolInput: { id: '1' },
      detail: '{"id":"1"}',
      timeoutSeconds: 0,
    }));

    expect(decision).toEqual({ behavior: 'allow', updatedInput: { id: '1' } });
    expect(autoResolvedListener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'permission.autoResolved',
      runId: 'run-1',
      sessionId: 'session-1',
      payload: {
        requestId: 'mcp-approve-1',
        behavior: 'allow',
        reason: 'Auto-approved by MCP trust policy',
      },
    }));
    expect(evaluateMcpToolTrustPolicyMock).toHaveBeenCalledWith(
      expect.objectContaining({ declaredReadOnly: true, riskLevel: 'medium' }),
      expect.objectContaining({ trustLevel: 'trusted-readonly' }),
    );
    expect(permissionEvaluatorEvaluateMock).not.toHaveBeenCalled();
    expect(permissionWorkflowResolverMock.triggerPermissionEscalation).not.toHaveBeenCalled();
    expect(broadcastRunMessageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'agent_permission_intercepted',
        toolName: 'mcp__github__read_issue',
        decision: 'approve',
        reason: expect.stringContaining('MCP trust policy'),
        mcpTrust: expect.objectContaining({
          server: 'github',
          tool: 'read_issue',
          policyDecision: 'approve',
        }),
      }),
    );
  });

  it('denies MCP tools blocked by server trust policy', async () => {
    mcpInventoryCacheMock.getCached.mockReturnValue({
      tools: [{
        name: 'delete_issue',
        annotations: { destructiveHint: true },
        inputSchema: { type: 'object' },
      }],
    });
    evaluateMcpToolTrustPolicyMock.mockReturnValue('deny');
    const callback = createPermissionCallback(createInput() as any);

    const decision = await shortRace(callback({
      requestId: 'mcp-deny-1',
      toolName: 'mcp__github__delete_issue',
      toolInput: { id: '1' },
      detail: '{"id":"1"}',
      timeoutSeconds: 0,
    }));

    expect(decision).not.toBe('pending');
    if (decision === 'pending') return;
    expect(decision.behavior).toBe('deny');
    expect(decision.message).toContain('MCP trust policy');
    expect(permissionEvaluatorEvaluateMock).not.toHaveBeenCalled();
    expect(permissionWorkflowResolverMock.triggerPermissionEscalation).not.toHaveBeenCalled();
    expect(writePermissionLogMock).toHaveBeenCalledWith(
      expect.anything(),
      'session-1',
      'mcp__github__delete_issue',
      '{"id":"1"}',
      'deny',
      false,
      expect.objectContaining({
        server: 'github',
        tool: 'delete_issue',
        policyDecision: 'deny',
      }),
    );
  });

  it('triggers the resolved permission workflow and marks the request as workflow mode', async () => {
    const input = createInput() as any;
    const listeners = new RunDomainEventListenerRegistry();
    const requestedListener = vi.fn();
    listeners.on('permission.requested', requestedListener);
    input.listeners = listeners;
    const callback = createPermissionCallback(input);

    void callback({
      requestId: 'req-1',
      toolName: 'Bash',
      toolInput: { command: 'grep -n "foo" /tmp/outside/file' },
      detail: 'grep -n "foo" /tmp/outside/file',
      timeoutSeconds: 0,
    });

    expect(permissionWorkflowResolverMock.triggerPermissionEscalation).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        eventPayload: expect.objectContaining({
          requestId: 'req-1',
          toolName: 'Bash',
          aiReview: expect.objectContaining({
            enabled: false,
            confidenceThreshold: 0.8,
            maxAutoApprovalsPerMinute: 10,
          }),
        }),
      }),
    );
    expect(broadcastRunMessageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'permission_request',
        requestId: 'req-1',
        workflowMode: true,
      }),
    );
    expect(requestedListener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'permission.requested',
      runId: 'run-1',
      sessionId: 'session-1',
      payload: {
        requestId: 'req-1',
        toolName: 'Bash',
      },
    }));
    await Promise.resolve();
    expect(input.permissionBridge.setWorkflowRunId).toHaveBeenCalledWith('req-1', 'wf-run-1');
  });

  it('passes effective AI review settings to the permission workflow payload', () => {
    getAgentPermissionPolicyMock.mockReturnValue({
      enabled: true,
      profile: {
        fileRead: 'ask',
        fileWrite: 'ask',
        shellSafe: 'ask',
        networkOps: 'ask',
        destructiveOps: 'ask',
        userQuestions: 'ask',
      },
      globalGuards: {
        blockSensitiveFiles: true,
        blockOutsideWorkspace: true,
      },
      customRules: [],
      escalateAlways: [],
      aiReview: {
        enabled: true,
        timeoutBeforeReview: 25,
        confidenceThreshold: 0.93,
        maxAutoApprovalsPerMinute: 2,
        analysisLlmProfileId: 'review-profile',
      },
    });
    const callback = createPermissionCallback(createInput() as any);

    void callback({
      requestId: 'req-ai-review',
      toolName: 'Bash',
      toolInput: { command: 'npm test' },
      detail: 'npm test',
      timeoutSeconds: 0,
    });

    expect(permissionWorkflowResolverMock.triggerPermissionEscalation).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        eventPayload: expect.objectContaining({
          requestId: 'req-ai-review',
          aiReview: {
            enabled: true,
            timeoutBeforeReview: 25,
            confidenceThreshold: 0.93,
            maxAutoApprovalsPerMinute: 2,
            analysisLlmProfileId: 'review-profile',
          },
        }),
      }),
    );
  });

  it('keeps manual approval available if workflow triggering fails', async () => {
    permissionWorkflowResolverMock.triggerPermissionEscalation.mockRejectedValue(new Error('boom'));
    const callback = createPermissionCallback(createInput() as any);

    void callback({
      requestId: 'req-2',
      toolName: 'Bash',
      toolInput: { command: 'grep -n "foo" /tmp/outside/file' },
      detail: 'grep -n "foo" /tmp/outside/file',
      timeoutSeconds: 0,
    });

    expect(broadcastRunMessageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'permission_request',
        requestId: 'req-2',
        workflowMode: true,
      }),
    );
  });

  it('keeps AskUserQuestion waiting for user answer and does not delegate to permission workflow', () => {
    normalizeFromAskUserMock.mockReturnValue({
      type: 'interaction_prompt',
      interactionId: 'question-1',
      sessionId: 'session-1',
      source: 'provider_native',
      createdAt: 123,
      title: 'Question',
      fields: [],
      responseMode: 'prompt_answer',
    });
    const input = createInput() as any;
    const listeners = new RunDomainEventListenerRegistry();
    const promptRequestedListener = vi.fn();
    listeners.on('interaction.promptRequested', promptRequestedListener);
    input.listeners = listeners;
    const callback = createPermissionCallback(input);
    permissionEvaluatorEvaluateMock.mockReturnValue('approve');

    void callback({
      requestId: 'question-1',
      toolName: 'AskUserQuestion',
      toolInput: {
        questions: [{
          question: 'Continue?',
          options: [{ label: 'Yes', description: 'Proceed' }],
        }],
      },
      detail: '{"questions":[{"question":"Continue?"}]}',
      timeoutSeconds: 0,
    });

    expect(permissionWorkflowResolverMock.triggerPermissionEscalation).not.toHaveBeenCalled();
    expect(permissionEvaluatorEvaluateMock).not.toHaveBeenCalled();
    expect(input.permissionBridge.register).not.toHaveBeenCalled();
    expect(input.activeRun.pendingPermissions.has('question-1')).toBe(true);
    expect(input.sendRunEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'interaction_prompt',
      interactionId: 'question-1',
      responseMode: 'prompt_answer',
    }));
    expect(promptRequestedListener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'interaction.promptRequested',
      runId: 'run-1',
      sessionId: 'session-1',
      payload: {
        interactionId: 'question-1',
        title: 'Question',
      },
    }));
  });
});
