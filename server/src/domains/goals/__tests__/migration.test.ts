import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';

describe('session_goals migration', () => {
  it('creates session_goals table with expected columns', () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    const cols = db.prepare("PRAGMA table_info('session_goals')").all() as Array<{
      name: string;
      notnull: number;
    }>;
    const names = cols.map(c => c.name).sort();
    expect(names).toEqual(
      [
        'ended_at',
        'end_reason',
        'id',
        'last_verdict_reason',
        'max_turns',
        'objective_text',
        'session_id',
        'started_at',
        'status',
        'token_budget',
        'tokens_used',
        'turns_used',
      ].sort()
    );
    db.close();
  });

  it('enforces unique active goal per session', () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    const now = Date.now();

    // Create project
    db.prepare(
      `INSERT INTO projects (id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`
    ).run('proj1', 'Test Project', now, now);

    // Create LLM profile
    db.prepare(
      `INSERT INTO llm_profiles (id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`
    ).run('llm1', 'Test LLM', now, now);

    // Create agent profile
    db.prepare(
      `INSERT INTO agent_profiles (id, name, llm_profile_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run('ap1', 'Test Profile', 'llm1', now, now);

    // Create session
    db.prepare(
      `INSERT INTO sessions (id, project_id, agent_profile_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run('s1', 'proj1', 'ap1', now, now);

    const insert = db.prepare(
      `INSERT INTO session_goals
       (id, session_id, objective_text, status, token_budget, tokens_used, max_turns, turns_used, started_at)
       VALUES (?, 's1', 'x', 'active', 100000, 0, 50, 0, ?)`
    );
    insert.run('g1', now);
    expect(() => insert.run('g2', now)).toThrow(/UNIQUE/);
    db.close();
  });
});
