import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { TaskRepository } from '../../../../domains/tasks/repository.js';
import { TaskService } from '../../../../domains/tasks/task-service.js';
import { onTaskLifecycle } from '../../../../domains/tasks/task-events-bus.js';
import { registerTaskSettlementNotifier } from '../task-settlement-notifier.js';
import {
  addPendingTaskNotice,
  drainPendingTaskNotices,
  __resetPendingTaskNoticesForTests,
} from '../pending-task-notices.js';
import { PhaseEmitter } from '../active-run-phase.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

function makeActiveRun(sessionId: string, overrides: Record<string, unknown> = {}): any {
  return {
    runId: `run-${sessionId}`,
    sessionId,
    phase: 'running',
    phaseEmitter: new PhaseEmitter(),
    pendingPermissions: new Map(),
    pendingBackgroundTasks: 0,
    pendingSteers: [],
    ...overrides,
  };
}

function makeClient(): { client: any; sent: any[] } {
  const sent: any[] = [];
  const client = {
    id: `c-${Math.random().toString(36).slice(2)}`,
    authenticated: true,
    ws: { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw)) },
  };
  return { client, sent };
}

describe('task lifecycle event bus', () => {
  it('emits started and settled events from TaskService transitions', () => {
    const db = makeDb();
    const service = new TaskService(new TaskRepository(db));
    const events: Array<{ type: string; taskId: string; status: string }> = [];
    const off = onTaskLifecycle(event => {
      events.push({ type: event.type, taskId: event.task.id, status: event.task.status });
    });

    const task = service.createTask({ type: 'command', sessionId: 's1', title: 'sleep' });
    service.startTask(task.id);
    service.completeTask(task.id, { text: 'done' });
    off();
    db.close();

    expect(events).toEqual([
      { type: 'started', taskId: task.id, status: 'running' },
      { type: 'settled', taskId: task.id, status: 'completed' },
    ]);
  });
});

describe('pending task notices queue', () => {
  beforeEach(() => __resetPendingTaskNoticesForTests());

  it('queues and drains per session', () => {
    addPendingTaskNotice('s1', 'notice one');
    addPendingTaskNotice('s1', 'notice two');
    addPendingTaskNotice('s2', 'other');
    expect(drainPendingTaskNotices('s1')).toEqual(['notice one', 'notice two']);
    expect(drainPendingTaskNotices('s1')).toEqual([]);
    expect(drainPendingTaskNotices('s2')).toEqual(['other']);
  });
});

describe('task settlement notifier', () => {
  let db: Database.Database;
  let dataDir: string;
  let prevDataDir: string | undefined;
  let unregister: (() => void) | undefined;

  beforeEach(() => {
    db = makeDb();
    dataDir = mkdtempSync(path.join(tmpdir(), 'zc-notifier-'));
    prevDataDir = process.env.ZCLAUDIA_DATA_DIR;
    process.env.ZCLAUDIA_DATA_DIR = dataDir;
    __resetPendingTaskNoticesForTests();
  });

  afterEach(() => {
    unregister?.();
    unregister = undefined;
    if (prevDataDir === undefined) delete process.env.ZCLAUDIA_DATA_DIR;
    else process.env.ZCLAUDIA_DATA_DIR = prevDataDir;
    rmSync(dataDir, { recursive: true, force: true });
    db.close();
  });

  function setup(activeRuns = new Map(), clients = new Map()) {
    unregister = registerTaskSettlementNotifier({ activeRuns, connectedClients: clients });
    return new TaskService(new TaskRepository(db));
  }

  it('broadcasts task_notification to authenticated clients on start and settle', () => {
    const { client, sent } = makeClient();
    const clients = new Map([[client.id, client]]);
    const service = setup(new Map(), clients);

    const task = service.createTask({ type: 'command', sessionId: 's1', title: 'build' });
    service.startTask(task.id);
    service.completeTask(task.id, { text: 'exit 0' });

    const notifications = sent.filter(m => m.type === 'task_notification');
    expect(notifications).toHaveLength(2);
    expect(notifications[0]).toMatchObject({ taskId: task.id, sessionId: 's1', status: 'started' });
    expect(notifications[1]).toMatchObject({
      taskId: task.id,
      sessionId: 's1',
      status: 'completed',
    });
  });

  it('tracks pendingBackgroundTasks on the owning active run', () => {
    const run = makeActiveRun('s1');
    const activeRuns = new Map([[run.runId, run]]);
    const service = setup(activeRuns);

    const task = service.createTask({ type: 'command', sessionId: 's1', title: 'watch' });
    service.startTask(task.id);
    expect(run.pendingBackgroundTasks).toBe(1);
    service.failTask(task.id, { error: 'exit 2' });
    expect(run.pendingBackgroundTasks).toBe(0);
  });

  it('steers a completion notice into an active steerable run', () => {
    const steered: any[] = [];
    const run = makeActiveRun('s1', { steerHandle: { steer: (m: unknown) => steered.push(m) } });
    const activeRuns = new Map([[run.runId, run]]);
    const service = setup(activeRuns);

    const task = service.createTask({ type: 'command', sessionId: 's1', title: 'npm test' });
    service.startTask(task.id);
    // write a fake task log so the notice includes a tail
    const logDir = path.join(dataDir, 'task-logs');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(path.join(logDir, `${task.id}.log`), 'tests passed: 42\n');
    service.completeTask(task.id, { text: 'exit 0' });

    expect(steered).toHaveLength(1);
    const text = steered[0].content[0].text as string;
    expect(text).toContain(task.id);
    expect(text).toContain('completed');
    expect(text).toContain('tests passed: 42');
    expect(drainPendingTaskNotices('s1')).toEqual([]);
  });

  it('queues the notice when no active run exists for the session', () => {
    const service = setup(new Map());
    const task = service.createTask({ type: 'command', sessionId: 's1', title: 'npm build' });
    service.startTask(task.id);
    service.completeTask(task.id, { text: 'exit 0' });

    const notices = drainPendingTaskNotices('s1');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain(task.id);
  });

  it('ignores non-command tasks and tasks without a session', () => {
    const service = setup(new Map());
    const orphan = service.createTask({ type: 'command', title: 'no session' });
    service.startTask(orphan.id);
    service.completeTask(orphan.id, { text: 'x' });
    const agentTask = service.createTask({ type: 'agent', sessionId: 's1' });
    service.startTask(agentTask.id);
    service.completeTask(agentTask.id, { text: 'x' });
    expect(drainPendingTaskNotices('s1')).toEqual([]);
  });
});
