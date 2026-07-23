import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';

import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { TaskRepository } from '../../repository.js';
import { TaskService } from '../../task-service.js';
import { CommandTaskExecutor, pidAlive } from '../command-executor.js';

// Stub the tree-kill so the victim process survives stop(): this exercises the
// confirm → escalate → report path that a truly stubborn (e.g. D-state or
// unkillable-foreign) process would take, without needing one.
vi.mock('../../../../infra/providers/pi-runtime/bash-runner.js', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, killProcessTree: vi.fn(() => {}) };
});

let db: Database.Database;
let dataDir: string;
let prevDataDir: string | undefined;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  dataDir = mkdtempSync(join(tmpdir(), 'zc-cmdstop-'));
  prevDataDir = process.env.ZCLAUDIA_DATA_DIR;
  process.env.ZCLAUDIA_DATA_DIR = dataDir;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (prevDataDir === undefined) {
    delete process.env.ZCLAUDIA_DATA_DIR;
  } else {
    process.env.ZCLAUDIA_DATA_DIR = prevDataDir;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

describe('CommandTaskExecutor.stop kill confirmation', () => {
  it('reports when the process cannot be confirmed dead after escalation', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);
    const task = service.createTask({
      type: 'command',
      metadata: { command: 'sleep 60', cwd: dataDir },
    });
    const started = await executor.start(task);
    service.startTask(task.id, { executorRef: started.executorRef });
    const pid = started.executorRef!.pid!;

    try {
      const update = await executor.stop(task.id, 'user requested stop');

      // The task still transitions to stopped (the system no longer tracks
      // it as running), but the result must report the unconfirmed kill.
      expect(update.status).toBe('stopped');
      const after = repo.findById(task.id)!;
      expect(after.status).toBe('stopped');
      expect(after.result?.error).toContain('user requested stop');
      expect(after.result?.error).toContain('could not be confirmed dead');
      expect(after.result?.error).toContain(String(pid));
      expect(pidAlive(pid)).toBe(true); // kill was stubbed — process really survived
    } finally {
      // Real cleanup: the mocked killProcessTree never ran.
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already dead */
        }
      }
    }
  }, 15000); // stop() waits out the full confirm + escalation windows (~3.5s)
});
