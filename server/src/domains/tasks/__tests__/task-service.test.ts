import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { TaskRepository } from '../repository.js';
import { TaskService, TaskLifecycleError } from '../task-service.js';

describe('TaskService', () => {
  let db: Database.Database;
  let repo: TaskRepository;
  let service: TaskService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    repo = new TaskRepository(db);
    service = new TaskService(repo);
  });

  it('creates a first-class agent task with parent run metadata', () => {
    const task = service.createTask({
      type: 'agent',
      title: 'Explore auth flow',
      parentSessionId: 'session-parent',
      parentRunId: 'run-parent',
      parentToolUseId: 'tool-agent-1',
      executorRef: {
        providerType: 'zclaudia',
        providerSessionId: 'provider-session',
      },
      metadata: { subagentType: 'explorer' },
    });

    expect(task).toMatchObject({
      type: 'agent',
      status: 'queued',
      title: 'Explore auth flow',
      parentSessionId: 'session-parent',
      parentRunId: 'run-parent',
      parentToolUseId: 'tool-agent-1',
      executorRef: {
        providerType: 'zclaudia',
        providerSessionId: 'provider-session',
      },
      metadata: { subagentType: 'explorer' },
    });
    expect(repo.listEvents(task.id).map(event => event.type)).toEqual(['created']);
  });

  it('records valid lifecycle transitions and result payloads', () => {
    const task = service.createTask({ type: 'command', title: 'Run tests' });

    const running = service.startTask(task.id, {
      executorRef: { taskId: 'shell-task-1', command: 'pnpm test' },
    });
    const completed = service.completeTask(task.id, {
      text: 'Tests passed',
      artifacts: [{ type: 'log', uri: 'task://shell-task-1/log' }],
    });

    expect(running.status).toBe('running');
    expect(completed).toMatchObject({
      status: 'completed',
      result: {
        text: 'Tests passed',
        artifacts: [{ type: 'log', uri: 'task://shell-task-1/log' }],
      },
    });
    expect(repo.listEvents(task.id).map(event => event.type)).toEqual([
      'created',
      'started',
      'completed',
    ]);
  });

  it('rejects invalid lifecycle transitions after terminal states', () => {
    const task = service.createTask({ type: 'monitor', title: 'Watch server' });
    service.startTask(task.id);
    service.stopTask(task.id, { error: 'Stopped by user' });

    expect(() => service.completeTask(task.id, { text: 'late result' })).toThrow(
      TaskLifecycleError
    );
    expect(repo.findById(task.id)?.status).toBe('stopped');
    expect(repo.listEvents(task.id).map(event => event.type)).toEqual([
      'created',
      'started',
      'stopped',
    ]);
  });
});
