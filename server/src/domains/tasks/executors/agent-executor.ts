import type { TaskRecord, TaskResult, TaskStatus } from '@zclaudia/shared/core/task';

import type { AgentRunnerTask, AgentTaskRunner } from '../../../application/orchestration/agent-task-runner.js';
import type { TaskExecutor, TaskExecutorUpdate } from './types.js';

function metadataRecord(task: TaskRecord): Record<string, unknown> {
  return task.metadata ?? {};
}

function metadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

interface PendingAgentRun {
  promise: Promise<TaskExecutorUpdate>;
  resolve: (update: TaskExecutorUpdate) => void;
}

function deferredRun(): PendingAgentRun {
  let resolve!: (update: TaskExecutorUpdate) => void;
  const promise = new Promise<TaskExecutorUpdate>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function toRunnerTask(task: TaskRecord, prompt: string, metadata: Record<string, unknown>): AgentRunnerTask {
  return {
    id: task.id,
    parentTaskId: task.parentTaskId ?? null,
    projectId: metadataString(metadata, 'projectId') ?? null,
    sessionId: null,
    branchId: null,
    contextTemplate: 'agent',
    status: 'queued',
    task: prompt,
    externalId: null,
    canonicalTaskId: task.id,
    initiator: 'system',
    llmProfileId: metadataString(metadata, 'llmProfileId'),
    permissionOverride: metadata.permissionOverride as never,
    retryCount: 0,
    maxRetries: 0,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs) return promise;
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      setTimeout(() => {
        resolve({
          status: 'failed',
          result: { error: `Timeout after ${timeoutMs}ms` },
        } as T);
      }, timeoutMs);
    }),
  ]);
}

export class AgentTaskExecutor implements TaskExecutor {
  readonly type = 'agent' as const;

  private readonly pendingRuns = new Map<string, PendingAgentRun>();

  constructor(private readonly runner: AgentTaskRunner) {}

  async start(task: TaskRecord): Promise<TaskExecutorUpdate> {
    const metadata = metadataRecord(task);
    const prompt = metadataString(metadata, 'prompt') ?? task.description ?? task.title;
    if (!prompt) throw new Error(`Agent task ${task.id} is missing prompt metadata`);
    const pending = deferredRun();
    this.pendingRuns.set(task.id, pending);
    let sessionId: string | undefined;
    this.runner.run(toRunnerTask(task, prompt, metadata), {
      onStarted: startedSessionId => {
        sessionId = startedSessionId;
      },
      onDelta: () => undefined,
      onCompleted: result => {
        pending.resolve({
          status: 'completed',
          result: { text: result.responseText || result.resultSummary },
        });
      },
      onFailed: errorSummary => {
        pending.resolve({
          status: 'failed',
          result: { error: errorSummary },
        });
      },
    });
    return {
      status: 'running',
      executorRef: {
        providerType: 'zclaudia-agent-runner',
        taskId: task.id,
      },
      sessionId,
    };
  }

  async wait(taskId: string, options?: { timeoutMs?: number }): Promise<TaskExecutorUpdate> {
    const pending = this.pendingRuns.get(taskId);
    if (!pending) {
      return {
        status: 'failed',
        result: { error: `Agent task run not found: ${taskId}` },
      };
    }
    const result = await withTimeout(pending.promise, options?.timeoutMs);
    if (result.status === 'completed' || result.status === 'failed' || result.status === 'stopped') {
      this.pendingRuns.delete(taskId);
    }
    return result;
  }

  async stop(taskId: string, reason?: string): Promise<TaskExecutorUpdate> {
    const update = {
      status: 'stopped',
      result: { error: reason ?? 'Stopped by workflow' } satisfies TaskResult,
    } satisfies TaskExecutorUpdate;
    this.pendingRuns.get(taskId)?.resolve(update);
    this.pendingRuns.delete(taskId);
    return update;
  }
}
