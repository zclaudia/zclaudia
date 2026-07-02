import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createAgentRoutes } from '../agent.js';
import {
  createAgentProfilesTable,
  seedDefaultAgent,
} from '../../../test-helpers/seed-default-agent.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      enabled INTEGER NOT NULL DEFAULT 1,
      project_id TEXT,
      session_id TEXT,
      llm_profile_id TEXT,
      permission_workflow_override_id TEXT,
      permission_policy TEXT,
      hooks TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT CHECK(type IN ('chat_only', 'code')) DEFAULT 'code',
      llm_profile_id TEXT,
      root_path TEXT,
      system_prompt TEXT,
      permission_policy TEXT,
      agent_permission_override TEXT,
      is_internal INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT,
      agent_profile_id TEXT,
      sdk_session_id TEXT,
      type TEXT DEFAULT 'regular',
      parent_session_id TEXT,
      archived_at INTEGER,
      working_directory TEXT,
      project_role TEXT,
      task_id TEXT,
      plan_status TEXT,
      is_read_only INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS llm_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'claude',
      cli_path TEXT,
      env TEXT,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      is_system INTEGER NOT NULL DEFAULT 0
    );
  `);
  createAgentProfilesTable(db);

  return db;
}

function createTestApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', createAgentRoutes(db));
  return app;
}

function seedDefaultConfig(db: Database.Database) {
  const now = Date.now();
  db.prepare(
    `
    INSERT OR IGNORE INTO agent_config (id, enabled, created_at, updated_at)
    VALUES (1, 1, ?, ?)
  `
  ).run(now, now);
}

describe('agent config hooks', () => {
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
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM projects');
    db.exec('DELETE FROM llm_profiles');
    db.exec('DELETE FROM agent_profiles');
    db.exec('DELETE FROM workflows');
    db.exec('DELETE FROM agent_config');
    seedDefaultAgent(db);
    seedDefaultConfig(db);
  });

  describe('PUT /api/agent/config — hooks field', () => {
    it('accepts a valid hooks array and returns it as stored JSON', async () => {
      const hooks = [{ event: 'PreToolUse', command: 'echo hello' }];
      const res = await request(app).put('/api/agent/config').send({ hooks });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.hooks).toBe(JSON.stringify(hooks));
    });

    it('rejects a hooks array containing an invalid entry', async () => {
      const hooks = [{ event: 'Nope', command: 'echo bad' }];
      const res = await request(app).put('/api/agent/config').send({ hooks });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('invalid event');
    });

    it('rejects hooks with a missing command', async () => {
      const hooks = [{ event: 'PreToolUse' }];
      const res = await request(app).put('/api/agent/config').send({ hooks });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('missing command');
    });

    it('GET /api/agent/config returns hooks field', async () => {
      const hooks = [{ event: 'PostToolUse', command: 'echo done' }];
      db.prepare('UPDATE agent_config SET hooks = ? WHERE id = 1').run(JSON.stringify(hooks));

      const res = await request(app).get('/api/agent/config');
      expect(res.status).toBe(200);
      expect(res.body.data.hooks).toBe(JSON.stringify(hooks));
    });

    it('GET returns hooks: null when no hooks configured', async () => {
      const res = await request(app).get('/api/agent/config');
      expect(res.status).toBe(200);
      expect(res.body.data.hooks).toBeNull();
    });

    it('hooks field is not overwritten when omitted from PUT', async () => {
      const hooks = [{ event: 'PreToolUse', command: 'persist me' }];
      db.prepare('UPDATE agent_config SET hooks = ? WHERE id = 1').run(JSON.stringify(hooks));

      const res = await request(app).put('/api/agent/config').send({ enabled: false });

      expect(res.status).toBe(200);
      expect(res.body.data.hooks).toBe(JSON.stringify(hooks));
    });

    it('sets hooks to null when sent as null', async () => {
      const hooks = [{ event: 'PreToolUse', command: 'to be cleared' }];
      db.prepare('UPDATE agent_config SET hooks = ? WHERE id = 1').run(JSON.stringify(hooks));

      const res = await request(app).put('/api/agent/config').send({ hooks: null });

      expect(res.status).toBe(200);
      expect(res.body.data.hooks).toBeNull();
    });
  });
});
