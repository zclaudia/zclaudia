/**
 * Step Executor Port — domain interface for workflow step execution.
 *
 * Implementations live in ../step-executors/ (infrastructure layer).
 * The engine depends only on this interface, never on concrete executors.
 */

import type { WorkflowNodeDef } from '@zclaudia/shared/features/workflows';
import type { AIReviewConfig } from '@zclaudia/shared/interaction/permissions';
import type { UserHookDefinition } from '@zclaudia/shared/interaction/user-hooks';
export type { AgentLoopPermissionCallback, AgentLoopPermissionDecision, AgentLoopRunnerPort } from '../../agent-loop/index.js';
import type { AgentLoopPermissionCallback, AgentLoopPermissionDecision } from '../../agent-loop/index.js';

export interface StepResult {
  status: 'completed' | 'failed' | 'skipped';
  output: Record<string, unknown>;
  error?: string;
}

export interface StepContext {
  readonly runId: string;
  readonly stepRunId: string;
  readonly projectId?: string;
  readonly projectRootPath?: string;
  readonly llmProfileId?: string;
  readonly results: ReadonlyMap<string, StepResult>;
  readonly eventPayload?: Record<string, unknown>;
  readonly triggerContext?: Record<string, unknown>;
  resolveTemplate(template: string): string;
  setSessionId(sessionId: string): void;
}

export interface StepExecutorPort {
  readonly supportedTypes: readonly string[];
  execute(
    node: WorkflowNodeDef,
    config: Record<string, unknown>,
    ctx: StepContext,
  ): Promise<StepResult>;
}

export interface ApprovalPort {
  waitForApproval(stepRunId: string, timeoutMs: number): Promise<boolean>;
}

export interface AIRunnerPort {
  runPrompt(opts: {
    projectId?: string;
    llmProfileId: string;
    prompt: string;
    workingDirectory?: string;
    sessionName?: string;
    timeoutMs?: number;
    onSessionCreated?: (sessionId: string) => void;
  }): Promise<{ sessionId: string; content: string }>;
}

export interface WorkflowAgentRuntimeRequest {
  purpose: string;
  runId: string;
  projectId?: string;
  projectRootPath?: string;
  cwd: string;
  llmProfileId?: string;
  model?: string;
  baseSystemPrompt?: string;
  systemContext?: string;
}

export interface WorkflowAgentRuntime {
  llmProfileId: string;
  model?: string;
  systemPrompt: string;
  userHooks?: UserHookDefinition[];
  permissionCallback?: AgentLoopPermissionCallback;
  toolSessionId?: string;
}

export interface WorkflowAgentRuntimePort {
  resolve(request: WorkflowAgentRuntimeRequest): Promise<WorkflowAgentRuntime>;
}

export interface NotificationPort {
  notify(event: {
    type: string;
    title: string;
    body: string;
    priority?: string;
    tags?: string[];
  }): Promise<void>;
}

// ── Permission Workflow Bridge ─────────────────────────────────

export interface PermissionEscalationContext {
  requestId: string;
  runId: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  detail: string;
  cwd: string;
  category: string;
  matchedRule?: string;
  isEscalateAlways: boolean;
  sessionType: 'regular' | 'background' | 'agent';
  aiInitiatedPlanMode?: boolean;
  aiReview?: AIReviewConfig;
}

export interface PermissionBridgePort {
  register(
    requestId: string,
    resolve: (decision: AgentLoopPermissionDecision) => void,
    context: PermissionEscalationContext,
  ): void;
  setWorkflowRunId(requestId: string, workflowRunId: string): void;
  resolvePermission(requestId: string, decision: 'allow' | 'deny', reason?: string): boolean;
  getPermissionContext(requestId: string): PermissionEscalationContext | undefined;
  remove(requestId: string): boolean;
}

export interface AIRiskAnalysisPort {
  evaluate(ctx: {
    toolName: string;
    toolInput: unknown;
    detail: string;
    cwd: string;
    config: {
      confidenceThreshold: number;
      maxAutoApprovalsPerMinute: number;
      analysisLlmProfileId?: string;
    };
  }): Promise<{
    decision: 'approve' | 'deny' | 'uncertain';
    reasoning: string;
    confidence: number;
    metadata?: Record<string, unknown>;
  }>;
}
