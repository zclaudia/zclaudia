import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m033 } from '../033_backfill_rest_message_offset.js';
import { migrations } from '../index.js';

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
function ins(
  db: Database.Database,
  id: string,
  sid: string,
  createdAt: number,
  offset: number | null
) {
  db.prepare(
    `INSERT INTO messages (id, session_id, role, content, created_at, offset) VALUES (?, ?, 'user', '', ?, ?)`
  ).run(id, sid, createdAt, offset);
}

describe('033_backfill_rest_message_offset', () => {
  it('renumbers sessions containing NULL offsets to contiguous 1..N by created_at', () => {
    const db = dbWithMessages();
    ins(db, 'a', 's1', 100, 1);
    ins(db, 'b', 's1', 200, 2);
    ins(db, 'c', 's1', 300, null); // REST-created row
    db.exec(m033.sql);
    const rows = db
      .prepare(`SELECT id, offset FROM messages WHERE session_id = 's1' ORDER BY offset`)
      .all();
    expect(rows).toEqual([
      { id: 'a', offset: 1 },
      { id: 'b', offset: 2 },
      { id: 'c', offset: 3 },
    ]);
  });

  it('leaves sessions without NULL offsets untouched', () => {
    const db = dbWithMessages();
    ins(db, 'a', 's1', 100, 3); // stray numbering but no NULLs — not our business
    ins(db, 'b', 's1', 200, 9);
    ins(db, 'x', 's2', 100, null); // s2 has a NULL, gets renumbered
    db.exec(m033.sql);
    const s1 = db
      .prepare(`SELECT id, offset FROM messages WHERE session_id = 's1' ORDER BY offset`)
      .all();
    expect(s1).toEqual([
      { id: 'a', offset: 3 },
      { id: 'b', offset: 9 },
    ]);
    const s2 = db.prepare(`SELECT offset FROM messages WHERE session_id = 's2'`).get() as {
      offset: number;
    };
    expect(s2.offset).toBe(1);
  });

  it('is idempotent — running twice yields the same numbering', () => {
    const db = dbWithMessages();
    ins(db, 'a', 's1', 100, 1);
    ins(db, 'b', 's1', 200, null);
    db.exec(m033.sql);
    db.exec(m033.sql);
    const rows = db
      .prepare(`SELECT id, offset FROM messages WHERE session_id = 's1' ORDER BY offset`)
      .all();
    expect(rows).toEqual([
      { id: 'a', offset: 1 },
      { id: 'b', offset: 2 },
    ]);
  });

  it('is registered in the migrations list after 032', () => {
    const names = migrations.map(m => m.name);
    const idx = names.indexOf('033_backfill_rest_message_offset');
    expect(idx).toBe(names.indexOf('032_windowed_usage_stats_index') + 1);
  });
});
