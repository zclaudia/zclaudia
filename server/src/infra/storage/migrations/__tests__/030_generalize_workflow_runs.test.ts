import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../index.js';

describe('030_generalize_workflow_runs', () => {
  it('adds initiator/action columns and makes workflow_id nullable', () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    const cols = db.prepare(`PRAGMA table_info(workflow_runs)`).all() as Array<{
      name: string;
      notnull: number;
    }>;
    const byName = new Map(cols.map(c => [c.name, c]));
    expect(byName.has('initiator')).toBe(true);
    expect(byName.has('action_kind')).toBe(true);
    expect(byName.has('action_ref')).toBe(true);
    expect(byName.get('workflow_id')!.notnull).toBe(0); // nullable

    const stepCols = (
      db.prepare(`PRAGMA table_info(workflow_step_runs)`).all() as Array<{ name: string }>
    ).map(c => c.name);
    expect(stepCols).toEqual(expect.arrayContaining(['id', 'run_id', 'step_id', 'status']));

    db.prepare(
      `INSERT INTO workflow_runs (id, workflow_id, status, trigger_source, initiator, action_kind, action_ref, started_at)
       VALUES (?, NULL, 'running', 'schedule', 'automation:a1', 'activity', 'git_commit', 1)`
    ).run('r1');
    const row = db.prepare(`SELECT * FROM workflow_runs WHERE id = 'r1'`).get() as Record<
      string,
      unknown
    >;
    expect(row.initiator).toBe('automation:a1');
    db.close();
  });
});
