import type { ChildProcess } from 'child_process';
import type {
  TaskEvent,
  TaskExecutorRef,
  TaskRecord,
  TaskResult,
  TaskStatus,
  TaskType,
} from '@zclaudia/shared/core/task';

import type { TaskExecutorUpdate } from './task-executor-types.js';

export interface CreateTaskInput {
  type: TaskType;
  status?: TaskStatus;
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
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  sessionId?: string;
  runId?: string;
  title?: string;
  description?: string;
  executorRef?: TaskExecutorRef;
  result?: TaskResult;
  metadata?: Record<string, unknown>;
}

/** Application boundary used by infrastructure task tools and runtimes. */
export interface TaskPort {
  createTask(input: CreateTaskInput): TaskRecord;
  findById(id: string): TaskRecord | null;
  update(id: string, input: UpdateTaskInput): TaskRecord;
  listByTypeAndStatuses(type: TaskType, statuses: TaskStatus[], sessionId?: string): TaskRecord[];
  listEvents(taskId: string): TaskEvent[];
  findLatestAgentTaskForSession(sessionId: string): TaskRecord | null;
  startTask(
    id: string,
    input?: { executorRef?: TaskExecutorRef; runId?: string; sessionId?: string }
  ): TaskRecord;
  completeTask(id: string, result: TaskResult): TaskRecord;
  failTask(id: string, result: TaskResult): TaskRecord;
  stopTask(id: string, result?: TaskResult): TaskRecord;
  commandTasks: CommandTaskPort;
}

export interface CommandTaskPort {
  start(task: TaskRecord): Promise<TaskExecutorUpdate>;
  adopt(
    task: TaskRecord,
    child: ChildProcess,
    initialOutput: string,
    initialOutputPath?: string
  ): TaskExecutorUpdate;
  stop(taskId: string, reason?: string): Promise<TaskExecutorUpdate>;
  reconcile(): void;
  logPath(taskId: string): string;
  pidAlive(pid: number): boolean;
}
