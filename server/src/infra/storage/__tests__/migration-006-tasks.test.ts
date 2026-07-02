import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { applyMigrations } from '../migrations/index.js';

describe('migration 006 tasks', () => {
  it('creates tasks and task_events tables with parent/executor fields', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);

    const tables = db
      .prepare(
        `
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('tasks', 'task_events')
      ORDER BY name
    `
      )
      .all() as Array<{ name: string }>;

    expect(tables.map(row => row.name)).toEqual(['task_events', 'tasks']);

    const taskColumns = (
      db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>
    ).map(col => col.name);
    expect(taskColumns).toEqual(
      expect.arrayContaining([
        'id',
        'type',
        'status',
        'parent_task_id',
        'parent_session_id',
        'parent_run_id',
        'parent_tool_use_id',
        'session_id',
        'run_id',
        'executor_ref',
        'result',
        'metadata',
      ])
    );

    const eventColumns = (
      db.prepare('PRAGMA table_info(task_events)').all() as Array<{ name: string }>
    ).map(col => col.name);
    expect(eventColumns).toEqual(
      expect.arrayContaining(['id', 'task_id', 'type', 'status', 'payload', 'created_at'])
    );
  });
});
