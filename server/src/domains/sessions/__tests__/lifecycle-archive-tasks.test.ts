/**
 * Integration test: archiving a session stops its running background command tasks.
 */
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';

import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { SessionLifecycleService } from '../lifecycle-service.js';
import { TaskRepository } from '../../tasks/repository.js';
import { TaskService } from '../../tasks/task-service.js';
import { CommandTaskExecutor, pidAlive } from '../../tasks/executors/command-executor.js';

let db: Database.Database;
let dataDir: string;
let prevDataDir: string | undefined;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);

  dataDir = mkdtempSync(join(tmpdir(), 'zc-archive-tasks-'));
  prevDataDir = process.env.ZCLAUDIA_DATA_DIR;
  process.env.ZCLAUDIA_DATA_DIR = dataDir;

  // Seed a project and a session for archiving.
  // applyMigrations creates agent_profiles with llm_profile_id NOT NULL, so we
  // must insert an llm_profile row first, then an agent_profile pointing to it,
  // before we can insert a session.
  const now = Date.now();
  db.prepare(
    'INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run('project-1', 'Test Project', 'code', now, now);
  db.prepare(
    'INSERT INTO llm_profiles (id, name, provider_type, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('llm-1', 'Default LLM', 'anthropic', 1, now, now);
  db.prepare(
    'INSERT INTO agent_profiles (id, name, llm_profile_id, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('agent-1', 'Default Agent', 'llm-1', 1, now, now);
  db.prepare(
    'INSERT INTO sessions (id, project_id, name, agent_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('session-1', 'project-1', 'Session 1', 'agent-1', now, now);
});

afterEach(() => {
  if (prevDataDir === undefined) {
    delete process.env.ZCLAUDIA_DATA_DIR;
  } else {
    process.env.ZCLAUDIA_DATA_DIR = prevDataDir;
  }
  try {
    db.close();
  } catch {
    // already closed
  }
  rmSync(dataDir, { recursive: true, force: true });
});

describe('SessionLifecycleService.archiveSessions — command task cleanup', () => {
  it('archiving a session stops its running background command tasks', async () => {
    const repo = new TaskRepository(db);
    const service = new TaskService(repo);
    const executor = new CommandTaskExecutor(repo);

    const task = service.createTask({
      type: 'command',
      sessionId: 'session-1',
      metadata: { command: 'sleep 30', cwd: dataDir },
    });
    const started = await executor.start(repo.findById(task.id)!);
    service.startTask(task.id, { executorRef: started.executorRef });
    const pid = started.executorRef!.pid!;

    expect(pidAlive(pid)).toBe(true);

    const lifecycleService = new SessionLifecycleService(db);
    lifecycleService.archiveSessions(['session-1']);
    await new Promise<void>((r) => setTimeout(r, 400));

    try {
      expect(repo.findById(task.id)!.status).toBe('stopped');
      expect(pidAlive(pid)).toBe(false);
    } finally {
      // Best-effort leak cleanup in case the test assertion fails early.
      const current = repo.findById(task.id);
      if (current && current.status === 'running') {
        await executor.stop(task.id).catch(() => {});
      }
    }
  });
});
