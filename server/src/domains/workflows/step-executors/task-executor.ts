import type { TaskType } from '@zclaudia/shared/core/task';
import type { WorkflowNodeDef } from '@zclaudia/shared/features/workflows';

import type { TaskExecutorRegistry } from '../../tasks/executors/registry.js';
import type { TaskExecutorUpdate } from '../../tasks/executors/types.js';
import type { TaskService } from '../../tasks/task-service.js';
import type { StepContext, StepExecutorPort, StepResult } from '../ports/step-executor.js';

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function taskTypeValue(value: unknown): TaskType {
  const type = stringValue(value) ?? 'agent';
  if (type === 'agent' || type === 'command' || type === 'monitor' || type === 'external') {
    return type;
  }
  throw new Error(`Unsupported task type: ${type}`);
}

function resultFromUpdate(taskId: string, update: TaskExecutorUpdate): StepResult {
  if (update.status === 'completed') {
    return {
      status: 'completed',
      output: {
        taskId,
        status: update.status,
        result: update.result,
      },
    };
  }
  if (update.status === 'failed') {
    return {
      status: 'failed',
      output: { taskId, status: update.status, result: update.result },
      error: update.result?.error ?? 'Task failed',
    };
  }
  return {
    status: 'completed',
    output: { taskId, status: update.status, result: update.result },
  };
}

export class TaskWorkflowStepExecutor implements StepExecutorPort {
  readonly supportedTypes = ['task'];

  constructor(
    private readonly taskService: TaskService,
    private readonly taskExecutors: TaskExecutorRegistry
  ) {}

  async execute(
    node: WorkflowNodeDef,
    config: Record<string, unknown>,
    ctx: StepContext
  ): Promise<StepResult> {
    try {
      const taskType = taskTypeValue(config.taskType ?? config.type);
      const prompt = stringValue(config.prompt ?? config.input);
      const shouldWait = booleanValue(config.wait, true);
      const timeoutMs = numberValue(config.timeoutMs ?? node.timeoutMs);
      const task = this.taskService.createTask({
        type: taskType,
        title: node.name,
        parentRunId: ctx.runId,
        metadata: {
          workflowRunId: ctx.runId,
          workflowStepRunId: ctx.stepRunId,
          workflowNodeId: node.id,
          projectId: ctx.projectId,
          prompt: prompt ? ctx.resolveTemplate(prompt) : undefined,
          config,
        },
      });
      const executor = this.taskExecutors.getRequired(taskType);
      const started = await executor.start(task);
      this.taskService.startTask(task.id, {
        executorRef: started.executorRef,
      });

      if (!shouldWait) {
        return {
          status: 'completed',
          output: {
            taskId: task.id,
            status: 'running',
          },
        };
      }

      const executorTaskId = started.executorRef?.taskId ?? task.id;
      const completed = await executor.wait(executorTaskId, { timeoutMs });
      if (completed.status === 'completed') {
        this.taskService.completeTask(task.id, completed.result ?? {});
      } else if (completed.status === 'failed') {
        this.taskService.failTask(task.id, completed.result ?? { error: 'Task failed' });
      } else if (completed.status === 'stopped') {
        this.taskService.stopTask(task.id, completed.result);
      }
      return resultFromUpdate(task.id, completed);
    } catch (err) {
      return {
        status: 'failed',
        output: {},
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
