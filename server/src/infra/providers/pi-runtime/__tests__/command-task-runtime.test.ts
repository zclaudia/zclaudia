import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import type { TaskRecord } from '@zclaudia/shared/core/task';

import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { TaskRepository } from '../../../../domains/tasks/repository.js';
import { TaskService } from '../../../../domains/tasks/task-service.js';
import { CommandTaskExecutor } from '../../../../domains/tasks/executors/command-executor.js';
import { CommandTaskRuntime, commandExitCode } from '../command-task-runtime.js';

function taskRecord(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: 't1',
    type: 'command',
    status: 'failed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('commandExitCode', () => {
  it('prefers the structured metadata exit code over the result text', () => {
    // Metadata says 4; the text says 9 — the structured field must win.
    const task = taskRecord({
      status: 'failed',
      metadata: { exitCode: 4 },
      result: { text: 'Command exited with code 9', error: 'exit code 9' },
    });
    expect(commandExitCode(task)).toBe(4);
  });

  it('returns 0 from structured metadata even when no text was written', () => {
    const task = taskRecord({ status: 'completed', metadata: { exitCode: 0 } });
    expect(commandExitCode(task)).toBe(0);
  });

  it('falls back to legacy text parsing when no structured field exists', () => {
    const task = taskRecord({
      status: 'failed',
      result: { text: 'Command exited with code 7', error: 'exit code 7' },
    });
    expect(commandExitCode(task)).toBe(7);
  });

  it('keeps the legacy heuristics for completed and unknown exits', () => {
    expect(commandExitCode(taskRecord({ status: 'completed', result: { text: 'done' } }))).toBe(0);
    expect(
      commandExitCode(
        taskRecord({
          status: 'completed',
          result: { text: 'Process exited (exit code unknown; observed after restart)' },
        })
      )
    ).toBeNull();
    expect(commandExitCode(taskRecord({ status: 'stopped' }))).toBeNull();
  });

  it('ignores a non-numeric structured field and falls back to text', () => {
    const task = taskRecord({
      status: 'failed',
      metadata: { exitCode: '4' },
      result: { error: 'exit code 5' },
    });
    expect(commandExitCode(task)).toBe(5);
  });
});

describe('CommandTaskRuntime exit-code round-trip', () => {
  let db: Database.Database;
  let dataDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    dataDir = mkdtempSync(join(tmpdir(), 'zc-cmdruntime-'));
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

  const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

  it('survives round-trip through readOutput without any text parsing', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const runtime = new CommandTaskRuntime(repo);
    const task = service.createTask({
      type: 'command',
      metadata: { command: 'exit 4', cwd: dataDir },
    });
    const started = await executor.start(task);
    service.startTask(task.id, { executorRef: started.executorRef });
    await wait(700);

    const settled = repo.findById(task.id)!;
    expect(settled.status).toBe('failed');
    expect(settled.metadata?.exitCode).toBe(4);

    // Corrupt the human-readable result: if readOutput still parses text the
    // exit code would be lost; with the structured field it must survive.
    repo.update(task.id, { result: { text: 'result rewritten without any code' } });

    const output = (await runtime.readOutput(repo.findById(task.id)!, {})) as {
      details?: Record<string, unknown>;
    };
    expect(output.details).toMatchObject({ ok: true, status: 'failed', exitCode: 4 });
  });
});
