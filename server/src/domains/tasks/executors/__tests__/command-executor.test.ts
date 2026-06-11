import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';

import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { TaskRepository } from '../../repository.js';
import { TaskService } from '../../task-service.js';
import { CommandTaskExecutor, commandTaskLogPath, pidAlive } from '../command-executor.js';

let db: Database.Database;
let dataDir: string;
let prevDataDir: string | undefined;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);

  dataDir = mkdtempSync(join(tmpdir(), 'zc-cmdexec-'));
  prevDataDir = process.env.ZCLAUDIA_DATA_DIR;
  process.env.ZCLAUDIA_DATA_DIR = dataDir;
});

afterEach(() => {
  if (prevDataDir === undefined) {
    delete process.env.ZCLAUDIA_DATA_DIR;
  } else {
    process.env.ZCLAUDIA_DATA_DIR = prevDataDir;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('CommandTaskExecutor', () => {
  it('start spawns detached, writes output to the log file, and exit 0 completes the task', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const task = service.createTask({ type: 'command', metadata: { command: 'echo bg-hello', cwd: dataDir } });
    const started = await executor.start(task);
    expect(started.status).toBe('running');
    expect(typeof started.executorRef?.pid).toBe('number');
    service.startTask(task.id, { executorRef: started.executorRef });
    await wait(700);
    const after = repo.findById(task.id)!;
    expect(after.status).toBe('completed');
    expect(readFileSync(commandTaskLogPath(task.id), 'utf8')).toContain('bg-hello');
  });

  it('non-zero exit fails the task with the code in the result', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const task = service.createTask({ type: 'command', metadata: { command: 'exit 4', cwd: dataDir } });
    const started = await executor.start(task);
    service.startTask(task.id, { executorRef: started.executorRef });
    await wait(700);
    const after = repo.findById(task.id)!;
    expect(after.status).toBe('failed');
    expect(after.result?.error).toContain('4');
  });

  it('stop kills the process tree and transitions to stopped', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const task = service.createTask({ type: 'command', metadata: { command: 'sleep 30', cwd: dataDir } });
    const started = await executor.start(task);
    service.startTask(task.id, { executorRef: started.executorRef });
    const pid = started.executorRef!.pid!;
    expect(pidAlive(pid)).toBe(true);
    await executor.stop(task.id, 'test stop');
    await wait(300);
    expect(pidAlive(pid)).toBe(false);
    expect(repo.findById(task.id)!.status).toBe('stopped');
  });

  it('stop on an already-completed task is a quiet no-op', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const task = service.createTask({ type: 'command', metadata: { command: 'echo done', cwd: dataDir } });
    const started = await executor.start(task);
    service.startTask(task.id, { executorRef: started.executorRef });
    await wait(700); // let it complete
    expect(repo.findById(task.id)!.status).toBe('completed');
    await expect(executor.stop(task.id, 'late stop')).resolves.toMatchObject({ status: 'completed' });
    expect(repo.findById(task.id)!.status).toBe('completed'); // unchanged
  });

  it('async spawn failure (nonexistent cwd) fails the task via the error watch', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const task = service.createTask({ type: 'command', metadata: { command: 'echo hi', cwd: join(dataDir, 'no-such-dir') } });
    const started = await executor.start(task);
    service.startTask(task.id, { executorRef: started.executorRef });
    await wait(500);
    const after = repo.findById(task.id)!;
    expect(after.status).toBe('failed');
    expect(after.result?.error).toContain('spawn error');
  });

  it('start rejects a task without metadata.command', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const task = service.createTask({ type: 'command', metadata: {} });
    await expect(executor.start(task)).rejects.toThrow(/command/);
  });

  it('reconcile finalizes running tasks whose pid is dead and leaves live ones running', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const dead = service.createTask({ type: 'command', metadata: { command: 'noop' } });
    service.startTask(dead.id, { executorRef: { pid: 99999999, command: 'noop' } });
    const live = service.createTask({ type: 'command', metadata: { command: 'sleep 30', cwd: dataDir } });
    const started = await executor.start(repo.findById(live.id)!);
    service.startTask(live.id, { executorRef: started.executorRef });

    executor.reconcile();

    expect(repo.findById(dead.id)!.status).toBe('stopped');
    expect(repo.findById(live.id)!.status).toBe('running');
    await executor.stop(live.id);
  });
});
