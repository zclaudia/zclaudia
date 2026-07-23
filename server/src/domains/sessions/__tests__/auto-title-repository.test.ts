import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SessionRepository } from '../repository.js';
import { SessionMessageRepository } from '../message-repository.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT,
      agent_profile_id TEXT NOT NULL DEFAULT 'a', sdk_session_id TEXT,
      type TEXT, parent_session_id TEXT, working_directory TEXT, sort_order INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, archived_at INTEGER,
      project_role TEXT, task_id TEXT, plan_status TEXT, is_read_only INTEGER,
      last_run_status TEXT, auto_title TEXT, auto_title_msg_count INTEGER
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, metadata TEXT, created_at INTEGER NOT NULL, offset INTEGER
    );
    INSERT INTO sessions (id, project_id, agent_profile_id, type, created_at, updated_at)
      VALUES ('s1', 'p1', 'a', 'regular', 100, 100);
    INSERT INTO messages (id, session_id, role, content, created_at) VALUES
      ('m1','s1','user','hi',1), ('m2','s1','assistant','yo',2), ('m3','s1','user','more',3);
  `);
  return db;
}

describe('auto-title repository support', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
  });

  it('updateAutoTitle persists title + count without bumping updated_at', () => {
    const repo = new SessionRepository(db);
    repo.updateAutoTitle('s1', 'My Topic', 3);
    const s = repo.findById('s1')!;
    expect(s.autoTitle).toBe('My Topic');
    expect(s.autoTitleMsgCount).toBe(3);
    expect(s.updatedAt).toBe(100); // unchanged
  });

  it('countUserMessagesBySession counts only user-role messages', () => {
    const msgRepo = new SessionMessageRepository(db);
    expect(msgRepo.countUserMessagesBySession('s1')).toBe(2);
  });
});

describe('SessionRepository.getMessageVersion', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT,
        agent_profile_id TEXT NOT NULL DEFAULT 'a', sdk_session_id TEXT,
        type TEXT, parent_session_id TEXT, working_directory TEXT, sort_order INTEGER,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, archived_at INTEGER,
        project_role TEXT, task_id TEXT, plan_status TEXT, is_read_only INTEGER,
        last_run_status TEXT, auto_title TEXT, auto_title_msg_count INTEGER,
        message_version INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO sessions (id, project_id, agent_profile_id, type, created_at, updated_at, message_version)
        VALUES ('s1', 'p1', 'a', 'regular', 100, 100, 7);
    `);
  });

  it('returns the stored message_version for an existing session', () => {
    const repo = new SessionRepository(db);
    expect(repo.getMessageVersion('s1')).toBe(7);
  });

  it('returns 0 when the session does not exist', () => {
    const repo = new SessionRepository(db);
    expect(repo.getMessageVersion('missing')).toBe(0);
  });
});
