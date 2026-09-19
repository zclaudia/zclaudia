import type {
  TaskExecutorRef,
  TaskRecord,
  TaskResult,
  TaskStatus,
  TaskType,
} from '@zclaudia/shared/core/task';

/**
 * Server-side task executor contract. Depends only on shared types, so it
 * lives in utils where both infra (pi-runtime tools) and the tasks domain
 * can import it without layer violations.
 */
export interface TaskExecutorUpdate {
  status: TaskStatus;
  result?: TaskResult;
  executorRef?: TaskExecutorRef;
  sessionId?: string;
}

export interface TaskExecutor {
  readonly type: TaskType;
  start(task: TaskRecord): Promise<TaskExecutorUpdate>;
  wait(taskId: string, options?: { timeoutMs?: number }): Promise<TaskExecutorUpdate>;
  stop(taskId: string, reason?: string): Promise<TaskExecutorUpdate>;
}
