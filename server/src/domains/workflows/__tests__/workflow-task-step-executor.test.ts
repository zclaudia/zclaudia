import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { TaskRepository } from '../../tasks/repository.js';
import { TaskService } from '../../tasks/task-service.js';
import { TaskExecutorRegistry } from '../../tasks/executors/registry.js';
import type { TaskExecutor } from '../../tasks/executors/types.js';
import { TaskWorkflowStepExecutor } from '../step-executors/task-executor.js';

describe('TaskWorkflowStepExecutor', () => {
  let db: Database.Database;
  let taskRepo: TaskRepository;
  let taskService: TaskService;
  let registry: TaskExecutorRegistry;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    taskRepo = new TaskRepository(db);
    taskService = new TaskService(taskRepo);
    registry = new TaskExecutorRegistry();
  });

  it('creates a canonical task, waits for completion, and returns its result', async () => {
    const start = vi.fn(async () => ({
      status: 'running' as const,
      executorRef: { providerType: 'test-agent', taskId: 'executor-task-1' },
    }));
    const wait = vi.fn(async () => ({
      status: 'completed' as const,
      result: { text: 'agent summary' },
    }));
    registry.register({
      type: 'agent',
      start,
      wait,
      stop: vi.fn(),
    } satisfies TaskExecutor);
    const executor = new TaskWorkflowStepExecutor(taskService, registry);

    const result = await executor.execute(
      { id: 'n1', name: 'Run Agent', type: 'task', config: {}, position: { x: 0, y: 0 } },
      { taskType: 'agent', prompt: 'Summarize repo', wait: true },
      {
        runId: 'wf-run-1',
        stepRunId: 'step-run-1',
        projectId: 'project-1',
        results: new Map(),
        resolveTemplate: (value: string) => value,
        setSessionId: vi.fn(),
      },
    );

    expect(result).toEqual({
      status: 'completed',
      output: {
        taskId: expect.any(String),
        status: 'completed',
        result: { text: 'agent summary' },
      },
    });
    const taskId = result.output.taskId as string;
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      id: taskId,
      type: 'agent',
      status: 'queued',
      title: 'Run Agent',
      parentRunId: 'wf-run-1',
      metadata: expect.objectContaining({
        workflowRunId: 'wf-run-1',
        workflowStepRunId: 'step-run-1',
        workflowNodeId: 'n1',
        prompt: 'Summarize repo',
      }),
    }));
    expect(wait).toHaveBeenCalledWith('executor-task-1', { timeoutMs: undefined });
    expect(taskRepo.findById(taskId)).toMatchObject({
      type: 'agent',
      status: 'completed',
      result: { text: 'agent summary' },
    });
    expect(taskRepo.listEvents(taskId).map(event => event.type)).toEqual(['created', 'started', 'completed']);
  });
});
