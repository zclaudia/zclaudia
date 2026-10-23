import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyPendingMigrations, migrations } from '../index.js';
import { migration } from '../050_design_snapshots.js';

function dbBefore050() {
  const db = new Database(':memory:');
  applyPendingMigrations(db, migrations.filter(m => m.name < migration.name));
  return db;
}

describe('050_design_snapshots', () => {
  it('creates the snapshot tables and index', () => {
    const db = dbBefore050();
    applyPendingMigrations(db, migrations);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('design_snapshots', 'design_snapshot_files', 'design_restore_log')"
      )
      .all() as Array<{ name: string }>;
    expect(tables.map(row => row.name).sort()).toEqual([
      'design_restore_log',
      'design_snapshot_files',
      'design_snapshots',
    ]);
    const index = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_design_snapshots_ws'")
      .get();
    expect(index).toBeTruthy();

    db.prepare(
      `INSERT INTO design_snapshots (id, workspace_root, session_id, entry_path, label, source, run_id, complete, incomplete_reasons, file_count, total_bytes, created_at)
       VALUES ('ds1', '/w', 's', 'index.html', NULL, 'manual', NULL, 1, '[]', 1, 10, 1)`
    ).run();
    db.prepare(
      `INSERT INTO design_snapshot_files (snapshot_id, path, sha256, bytes, kind, mime)
       VALUES ('ds1', 'index.html', '${'a'.repeat(64)}', 10, 'entry', 'text/html')`
    ).run();
    // Composite primary key rejects duplicate paths per snapshot.
    expect(() =>
      db
        .prepare(
          `INSERT INTO design_snapshot_files (snapshot_id, path, sha256, bytes, kind, mime)
           VALUES ('ds1', 'index.html', '${'b'.repeat(64)}', 10, 'entry', 'text/html')`
        )
        .run()
    ).toThrow();
  });

  it('is idempotent: applying the migration set twice does not throw', () => {
    const db = dbBefore050();
    applyPendingMigrations(db, migrations);
    expect(() => applyPendingMigrations(db, migrations)).not.toThrow();
    // Even a raw re-execution of the SQL is safe (IF NOT EXISTS everywhere).
    expect(() => db.exec(migration.sql)).not.toThrow();
    const count = db
      .prepare("SELECT COUNT(*) AS count FROM migrations WHERE name = '050_design_snapshots'")
      .get() as { count: number };
    expect(count.count).toBe(1);
  });
});
