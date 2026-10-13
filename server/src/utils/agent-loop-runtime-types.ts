import type { PermissionRequest } from '@zclaudia/shared/interaction/permissions';

/** Runtime contract shared by the agent-loop application service and providers. */
export class AgentLoopTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Lightweight agent loop timed out after ${timeoutMs}ms`);
    this.name = 'AgentLoopTimeoutError';
  }
}

export interface AgentLoopExecutionInput<ModelInfo, Tools, Hooks> {
  systemPrompt: string;
  userInput: string;
  history: never[];
  modelInfo: ModelInfo;
  tools: Tools;
  hooks: Hooks;
  timeoutMs: number;
  maxTurns?: number;
  sessionId: string;
  cacheRetention?: 'none' | 'short' | 'long';
  signal?: AbortSignal;
}

export interface AgentLoopExecutionResult {
  text: string;
  usage?: unknown;
}

export type AgentLoopExecutor<ModelInfo, Tools, Hooks> = (
  input: AgentLoopExecutionInput<ModelInfo, Tools, Hooks>
) => Promise<AgentLoopExecutionResult>;

export type AgentLoopPermissionMode = 'deny-external' | 'allow-declared-tools';

export interface AgentLoopPermissionDecision {
  behavior: 'allow' | 'deny';
  updatedInput?: unknown;
  message?: string;
}

export type AgentLoopPermissionCallback = (
  request: PermissionRequest
) => Promise<AgentLoopPermissionDecision>;
