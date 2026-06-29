import type Database from 'better-sqlite3';
import { DEFAULT_UNIFIED_POLICY } from '@zclaudia/shared/interaction/permissions';
import type { PermissionRequest } from '@zclaudia/shared/interaction/permissions';
import type { PermissionBridgePort } from '../ports/step-executor.js';
import type { AgentLoopPermissionCallback, AgentLoopPermissionDecision } from '../../agent-loop/index.js';
import type { PermissionWorkflowResolver } from '../permission-workflow-resolver.js';
import {
  classify,
  getAgentPermissionPolicy,
  getMatchedPermissionRule,
  getProjectPermissionOverride,
  mergePolicy,
  PermissionEvaluator,
} from '../../../application/conversation/agent/permission-evaluator.js';

type PolicyDb = Parameters<typeof getAgentPermissionPolicy>[0];

export interface WorkflowAgentPermissionContext {
  projectId?: string;
  runId: string;
  cwd: string;
  purpose: string;
}

export interface WorkflowAgentPermissionDeps {
  db: Database.Database;
  permissionBridge?: PermissionBridgePort;
  getPermissionWorkflowResolver?: () => PermissionWorkflowResolver | undefined;
}

export type WorkflowAgentPermissionCallbackFactory = (
  context: WorkflowAgentPermissionContext
) => AgentLoopPermissionCallback | undefined;

export function createWorkflowAgentPermissionCallbackFactory(
  deps: WorkflowAgentPermissionDeps,
): WorkflowAgentPermissionCallbackFactory {
  return (context) => async (request) => {
    const policy = mergePolicy(
      getAgentPermissionPolicy(deps.db as unknown as PolicyDb) ?? DEFAULT_UNIFIED_POLICY,
      context.projectId ? getProjectPermissionOverride(deps.db as unknown as PolicyDb, context.projectId) : null,
    );
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
    deps.permissionBridge!.register(request.requestId, resolve, {
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
    }).catch((error) => {
      deps.permissionBridge?.remove(request.requestId);
      resolve({
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
