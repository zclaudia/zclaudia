import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { TaskRepository } from '../../repository.js';
import { TaskService } from '../../task-service.js';
import { reconcileUnresumableTasks, SERVER_RESTARTED_REASON } from '../reconcile-stale-tasks.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
});

afterEach(() => {
  db.close();
});

describe('reconcileUnresumableTasks (P1-7)', () => {
  it('marks running agent tasks stopped with reason server_restarted', () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const task = service.createTask({ type: 'agent', metadata: { prompt: 'work' } });
    service.startTask(task.id, {
      executorRef: { providerType: 'zclaudia-agent-runner', taskId: task.id },
    });

    reconcileUnresumableTasks(repo);

    const after = repo.findById(task.id)!;
    expect(after.status).toBe('stopped');
    expect(after.result).toEqual({ error: SERVER_RESTARTED_REASON });
    expect(repo.listEvents(task.id).map(event => event.type)).toEqual([
      'created',
      'started',
      'stopped',
    ]);
  });

  it('settles queued and paused agent/monitor tasks too', () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const queuedAgent = service.createTask({ type: 'agent', metadata: { prompt: 'q' } });
    const queuedMonitor = service.createTask({ type: 'monitor', title: 'm' });
    const pausedMonitor = service.createTask({ type: 'monitor', title: 'm2' });
    service.startTask(pausedMonitor.id);
    service.pauseTask(pausedMonitor.id);

    reconcileUnresumableTasks(repo);

    for (const id of [queuedAgent.id, queuedMonitor.id, pausedMonitor.id]) {
      const after = repo.findById(id)!;
      expect(after.status).toBe('stopped');
      expect(after.result).toEqual({ error: SERVER_RESTARTED_REASON });
    }
  });

  it('leaves terminal agent/monitor tasks untouched', () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const completed = service.createTask({ type: 'agent', metadata: { prompt: 'done' } });
    service.startTask(completed.id);
    service.completeTask(completed.id, { text: 'ok' });
    const failed = service.createTask({ type: 'monitor' });
    service.startTask(failed.id);
    service.failTask(failed.id, { error: 'boom' });

    reconcileUnresumableTasks(repo);

    expect(repo.findById(completed.id)!.status).toBe('completed');
    expect(repo.findById(completed.id)!.result).toEqual({ text: 'ok' });
    expect(repo.findById(failed.id)!.status).toBe('failed');
    expect(repo.findById(failed.id)!.result).toEqual({ error: 'boom' });
  });

  it('does not touch command/eval tasks — their runtimes reconcile by pid liveness', () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const command = service.createTask({ type: 'command', metadata: { command: 'sleep 30' } });
    service.startTask(command.id, { executorRef: { pid: 99999999, command: 'sleep 30' } });
    const evalTask = service.createTask({ type: 'eval', metadata: { code: '1' } });
    service.startTask(evalTask.id, { executorRef: { pid: 99999999, command: 'eval' } });

    reconcileUnresumableTasks(repo);

    expect(repo.findById(command.id)!.status).toBe('running');
    expect(repo.findById(evalTask.id)!.status).toBe('running');
  });
});
