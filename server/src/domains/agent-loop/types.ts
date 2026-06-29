import type { AgentTool } from '@earendil-works/pi-agent-core';

export type AgentLoopOwnerType =
  | 'workflow_run'
  | 'local_pr'
  | 'supervision'
  | 'automation'
  | 'manual';

export interface AgentLoopOwner {
  type: AgentLoopOwnerType;
  id: string;
}

export type AgentLoopContextPolicy =
  | 'none'
  | 'step-local'
  | 'workflow-artifacts'
  | 'workflow-thread';

export type AgentLoopPermissionMode =
  | 'deny-external'
  | 'allow-declared-tools'
  | 'custom';

export type AgentLoopRunStatus =
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'contract_failed';

export type AgentLoopEventKind =
  | 'input'
  | 'assistant_message'
  | 'tool_call'
  | 'tool_result'
  | 'artifact'
  | 'summary'
  | 'contract_result'
  | 'error';

export interface AgentLoopContext {
  id: string;
  ownerType: string;
  ownerId: string;
  contextKey: string;
  policy: string;
  summary?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentLoopEvent {
  id: string;
  contextId: string;
  kind: AgentLoopEventKind;
  payload: Record<string, unknown>;
  createdAt: number;
}

export type JsonOutputContract = {
  type: 'json';
  schema: Record<string, unknown>;
  repairAttempts?: number;
};

export type FutureOutputContract =
  | {
      type: 'finish_tool';
      toolName: string;
      schema: Record<string, unknown>;
    }
  | {
      type: 'text';
    };

export type OutputContract = JsonOutputContract | FutureOutputContract;

export interface AgentLoopToolsetRequest {
  id: string;
  overrides?: Record<string, AgentTool>;
}

export interface LightweightAgentRunRequest {
  owner: AgentLoopOwner;
  purpose: string;
  llmProfileId?: string;
  model?: string;
  cwd: string;
  systemPrompt: string;
  input: string;
  toolset: AgentLoopToolsetRequest;
  outputContract: OutputContract;
  context: {
    policy: AgentLoopContextPolicy;
    key?: string;
    maxEvents?: number;
  };
  limits: {
    maxTurns: number;
    timeoutMs: number;
  };
  permissionMode: AgentLoopPermissionMode;
}

export interface LightweightAgentRunResult {
  status: AgentLoopRunStatus;
  output: Record<string, unknown>;
  usage?: unknown;
  traceId?: string;
  contextId?: string;
  error?: string;
}

export interface AgentLoopRunnerPort {
  run(request: LightweightAgentRunRequest): Promise<LightweightAgentRunResult>;
}
