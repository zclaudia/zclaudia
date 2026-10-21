export type BuiltinTaskType = 'agent' | 'command' | 'eval' | 'monitor' | 'external';
export type TaskType = BuiltinTaskType | (string & {});

export type TaskStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped';

export type TaskEventType =
  | 'created'
  | 'started'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'updated';

export interface TaskExecutorRef {
  providerType?: string;
  providerSessionId?: string;
  taskId?: string;
  pid?: number;
  command?: string;
}

export interface TaskArtifact {
  type: string;
  uri: string;
}

export interface TaskResult {
  text?: string;
  error?: string;
  artifacts?: TaskArtifact[];
  /**
   * Token/cost summary of a finished agent task's run (sub-agent usage).
   * Populated by the agent executor from the run's terminal usage snapshot so
   * the Agent tool's synchronous return can render a `<usage>` block; optional
   * and absent for command/eval/monitor tasks.
   */
  usage?: TaskUsageSummary;
}

/** Terminal usage summary of an agent task's run, aligned with the wire UsageInfo vocabulary. */
export interface TaskUsageSummary {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  toolUses?: number;
  durationMs?: number;
}

export interface TaskRecord {
  id: string;
  type: TaskType;
  status: TaskStatus;
  parentTaskId?: string;
  parentSessionId?: string;
  parentRunId?: string;
  parentToolUseId?: string;
  sessionId?: string;
  runId?: string;
  title?: string;
  description?: string;
  executorRef?: TaskExecutorRef;
  result?: TaskResult;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  type: TaskEventType;
  status?: TaskStatus;
  payload?: unknown;
  createdAt: number;
}
