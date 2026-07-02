import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { MessageEntry } from '@earendil-works/pi-agent-core';
import { migration } from '../../../../storage/migrations/021_session_entries.js';
import { SqliteSessionStorage } from '../sqlite-session-storage.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);`);
  db.exec(`INSERT INTO sessions (id, created_at) VALUES ('s1', 1000);`);
  db.exec(migration.sql);
  return db;
}

function userEntry(id: string, parentId: string | null, text: string): MessageEntry {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: '2026-06-20T00:00:00.000Z',
    message: { role: 'user', content: text } as MessageEntry['message'],
  };
}

describe('SqliteSessionStorage', () => {
  let db: Database.Database;
  let storage: SqliteSessionStorage;
  beforeEach(() => {
    db = makeDb();
    storage = new SqliteSessionStorage(db, 's1');
  });

  it('createEntryId returns a fresh uuid each call', async () => {
    const a = await storage.createEntryId();
    const b = await storage.createEntryId();
    expect(a).not.toEqual(b);
    expect(a).toMatch(/[0-9a-f-]{36}/);
  });

  it('appendEntry + getEntry round-trips a typed entry', async () => {
    const e = userEntry('e1', null, 'hello');
    await storage.appendEntry(e);
    expect(await storage.getEntry('e1')).toEqual(e);
  });

  it('getLeafId / setLeafId persists the active leaf', async () => {
    expect(await storage.getLeafId()).toBeNull();
    await storage.appendEntry(userEntry('e2', null, 'x'));
    await storage.setLeafId('e2');
    expect(await storage.getLeafId()).toBe('e2');
    await storage.appendEntry(userEntry('e3', 'e2', 'y'));
    await storage.setLeafId('e3');
    expect(await storage.getLeafId()).toBe('e3');
  });

  it('appendEntry advances the leaf to the appended entry', async () => {
    await storage.appendEntry(userEntry('e1', null, 'a'));
    expect(await storage.getLeafId()).toBe('e1');
    await storage.appendEntry(userEntry('e2', 'e1', 'b'));
    expect(await storage.getLeafId()).toBe('e2');
  });

  it('setLeafId throws not_found for a non-existent target', async () => {
    await expect(storage.setLeafId('ghost')).rejects.toThrow(/not found/i);
  });

  it('setLeafId(null) is allowed (resets to empty)', async () => {
    await storage.appendEntry(userEntry('e1', null, 'a'));
    await storage.setLeafId(null);
    expect(await storage.getLeafId()).toBeNull();
  });

  it('getPathToRoot walks parent_id from leaf to root in root→leaf order', async () => {
    await storage.appendEntry(userEntry('e1', null, 'a'));
    await storage.appendEntry(userEntry('e2', 'e1', 'b'));
    await storage.appendEntry(userEntry('e3', 'e2', 'c'));
    const path = await storage.getPathToRoot('e3');
    expect(path.map(p => p.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('getPathToRoot(null) returns empty', async () => {
    expect(await storage.getPathToRoot(null)).toEqual([]);
  });

  it('findEntries filters by type', async () => {
    await storage.appendEntry(userEntry('e1', null, 'a'));
    expect((await storage.findEntries('message')).map(e => e.id)).toEqual(['e1']);
    expect(await storage.findEntries('compaction')).toEqual([]);
  });

  it('getLabel returns the latest label targeting an entry', async () => {
    await storage.appendEntry(userEntry('e1', null, 'a'));
    await storage.appendEntry({
      type: 'label',
      id: 'l1',
      parentId: 'e1',
      timestamp: '2026-06-20T00:00:01.000Z',
      targetId: 'e1',
      label: 'first',
    });
    await storage.appendEntry({
      type: 'label',
      id: 'l2',
      parentId: 'l1',
      timestamp: '2026-06-20T00:00:02.000Z',
      targetId: 'e1',
      label: 'second',
    });
    expect(await storage.getLabel('e1')).toBe('second');
  });

  it('getMetadata returns id + ISO createdAt, throws when session missing', async () => {
    const meta = await storage.getMetadata();
    expect(meta.id).toBe('s1');
    expect(meta.createdAt).toBe(new Date(1000).toISOString());
    const missing = new SqliteSessionStorage(db, 'nope');
    await expect(missing.getMetadata()).rejects.toThrow();
  });

  it('getEntry returns undefined for a missing id', async () => {
    expect(await storage.getEntry('nonexistent')).toBeUndefined();
  });

  it('getPathToRoot throws for a non-existent non-null leaf', async () => {
    await expect(storage.getPathToRoot('ghost')).rejects.toThrow(/not found/i);
  });

  it('getPathToRoot throws when the parent chain is broken (does not reach root)', async () => {
    await storage.appendEntry(userEntry('e1', null, 'a'));
    await storage.appendEntry(userEntry('e2', 'e1', 'b'));
    await storage.appendEntry(userEntry('e3', 'e2', 'c'));
    // Break the chain: remove the middle entry so e3's path can't reach root.
    db.prepare(`DELETE FROM session_entries WHERE id = 'e2' AND session_id = 's1'`).run();
    await expect(storage.getPathToRoot('e3')).rejects.toThrow(/broken|root/i);
  });

  it('round-trips a CompactionEntry with optional details + fromHook', async () => {
    const entry = {
      type: 'compaction' as const,
      id: 'c1',
      parentId: 'e1',
      timestamp: '2026-06-20T00:00:05.000Z',
      summary: 'SUM',
      firstKeptEntryId: 'e1',
      tokensBefore: 42,
      details: { source: 'auto', readFiles: ['a.ts'], modifiedFiles: [] },
      fromHook: false,
    };
    await storage.appendEntry(entry as Parameters<typeof storage.appendEntry>[0]);
    expect(await storage.getEntry('c1')).toEqual(entry);
  });
});
