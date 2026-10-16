import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyPendingMigrations, migrations } from '../index.js';
import { migration } from '../048_project_additional_paths.js';
import { ProjectRepository } from '../../../../domains/projects/repository.js';

function dbBefore048() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyPendingMigrations(
    db,
    migrations.filter(m => m.name < migration.name)
  );
  return db;
}

describe('048_project_additional_paths', () => {
  it('adds the column without disturbing existing projects', () => {
    const db = dbBefore048();
    db.exec(
      `INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES ('p', 'Old', '/r', 1, 1)`
    );

    applyPendingMigrations(db, migrations);

    const repo = new ProjectRepository(db);
    expect(repo.findById('p')?.additionalPaths).toEqual([]);
    repo.update('p', { additionalPaths: ['/a', '/b'] });
    expect(repo.findById('p')?.additionalPaths).toEqual(['/a', '/b']);
    repo.update('p', { additionalPaths: [] });
    expect(repo.findById('p')?.additionalPaths).toEqual([]);
  });

  it('tolerates a corrupt column value', () => {
    const db = dbBefore048();
    applyPendingMigrations(db, migrations);
    db.exec(
      `INSERT INTO projects (id, name, additional_paths, created_at, updated_at) VALUES ('p', 'X', 'not json', 1, 1)`
    );
    expect(new ProjectRepository(db).findById('p')?.additionalPaths).toEqual([]);
  });
});
