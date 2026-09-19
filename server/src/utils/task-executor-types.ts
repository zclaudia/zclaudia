import type {
  TaskExecutorRef,
  TaskRecord,
  TaskResult,
  TaskStatus,
  TaskType,
} from '@zclaudia/shared/core/task';

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
