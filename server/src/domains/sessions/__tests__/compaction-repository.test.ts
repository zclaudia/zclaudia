import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { newId } from '../../../utils/uuid.js';
import { SessionCompactionRepository } from '../compaction-repository.js';

function seedSession(db: Database.Database, count = 1): { sessionId: string; messageIds: string[] } {
  db.prepare(`INSERT INTO llm_profiles (id, name, provider_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('lp1', 'p', 'anthropic', 0, 0);
  db.prepare(`INSERT INTO agent_profiles (id, name, llm_profile_id, model, system_prompt, enabled_tools, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('ap1', 'a', 'lp1', 'm', '', '[]', 0, 0);
  db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('p1', 'P', 'code', 0, 0);
  db.prepare(`INSERT INTO sessions (id, project_id, agent_profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('s1', 'p1', 'ap1', 0, 0);
  const messageIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const mid = `m${i + 1}`;
    db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at, offset) VALUES (?, ?, ?, ?, ?, ?)`).run(mid, 's1', 'user', `text${i}`, i * 1000, i + 1);
    messageIds.push(mid);
  }
  return { sessionId: 's1', messageIds };
}

describe('SessionCompactionRepository', () => {
  let db: Database.Database;
  let repo: SessionCompactionRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    repo = new SessionCompactionRepository(db);
  });

  it('create round-trips an auto compaction with no instructions', () => {
    const { messageIds } = seedSession(db, 1);
    const created = repo.create({
      id: newId(), sessionId: 's1', summary: 'sum1',
      firstKeptMessageId: messageIds[0], tokensBefore: 100,
      source: 'auto', createdAt: 1234,
    });
    expect(created.summary).toBe('sum1');
    expect(created.firstKeptMessageId).toBe(messageIds[0]);
    expect(created.source).toBe('auto');
    expect(created.customInstructions).toBeNull();
    expect(created.details).toBeNull();
  });

  it('create round-trips a manual compaction with details + instructions', () => {
    const { messageIds } = seedSession(db, 1);
    const created = repo.create({
      id: newId(), sessionId: 's1', summary: 'sum2',
      firstKeptMessageId: messageIds[0], tokensBefore: 200,
      details: { readFiles: ['/a.ts'], modifiedFiles: ['/b.ts'] },
      source: 'manual', customInstructions: 'focus on auth', createdAt: 5678,
    });
    expect(created.details).toEqual({ readFiles: ['/a.ts'], modifiedFiles: ['/b.ts'] });
    expect(created.source).toBe('manual');
    expect(created.customInstructions).toBe('focus on auth');
  });

  it('getLatest returns null when no compactions exist', () => {
    seedSession(db, 1);
    expect(repo.getLatest('s1')).toBeNull();
  });

  it('getLatest returns most recent by created_at', () => {
    const { messageIds } = seedSession(db, 1);
    repo.create({ id: newId(), sessionId: 's1', summary: 'old', firstKeptMessageId: messageIds[0], tokensBefore: 1, source: 'auto', createdAt: 100 });
    repo.create({ id: newId(), sessionId: 's1', summary: 'mid', firstKeptMessageId: messageIds[0], tokensBefore: 2, source: 'auto', createdAt: 200 });
    repo.create({ id: newId(), sessionId: 's1', summary: 'new', firstKeptMessageId: messageIds[0], tokensBefore: 3, source: 'auto', createdAt: 300 });
    const latest = repo.getLatest('s1')!;
    expect(latest.summary).toBe('new');
  });

  it('list returns all rows in ASC order', () => {
    const { messageIds } = seedSession(db, 1);
    repo.create({ id: newId(), sessionId: 's1', summary: 'a', firstKeptMessageId: messageIds[0], tokensBefore: 1, source: 'auto', createdAt: 100 });
    repo.create({ id: newId(), sessionId: 's1', summary: 'b', firstKeptMessageId: messageIds[0], tokensBefore: 2, source: 'auto', createdAt: 200 });
    const rows = repo.list('s1');
    expect(rows.map((r) => r.summary)).toEqual(['a', 'b']);
  });

  it('cascades on session DELETE', () => {
    const { messageIds } = seedSession(db, 1);
    repo.create({ id: newId(), sessionId: 's1', summary: 'x', firstKeptMessageId: messageIds[0], tokensBefore: 1, source: 'auto', createdAt: 100 });
    db.prepare('DELETE FROM sessions WHERE id = ?').run('s1');
    expect(repo.list('s1')).toEqual([]);
  });

  it('cascades when boundary message is deleted', () => {
    const { messageIds } = seedSession(db, 1);
    repo.create({ id: newId(), sessionId: 's1', summary: 'x', firstKeptMessageId: messageIds[0], tokensBefore: 1, source: 'auto', createdAt: 100 });
    db.prepare('DELETE FROM messages WHERE id = ?').run(messageIds[0]);
    expect(repo.list('s1')).toEqual([]);
  });
});
