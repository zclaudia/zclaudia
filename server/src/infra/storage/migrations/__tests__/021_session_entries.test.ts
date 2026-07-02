import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migration } from '../021_session_entries.js';

describe('migration 021_session_entries', () => {
  it('creates session_entries and session_leaf with expected columns', () => {
    const db = new Database(':memory:');
    db.exec(migration.sql);

    const entryCols = (
      db.prepare(`PRAGMA table_info(session_entries)`).all() as Array<{ name: string }>
    )
      .map(c => c.name)
      .sort();
    expect(entryCols).toEqual(['id', 'parent_id', 'payload', 'session_id', 'timestamp', 'type']);

    const leafCols = (
      db.prepare(`PRAGMA table_info(session_leaf)`).all() as Array<{ name: string }>
    )
      .map(c => c.name)
      .sort();
    expect(leafCols).toEqual(['leaf_id', 'session_id']);

    const idx = (
      db.prepare(`PRAGMA index_list(session_entries)`).all() as Array<{ name: string }>
    ).map(i => i.name);
    expect(idx).toContain('idx_session_entries_parent');

    // composite primary key (session_id, id)
    const pk = (
      db.prepare(`PRAGMA table_info(session_entries)`).all() as Array<{ name: string; pk: number }>
    )
      .filter(c => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map(c => c.name);
    expect(pk).toEqual(['session_id', 'id']);
  });
});
