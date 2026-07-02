import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../index.js';

describe('029_automations', () => {
  it('creates the automations table with expected columns', () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    const cols = (
      db.prepare(`PRAGMA table_info(automations)`).all() as Array<{ name: string }>
    ).map(c => c.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'project_id',
        'name',
        'description',
        'enabled',
        'trigger',
        'action_kind',
        'action_ref',
        'action_input',
        'is_system',
        'system_key',
        'created_at',
        'updated_at',
      ])
    );
    db.close();
  });
});
