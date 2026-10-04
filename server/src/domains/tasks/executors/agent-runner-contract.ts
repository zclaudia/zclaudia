/**
 * Contract between the tasks domain and the application's agent-task runner.
 * Owned by the domain (the consumer); application/orchestration implements it
 * and re-exports the types for compatibility.
 */

export interface AgentRunnerTask {
  id: string;
  parentTaskId: string | null;
  projectId: string | null;
  sessionId: string | null;
  branchId: string | null;
  contextTemplate: string;
  status: string;
  task: string;
  externalId: string | null;
  canonicalTaskId?: string;
  initiator: 'system' | 'claudia';
  llmProfileId?: string;
  /** Agent profile the sub-agent session is created with (`subagent_type`). */
  agentProfileId?: string;
  /** Session that launched this task; recorded on the sub-agent session. */
  parentSessionId?: string | null;
  permissionOverride?: Partial<
    import('@zclaudia/shared/interaction/permissions').UnifiedPermissionPolicy
  >;
  /** Parent workspace root; the subagent runs here unless isolated. */
  cwd?: string | null;
  /** 'worktree': run in an ephemeral git worktree of cwd (removed when clean). */
  isolation?: 'worktree' | null;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentTaskRunCallbacks {
  onStarted: (sessionId: string) => void;
  onDelta?: (content: string) => void;
  onCompleted: (result: { resultSummary: string; responseText: string; toolCount: number }) => void;
  onFailed: (errorSummary: string) => void;
}

export interface AgentTaskRunner {
  run(task: AgentRunnerTask, callbacks: AgentTaskRunCallbacks): void;
}
