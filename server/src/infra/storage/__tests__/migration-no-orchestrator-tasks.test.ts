import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { applyMigrations } from '../migrations/index.js';
import { migration as dropLegacyOrchestratorTasks } from '../migrations/007_drop_legacy_orchestrator_tasks.js';

describe('migrations canonical task runtime', () => {
  it('does not create the legacy orchestrator_tasks table', () => {
    const db = new Database(':memory:');
    applyMigrations(db);

    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orchestrator_tasks'"
    ).get();

    expect(table).toBeUndefined();
    db.close();
  });

  it('drops legacy orchestrator_tasks from existing databases without losing branches', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY);
      CREATE TABLE sessions (id TEXT PRIMARY KEY);
      CREATE TABLE orchestrator_tasks (id TEXT PRIMARY KEY);
      CREATE TABLE claudia_branches (
        id TEXT PRIMARY KEY,
        host_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        active_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_task_id TEXT REFERENCES orchestrator_tasks(id) ON DELETE SET NULL
      );
      INSERT INTO projects (id) VALUES ('project-1');
      INSERT INTO sessions (id) VALUES ('session-1');
      INSERT INTO orchestrator_tasks (id) VALUES ('legacy-task-1');
      INSERT INTO claudia_branches (
        id, host_project_id, active_session_id, title, created_at, updated_at, last_task_id
      ) VALUES ('branch-1', 'project-1', 'session-1', 'Branch', 1, 1, 'legacy-task-1');
    `);

    db.exec(dropLegacyOrchestratorTasks.sql);

    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orchestrator_tasks'"
    ).get();
    const branch = db.prepare('SELECT * FROM claudia_branches WHERE id = ?').get('branch-1') as {
      last_task_id: string;
      active_session_id: string;
    };
    const foreignKeys = db.prepare('PRAGMA foreign_key_list(claudia_branches)').all() as Array<{ table: string }>;

    expect(table).toBeUndefined();
    expect(branch.last_task_id).toBe('legacy-task-1');
    expect(branch.active_session_id).toBe('session-1');
    expect(foreignKeys.map((fk) => fk.table)).not.toContain('orchestrator_tasks');
    db.close();
  });
});
