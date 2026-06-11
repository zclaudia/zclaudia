import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { resolveUserHooks } from '../resolve-user-hooks.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      enabled INTEGER NOT NULL DEFAULT 1,
      hooks TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      hooks_override TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  const now = Date.now();
  db.prepare('INSERT INTO agent_config (id, enabled, created_at, updated_at) VALUES (1, 1, ?, ?)').run(now, now);
  return db;
}

describe('resolveUserHooks', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb();
  });

  it('merges global then project hooks, filtering disabled', () => {
    const now = Date.now();
    db.prepare('UPDATE agent_config SET hooks = ? WHERE id = 1').run(
      JSON.stringify([
        { event: 'PreToolUse', command: 'g1' },
        { event: 'PreToolUse', command: 'g2', enabled: false },
      ]),
    );
    db.prepare('INSERT INTO projects (id, name, hooks_override, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      'proj-1',
      'Test Project',
      JSON.stringify([{ event: 'PostToolUse', command: 'p1' }]),
      now,
      now,
    );

    const hooks = resolveUserHooks(db, 'proj-1');
    expect(hooks.map((h) => h.command)).toEqual(['g1', 'p1']);
  });

  it('tolerates corrupt JSON and missing rows', () => {
    db.prepare('UPDATE agent_config SET hooks = ? WHERE id = 1').run('{bad');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hooks = resolveUserHooks(db, 'nope');
    expect(hooks).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('drops invalid entries and warns', () => {
    db.prepare('UPDATE agent_config SET hooks = ? WHERE id = 1').run(
      JSON.stringify([
        { event: 'PreToolUse', command: 'valid' },
        { event: 'Nope', command: 'x' },
      ]),
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hooks = resolveUserHooks(db, 'no-project');
    expect(hooks.map((h) => h.command)).toEqual(['valid']);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns empty array when no hooks configured', () => {
    const hooks = resolveUserHooks(db, 'any-project');
    expect(hooks).toEqual([]);
  });

  it('returns only global hooks when project has no hooks_override', () => {
    const now = Date.now();
    db.prepare('UPDATE agent_config SET hooks = ? WHERE id = 1').run(
      JSON.stringify([{ event: 'PreToolUse', command: 'g1' }]),
    );
    db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      'proj-no-hooks',
      'No Hooks Project',
      now,
      now,
    );

    const hooks = resolveUserHooks(db, 'proj-no-hooks');
    expect(hooks.map((h) => h.command)).toEqual(['g1']);
  });

  it('returns only project hooks when global has none', () => {
    const now = Date.now();
    db.prepare('INSERT INTO projects (id, name, hooks_override, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      'proj-only',
      'Project Only',
      JSON.stringify([{ event: 'PostToolUse', command: 'p1' }]),
      now,
      now,
    );

    const hooks = resolveUserHooks(db, 'proj-only');
    expect(hooks.map((h) => h.command)).toEqual(['p1']);
  });
});
