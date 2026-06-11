import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createProjectRoutes } from '../../../domains/projects/routes.js';

// Mock git-worktrees to avoid actual git operations
import { vi } from 'vitest';
vi.mock('../../../utils/git-worktrees.js', () => ({
  listGitWorktrees: vi.fn(() => []),
  createGitWorktree: vi.fn(() => ({ path: '/mock/worktree', branch: 'wt-branch', head: 'abc123' })),
}));

function createTestDb(): Database.Database {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT CHECK(type IN ('chat_only', 'code')) DEFAULT 'code',
      default_agent_profile_id TEXT,
      root_path TEXT,
      system_prompt TEXT,
      permission_policy TEXT,
      agent_permission_override TEXT,
      hooks_override TEXT,
      agent TEXT,
      context_sync_status TEXT NOT NULL DEFAULT 'synced',
      review_llm_profile_id TEXT,
      permission_workflow_override_id TEXT,
      is_internal INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      is_system INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT,
      llm_profile_id TEXT,
      sdk_session_id TEXT,
      type TEXT DEFAULT 'regular',
      parent_session_id TEXT,
      archived_at INTEGER,
      working_directory TEXT,
      project_role TEXT,
      task_id TEXT,
      plan_status TEXT,
      is_read_only INTEGER DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT CHECK(role IN ('user', 'assistant', 'system')) NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      offset INTEGER
    );
  `);

  return db;
}

function createTestApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  app.use('/api/projects', createProjectRoutes(db));
  return app;
}

function seedProject(db: Database.Database, id: string): void {
  const now = Date.now();
  db.prepare(`
    INSERT INTO projects (id, name, type, sort_order, created_at, updated_at)
    VALUES (?, ?, 'code', 0, ?, ?)
  `).run(id, 'Test Project', now, now);
}

describe('project hooksOverride routes', () => {
  let db: Database.Database;
  let app: ReturnType<typeof express>;

  beforeAll(() => {
    db = createTestDb();
    app = createTestApp(db);
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    db.exec('DELETE FROM messages');
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM projects');
    db.exec('DELETE FROM workflows');
  });

  describe('PUT /api/projects/:id — hooksOverride field', () => {
    it('accepts a valid hooksOverride array and persists it', async () => {
      seedProject(db, 'proj-1');
      const hooksOverride = [{ event: 'PostToolUse', command: 'echo done' }];

      const res = await request(app)
        .put('/api/projects/proj-1')
        .send({ hooksOverride });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const row = db.prepare('SELECT hooks_override FROM projects WHERE id = ?').get('proj-1') as any;
      expect(JSON.parse(row.hooks_override)).toEqual(hooksOverride);
    });

    it('GET /api/projects/:id returns hooksOverride', async () => {
      seedProject(db, 'proj-2');
      const hooksOverride = [{ event: 'PreToolUse', command: 'lint' }];
      db.prepare('UPDATE projects SET hooks_override = ? WHERE id = ?').run(
        JSON.stringify(hooksOverride),
        'proj-2',
      );

      const res = await request(app).get('/api/projects/proj-2');
      expect(res.status).toBe(200);
      expect(res.body.data.hooksOverride).toEqual(hooksOverride);
    });

    it('rejects hooksOverride with an invalid event', async () => {
      seedProject(db, 'proj-3');
      const hooksOverride = [{ event: 'Nope', command: 'bad' }];

      const res = await request(app)
        .put('/api/projects/proj-3')
        .send({ hooksOverride });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('invalid event');
    });

    it('rejects hooksOverride with a missing command', async () => {
      seedProject(db, 'proj-4');
      const hooksOverride = [{ event: 'PreToolUse' }];

      const res = await request(app)
        .put('/api/projects/proj-4')
        .send({ hooksOverride });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('missing command');
    });

    it('clears hooksOverride when set to null', async () => {
      seedProject(db, 'proj-5');
      db.prepare('UPDATE projects SET hooks_override = ? WHERE id = ?').run(
        JSON.stringify([{ event: 'PreToolUse', command: 'to-clear' }]),
        'proj-5',
      );

      const res = await request(app)
        .put('/api/projects/proj-5')
        .send({ hooksOverride: null });

      expect(res.status).toBe(200);
      const row = db.prepare('SELECT hooks_override FROM projects WHERE id = ?').get('proj-5') as any;
      expect(row.hooks_override).toBeNull();
    });
  });
});
