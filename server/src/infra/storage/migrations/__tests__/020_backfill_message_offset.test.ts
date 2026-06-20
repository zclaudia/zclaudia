import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m020 } from '../020_backfill_message_offset.js';

function dbWithMessages(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, metadata TEXT, created_at INTEGER NOT NULL, offset INTEGER
    );
  `);
  return db;
}
function ins(db: Database.Database, id: string, sid: string, createdAt: number, offset: number | null) {
  db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at, offset) VALUES (?, ?, 'user', '', ?, ?)`)
    .run(id, sid, createdAt, offset);
}

describe('020_backfill_message_offset', () => {
  it('renumbers offset per session to contiguous 1..N by created_at, filling NULLs', () => {
    const db = dbWithMessages();
    ins(db, 'a', 's1', 100, null);   // NULL offset
    ins(db, 'b', 's1', 200, null);
    ins(db, 'c', 's1', 300, 7);      // stray large offset
    ins(db, 'x', 's2', 150, null);   // other session independent
    db.exec(m020.sql);
    const rows = db.prepare(`SELECT id, offset FROM messages WHERE session_id = 's1' ORDER BY offset`).all() as Array<{ id: string; offset: number }>;
    expect(rows).toEqual([{ id: 'a', offset: 1 }, { id: 'b', offset: 2 }, { id: 'c', offset: 3 }]);
    const s2 = db.prepare(`SELECT offset FROM messages WHERE session_id = 's2'`).get() as { offset: number };
    expect(s2.offset).toBe(1);
  });

  it('is idempotent — running twice yields the same numbering', () => {
    const db = dbWithMessages();
    ins(db, 'a', 's1', 100, null);
    ins(db, 'b', 's1', 200, null);
    db.exec(m020.sql);
    db.exec(m020.sql);
    const rows = db.prepare(`SELECT id, offset FROM messages WHERE session_id = 's1' ORDER BY offset`).all();
    expect(rows).toEqual([{ id: 'a', offset: 1 }, { id: 'b', offset: 2 }]);
  });

  it('breaks created_at ties by existing offset then id', () => {
    const db = dbWithMessages();
    ins(db, 'u', 's1', 100, 1);   // same created_at; existing offset says u(1) before a(2)
    ins(db, 'a', 's1', 100, 2);
    db.exec(m020.sql);
    const rows = db.prepare(`SELECT id, offset FROM messages WHERE session_id = 's1' ORDER BY offset`).all();
    expect(rows).toEqual([{ id: 'u', offset: 1 }, { id: 'a', offset: 2 }]);
  });
});
