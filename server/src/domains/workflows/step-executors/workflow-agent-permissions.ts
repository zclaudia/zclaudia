import type Database from 'better-sqlite3';
import { DEFAULT_UNIFIED_POLICY } from '@zclaudia/shared/interaction/permissions';
import type { PermissionRequest } from '@zclaudia/shared/interaction/permissions';
import type { PermissionBridgePort } from '../ports/step-executor.js';
import type { AgentLoopPermissionCallback, AgentLoopPermissionDecision } from '../../agent-loop/index.js';
import type { PermissionWorkflowResolver } from '../permission-workflow-resolver.js';
import { providerRegistry } from '../../../infra/providers/registry.js';
import {
  classify,
  getAgentPermissionPolicy,
  getMatchedPermissionRule,
  getProjectPermissionOverride,
  mergePolicy,
  PermissionEvaluator,
} from '../../../application/conversation/agent/permission-evaluator.js';

type PolicyDb = Parameters<typeof getAgentPermissionPolicy>[0];
const DEFAULT_WORKFLOW_PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;
const WORKFLOW_PERMISSION_POLL_MS = 250;
const TERMINAL_WORKFLOW_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export interface WorkflowAgentPermissionContext {
  projectId?: string;
  runId: string;
  cwd: string;
  purpose: string;
  providerType?: string;
}

export interface WorkflowAgentPermissionDeps {
  db: Database.Database;
  permissionBridge?: PermissionBridgePort;
  getPermissionWorkflowResolver?: () => PermissionWorkflowResolver | undefined;
  workflowDecisionTimeoutMs?: number;
  workflowDecisionPollMs?: number;
}

export type WorkflowAgentPermissionCallbackFactory = (
  context: WorkflowAgentPermissionContext
) => AgentLoopPermissionCallback | undefined;

export function createWorkflowAgentPermissionCallbackFactory(
  deps: WorkflowAgentPermissionDeps,
): WorkflowAgentPermissionCallbackFactory {
  return (context) => async (request) => {
    let policy = mergePolicy(
      getAgentPermissionPolicy(deps.db as unknown as PolicyDb) ?? DEFAULT_UNIFIED_POLICY,
      context.projectId ? getProjectPermissionOverride(deps.db as unknown as PolicyDb, context.projectId) : null,
    );
    const providerEscalateTools = context.providerType
      ? providerRegistry.getPolicy(context.providerType)?.escalateAlwaysTools
      : undefined;
    if (providerEscalateTools?.length) {
      policy = {
        ...policy,
        escalateAlways: [...new Set([...(policy.escalateAlways ?? []), ...providerEscalateTools])],
      };
    }
    const evaluator = new PermissionEvaluator();
    const result = evaluator.evaluate(request.toolName, request.toolInput, request.detail, policy, {
      rootPath: context.cwd,
    });

    if (result === 'approve') {
      return { behavior: 'allow' };
    }

    if (result === 'deny') {
      return { behavior: 'deny', message: 'Denied by workflow permission policy' };
    }

    return await escalateWorkflowPermission({
      context,
      deps,
      policy,
      request,
    });
  };
}

async function escalateWorkflowPermission(input: {
  context: WorkflowAgentPermissionContext;
  deps: WorkflowAgentPermissionDeps;
  policy: ReturnType<typeof mergePolicy>;
  request: PermissionRequest;
}): Promise<AgentLoopPermissionDecision> {
  const { context, deps, policy, request } = input;
  const resolver = deps.getPermissionWorkflowResolver?.();
  if (!deps.permissionBridge || !resolver) {
    return {
      behavior: 'deny',
      message: 'Workflow permission escalation is not configured',
    };
  }

  const category = classify(request.toolName, request.toolInput, request.detail);
  const matchedRule = getMatchedPermissionRule(request.toolName, request.toolInput, request.detail, policy, {
    rootPath: context.cwd,
  }) ?? undefined;

  return await new Promise<AgentLoopPermissionDecision>((resolve) => {
    let settled = false;
    let poll: NodeJS.Timeout | undefined;
    let timeout: NodeJS.Timeout | undefined;
    const finish = (decision: AgentLoopPermissionDecision) => {
      if (settled) return;
      settled = true;
      if (poll) clearInterval(poll);
      if (timeout) clearTimeout(timeout);
      resolve(decision);
    };

    deps.permissionBridge!.register(request.requestId, finish, {
      requestId: request.requestId,
      runId: context.runId,
      sessionId: context.runId,
      toolName: request.toolName,
      toolInput: asRecord(request.toolInput),
      detail: request.detail,
      cwd: context.cwd,
      category,
      matchedRule,
      isEscalateAlways: policy.escalateAlways?.includes(request.toolName) ?? false,
      sessionType: 'background',
    });

    timeout = setTimeout(() => {
      deps.permissionBridge?.remove(request.requestId);
      finish({
        behavior: 'deny',
        message: 'Workflow permission escalation timed out',
      });
    }, deps.workflowDecisionTimeoutMs ?? DEFAULT_WORKFLOW_PERMISSION_TIMEOUT_MS);
    timeout.unref?.();

    void resolver.triggerPermissionEscalation(context.projectId, {
      eventPayload: {
        requestId: request.requestId,
        runId: context.runId,
        sessionId: context.runId,
        toolName: request.toolName,
        toolInput: asRecord(request.toolInput),
        detail: request.detail,
        cwd: context.cwd,
        category,
        matchedRule,
        isEscalateAlways: policy.escalateAlways?.includes(request.toolName) ?? false,
        sessionType: 'background',
      },
      triggerContext: {
        type: 'event',
        event: 'permission.escalated',
      },
    }).then(({ run }) => {
      deps.permissionBridge?.setWorkflowRunId(request.requestId, run.id);
      if (settled) return;
      poll = setInterval(() => {
        if (settled) return;
        let detail: ReturnType<PermissionWorkflowResolver['getRun']>;
        try {
          detail = resolver.getRun(run.id);
        } catch (error) {
          deps.permissionBridge?.remove(request.requestId);
          finish({
            behavior: 'deny',
            message: error instanceof Error ? error.message : 'Permission workflow status lookup failed',
          });
          return;
        }
        const status = detail?.run.status;
        if (status && TERMINAL_WORKFLOW_RUN_STATUSES.has(status)) {
          deps.permissionBridge?.remove(request.requestId);
          finish({
            behavior: 'deny',
            message: `Permission workflow completed without a decision (${status})`,
          });
        }
      }, deps.workflowDecisionPollMs ?? WORKFLOW_PERMISSION_POLL_MS);
      poll.unref?.();
    }).catch((error) => {
      deps.permissionBridge?.remove(request.requestId);
      finish({
        behavior: 'deny',
        message: error instanceof Error ? error.message : 'Workflow permission escalation failed',
      });
    });
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { value };
}
