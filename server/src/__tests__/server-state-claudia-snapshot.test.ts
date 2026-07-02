import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

import { ServerState } from '../server-state.js';
import { applyMigrations } from '../infra/storage/migrations/index.js';
import { TaskRepository } from '../domains/tasks/repository.js';
import { TaskService } from '../domains/tasks/task-service.js';

describe('ServerState Claudia task snapshot', () => {
  it('submits Claudia tasks as canonical tasks without orchestrator task rows', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    const state = new ServerState();
    state.database = db as never;
    state.branchAllocator = {
      allocateBranch: vi.fn(),
      allocateForContinue: vi.fn(),
      setActiveBranchId: vi.fn(),
      attachSession: vi.fn(),
      updateBranchTask: vi.fn(),
      listActiveBranches: vi.fn(() => []),
    } as never;
    state.agentTaskExecutor = {
      type: 'agent',
      start: vi.fn(async task => ({
        status: 'running',
        executorRef: { providerType: 'zclaudia-agent-runner', taskId: task.id },
        sessionId: 'session-1',
      })),
      wait: vi.fn(() => new Promise(() => {})),
      stop: vi.fn(),
    };

    const result = await state.getTaskCoordination()!.submitCanonicalAgentTask!({
      input: 'Investigate auth',
      title: 'Investigate auth',
      projectId: 'project-1',
      branchId: 'branch-1',
      branchAction: 'created',
      contextReset: false,
      llmProfileId: 'profile-1',
    });

    const task = new TaskRepository(db).findById(result.taskId);
    expect(result).toEqual({ taskId: expect.any(String), sessionId: 'session-1' });
    expect(task).toMatchObject({
      id: result.taskId,
      type: 'agent',
      status: 'running',
      sessionId: 'session-1',
      metadata: expect.objectContaining({
        initiator: 'claudia',
        projectId: 'project-1',
        branchId: 'branch-1',
        input: 'Investigate auth',
      }),
    });
    db.close();
  });

  it('builds snapshots from canonical Claudia tasks without a TaskOrchestrator', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    const taskService = new TaskService(new TaskRepository(db));
    const task = taskService.createTask({
      type: 'agent',
      title: 'Review login',
      description: 'Review login flow',
      sessionId: 'session-1',
      metadata: {
        initiator: 'claudia',
        projectId: 'project-1',
        branchId: 'branch-1',
        branchAction: 'forked',
        contextReset: true,
        input: 'Review login flow',
      },
    });
    taskService.startTask(task.id, {
      executorRef: { providerType: 'zclaudia-agent-runner', taskId: task.id },
    });
    taskService.completeTask(task.id, { text: 'Login summary' });

    const state = new ServerState();
    state.database = db as never;

    const snapshot = state.buildClaudiaTaskSnapshot();

    expect(snapshot).toMatchObject({
      type: 'claudia_task_snapshot',
      tasks: [
        {
          id: task.id,
          sessionId: 'session-1',
          branchId: 'branch-1',
          branchAction: 'forked',
          contextReset: true,
          input: 'Review login flow',
          title: 'Review login',
          status: 'completed',
          summary: 'Login summary',
          responseText: 'Login summary',
        },
      ],
    });
    db.close();
  });
});
