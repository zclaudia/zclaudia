import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DEFAULT_UNIFIED_POLICY } from '@zclaudia/shared/interaction/permissions';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import {
  createWorkflowAgentPermissionCallbackFactory,
} from '../step-executors/workflow-agent-permissions.js';
import type { AgentLoopPermissionDecision } from '../../agent-loop/index.js';

describe('createWorkflowAgentPermissionCallbackFactory', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
  });

  it('allows policy-approved tool calls', async () => {
    const callback = createWorkflowAgentPermissionCallbackFactory({ db })({
      projectId: undefined,
      runId: 'run-1',
      cwd: '/repo',
      purpose: 'workflow.ai_prompt',
    });

    await expect(callback!({
      requestId: 'req-1',
      toolName: 'Read',
      toolInput: { path: 'README.md' },
      detail: 'README.md',
      timeoutSeconds: 0,
    })).resolves.toEqual({ behavior: 'allow' });
  });

  it('delegates escalated tool calls to the permission workflow', async () => {
    db.prepare('UPDATE agent_config SET permission_policy = ? WHERE id = 1').run(JSON.stringify({
      ...DEFAULT_UNIFIED_POLICY,
      customRules: [{ toolName: 'Bash', action: 'escalate' }],
    }));

    let resolvePermission!: (decision: AgentLoopPermissionDecision) => void;
    const permissionBridge = {
      register: vi.fn((_requestId: string, resolve: typeof resolvePermission) => {
        resolvePermission = resolve;
      }),
      setWorkflowRunId: vi.fn(),
      resolvePermission: vi.fn(),
      getPermissionContext: vi.fn(),
      remove: vi.fn(),
    };
    const permissionWorkflowResolver = {
      triggerPermissionEscalation: vi.fn(async () => ({
        resolved: { workflowId: 'wf-1' },
        run: { id: 'wf-run-1' },
      })),
    };

    const callback = createWorkflowAgentPermissionCallbackFactory({
      db,
      permissionBridge,
      getPermissionWorkflowResolver: () => permissionWorkflowResolver as never,
    })({
      projectId: 'project-1',
      runId: 'run-1',
      cwd: '/repo',
      purpose: 'workflow.ai_prompt',
    });

    const decisionPromise = callback!({
      requestId: 'req-1',
      toolName: 'Bash',
      toolInput: { command: 'npm publish' },
      detail: 'npm publish',
      timeoutSeconds: 0,
    });

    await vi.waitFor(() => {
      expect(permissionBridge.register).toHaveBeenCalledWith(
        'req-1',
        expect.any(Function),
        expect.objectContaining({
          category: expect.any(String),
          requestId: 'req-1',
          runId: 'run-1',
          sessionId: 'run-1',
          toolName: 'Bash',
        }),
      );
      expect(permissionWorkflowResolver.triggerPermissionEscalation).toHaveBeenCalledWith('project-1', expect.objectContaining({
        eventPayload: expect.objectContaining({
          requestId: 'req-1',
          toolName: 'Bash',
        }),
      }));
    });

    resolvePermission({ behavior: 'allow', updatedInput: { command: 'npm publish' } });

    await expect(decisionPromise).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { command: 'npm publish' },
    });
    expect(permissionBridge.setWorkflowRunId).toHaveBeenCalledWith('req-1', 'wf-run-1');
  });
});
