export type TaskType = 'agent' | 'command' | 'monitor' | 'external';

export type TaskStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped';

export type TaskEventType = 'created' | 'started' | 'paused' | 'completed' | 'failed' | 'stopped' | 'updated';

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
