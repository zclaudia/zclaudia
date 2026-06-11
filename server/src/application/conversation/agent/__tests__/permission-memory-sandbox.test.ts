import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { loadSessionSandboxDomains, persistSessionSandboxDomain } from '../permission-memory.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE permission_memories (
      session_id TEXT NOT NULL,
      remember_key TEXT NOT NULL,
      decision TEXT CHECK(decision IN ('allow','deny')) NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, remember_key)
    );
  `);
  return db;
}

describe('session sandbox domains', () => {
  let db: Database.Database;
  beforeEach(() => { db = makeDb(); });

  it('returns [] when nothing is persisted', () => {
    expect(loadSessionSandboxDomains(db, 's1')).toEqual([]);
  });

  it('persists and reloads a granted domain (scoped per session)', () => {
    persistSessionSandboxDomain(db, 's1', 'example.com');
    persistSessionSandboxDomain(db, 's2', 'other.com');
    expect(loadSessionSandboxDomains(db, 's1')).toEqual(['example.com']);
    expect(loadSessionSandboxDomains(db, 's2')).toEqual(['other.com']);
  });

  it('is idempotent on repeated grants of the same domain', () => {
    persistSessionSandboxDomain(db, 's1', 'example.com');
    persistSessionSandboxDomain(db, 's1', 'example.com');
    expect(loadSessionSandboxDomains(db, 's1')).toEqual(['example.com']);
  });

  it('does not return ordinary remembered decisions as domains', () => {
    db.prepare("INSERT INTO permission_memories VALUES ('s1','Bash:abc','allow',1,1)").run();
    persistSessionSandboxDomain(db, 's1', 'example.com');
    expect(loadSessionSandboxDomains(db, 's1')).toEqual(['example.com']);
  });
});
