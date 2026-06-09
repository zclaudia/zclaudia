import type {
  TaskEventType,
  TaskExecutorRef,
  TaskRecord,
  TaskResult,
  TaskStatus,
} from '@zclaudia/shared/core/task';

import type { CreateTaskInput, TaskRepository } from './repository.js';

const TERMINAL_STATUSES = new Set<TaskStatus>(['completed', 'failed', 'stopped']);

const ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  queued: ['running', 'failed', 'stopped'],
  running: ['paused', 'completed', 'failed', 'stopped'],
  paused: ['running', 'failed', 'stopped'],
  completed: [],
  failed: [],
  stopped: [],
};

export class TaskLifecycleError extends Error {
  constructor(
    readonly taskId: string,
    readonly from: TaskStatus,
    readonly to: TaskStatus,
  ) {
    super(`Invalid task transition for ${taskId}: ${from} -> ${to}`);
    this.name = 'TaskLifecycleError';
  }
}

export class TaskService {
  constructor(private readonly repo: TaskRepository) {}

  createTask(input: CreateTaskInput): TaskRecord {
    const task = this.repo.create(input);
    this.repo.addEvent({
      taskId: task.id,
      type: 'created',
      status: task.status,
      payload: {
        type: task.type,
        title: task.title,
        parentTaskId: task.parentTaskId,
        parentSessionId: task.parentSessionId,
        parentRunId: task.parentRunId,
        parentToolUseId: task.parentToolUseId,
      },
    });
    return task;
  }

  startTask(taskId: string, input?: { executorRef?: TaskExecutorRef; runId?: string; sessionId?: string }): TaskRecord {
    return this.transition(taskId, 'running', 'started', {
      executorRef: input?.executorRef,
      runId: input?.runId,
      sessionId: input?.sessionId,
    });
  }

  pauseTask(taskId: string, payload?: unknown): TaskRecord {
    return this.transition(taskId, 'paused', 'paused', { payload });
  }

  completeTask(taskId: string, result: TaskResult): TaskRecord {
    return this.transition(taskId, 'completed', 'completed', { result, payload: result });
  }

  failTask(taskId: string, result: TaskResult): TaskRecord {
    return this.transition(taskId, 'failed', 'failed', { result, payload: result });
  }

  stopTask(taskId: string, result?: TaskResult): TaskRecord {
    return this.transition(taskId, 'stopped', 'stopped', { result, payload: result });
  }

  private transition(
    taskId: string,
    status: TaskStatus,
    eventType: TaskEventType,
    input?: {
      executorRef?: TaskExecutorRef;
      result?: TaskResult;
      payload?: unknown;
      runId?: string;
      sessionId?: string;
    },
  ): TaskRecord {
    const task = this.repo.findById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (!ALLOWED_TRANSITIONS[task.status].includes(status)) {
      throw new TaskLifecycleError(taskId, task.status, status);
    }
    if (TERMINAL_STATUSES.has(task.status)) {
      throw new TaskLifecycleError(taskId, task.status, status);
    }

    const updated = this.repo.update(taskId, {
      status,
      executorRef: input?.executorRef,
      result: input?.result,
      runId: input?.runId,
      sessionId: input?.sessionId,
    });
    this.repo.addEvent({
      taskId,
      type: eventType,
      status,
      payload: input?.payload,
    });
    return updated;
  }
}
