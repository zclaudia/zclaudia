import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, rm, symlink, writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { registerAgentTools } from '../index.js';
import { toolRegistry } from '../../../../application/plugins/index.js';

function createDb(projectRoot: string): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      working_directory TEXT
    );

    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      root_path TEXT
    );
  `);
  db.prepare(`INSERT INTO projects (id, root_path) VALUES ('project-1', ?)`).run(projectRoot);
  db.prepare(`INSERT INTO sessions (id, project_id) VALUES ('session-1', 'project-1')`).run();
  return db;
}

describe('agent-tools/agent_file_ops', () => {
  const tempDirs: string[] = [];
  let projectRoot: string;
  let outsideDir: string;
  let db: Database.Database;

  beforeEach(async () => {
    toolRegistry.clear();
    projectRoot = await mkdtemp(path.join(tmpdir(), 'agent-file-ops-project-'));
    outsideDir = await mkdtemp(path.join(tmpdir(), 'agent-file-ops-outside-'));
    tempDirs.push(projectRoot, outsideDir);
    db = createDb(projectRoot);
    registerAgentTools({ getDb: () => db });
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  function execute(args: Record<string, unknown>) {
    return toolRegistry.execute(
      'agent_file_ops',
      args,
      { sessionId: 'session-1' },
      'agent-assistant'
    );
  }

  it('writes and reads a normal file inside the project', async () => {
    const writeResult = await execute({
      operation: 'write',
      path: 'notes/todo.txt',
      content: 'hello',
    });
    expect(JSON.parse(writeResult)).toEqual({
      success: true,
      path: path.join('notes', 'todo.txt'),
    });
    expect(await readFile(path.join(projectRoot, 'notes', 'todo.txt'), 'utf-8')).toBe('hello');

    const readResult = await execute({ operation: 'read', path: 'notes/todo.txt' });
    expect(JSON.parse(readResult)).toEqual({
      content: 'hello',
      path: path.join('notes', 'todo.txt'),
    });
  });

  it('rejects path traversal outside the project', async () => {
    const result = await execute({
      operation: 'write',
      path: '../escape.txt',
      content: 'pwned',
    });

    expect(JSON.parse(result)).toEqual({ error: 'Path is outside the project directory' });
    expect(existsSync(path.join(outsideDir, 'escape.txt'))).toBe(false);
    expect(existsSync(path.join(path.dirname(projectRoot), 'escape.txt'))).toBe(false);
  });

  it('rejects writes through a DANGLING symlink pointing outside the project (P1-14)', async () => {
    const externalTarget = path.join(outsideDir, 'not-yet-existing.txt');
    await symlink(externalTarget, path.join(projectRoot, 'evil-link'));

    const result = await execute({ operation: 'write', path: 'evil-link', content: 'pwned' });

    expect(JSON.parse(result)).toEqual({ error: 'Path is outside the project directory' });
    // The external target must NOT have been created through the symlink.
    expect(existsSync(externalTarget)).toBe(false);
  });

  it('rejects symlinks even when they point INSIDE the project (policy: no symlinks)', async () => {
    await writeFile(path.join(projectRoot, 'real.txt'), 'real content');
    await symlink(path.join(projectRoot, 'real.txt'), path.join(projectRoot, 'alias-link'));

    const writeResult = await execute({
      operation: 'write',
      path: 'alias-link',
      content: 'changed',
    });
    expect(JSON.parse(writeResult)).toEqual({ error: 'Path is outside the project directory' });

    const readResult = await execute({ operation: 'read', path: 'alias-link' });
    expect(JSON.parse(readResult)).toEqual({ error: 'Path is outside the project directory' });

    // The underlying file is untouched.
    expect(await readFile(path.join(projectRoot, 'real.txt'), 'utf-8')).toBe('real content');
  });

  it('caps reads at 64KB with a truncation notice and total size (P1-16)', async () => {
    const bigContent = 'x'.repeat(70 * 1024);
    await writeFile(path.join(projectRoot, 'big.txt'), bigContent);

    const result = await execute({ operation: 'read', path: 'big.txt' });
    const parsed = JSON.parse(result);

    expect(parsed.truncated).toBe(true);
    expect(parsed.totalBytes).toBe(70 * 1024);
    expect(parsed.message).toContain('truncated');
    expect(parsed.content.length).toBeLessThanOrEqual(64 * 1024);
  });

  it('rejects writes above the 1MB limit (P1-16)', async () => {
    const hugeContent = 'y'.repeat(1024 * 1024 + 1);

    const result = await execute({ operation: 'write', path: 'huge.txt', content: hugeContent });
    const parsed = JSON.parse(result);

    expect(parsed.error).toContain('write limit');
    expect(existsSync(path.join(projectRoot, 'huge.txt'))).toBe(false);
  });

  it('lists directories inside the project', async () => {
    await mkdir(path.join(projectRoot, 'src'));
    await writeFile(path.join(projectRoot, 'src', 'index.ts'), 'export {}');

    const result = await execute({ operation: 'list', path: 'src' });

    expect(JSON.parse(result)).toEqual([{ name: 'index.ts', type: 'file' }]);
  });
});
