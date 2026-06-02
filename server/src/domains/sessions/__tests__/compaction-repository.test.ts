import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';

describe('session_compactions schema (smoke)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
  });

  it('round-trips a row through raw SQL', () => {
    db.prepare(`INSERT INTO llm_profiles (id, name, provider_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('lp1', 'p', 'anthropic', 0, 0);
    db.prepare(`INSERT INTO agent_profiles (id, name, llm_profile_id, model, system_prompt, enabled_tools, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('ap1', 'a', 'lp1', 'm', '', '[]', 0, 0);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('p1', 'P', 'code', 0, 0);
    db.prepare(`INSERT INTO sessions (id, project_id, agent_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('s1', 'p1', 'ap1', 0, 0);
    db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at, offset) VALUES (?, ?, ?, ?, ?, ?)`).run('m1', 's1', 'user', 'hi', 0, 1);

    db.prepare(`INSERT INTO session_compactions (id, session_id, summary, first_kept_message_id, tokens_before, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('c1', 's1', 'sum', 'm1', 100, 'auto', 0);

    const row = db.prepare('SELECT * FROM session_compactions WHERE id = ?').get('c1') as any;
    expect(row.session_id).toBe('s1');
    expect(row.summary).toBe('sum');
    expect(row.first_kept_message_id).toBe('m1');
    expect(row.tokens_before).toBe(100);
    expect(row.source).toBe('auto');
  });
});
