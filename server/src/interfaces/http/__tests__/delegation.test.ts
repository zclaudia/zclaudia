import { beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createDelegationRoutes } from '../delegation.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS delegation_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      config TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO delegation_config (id, config, created_at, updated_at)
    VALUES (1, '{}', 1, 1);

    CREATE TABLE IF NOT EXISTS llm_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL DEFAULT 'anthropic',
      base_url TEXT,
      api_key TEXT,
      compat TEXT,
      env TEXT,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

function createTestApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  app.use('/api/delegation', createDelegationRoutes(db));
  return app;
}

describe('delegation routes', () => {
  const db = createTestDb();
  const app = createTestApp(db);

  beforeEach(() => {
    db.exec('DELETE FROM llm_profiles');
    db.prepare("UPDATE delegation_config SET config = '{}', updated_at = 1 WHERE id = 1").run();
  });

  it('accepts an analysisLlmProfileId that points to an existing provider', async () => {
    const now = Date.now();
    db.prepare(
      `
      INSERT INTO llm_profiles (id, name, provider_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run('p-zclaudia', 'ZClaudia', 'zclaudia', now, now);

    const res = await request(app)
      .put('/api/delegation/config')
      .send({ analysisLlmProfileId: 'p-zclaudia' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.analysisLlmProfileId).toBe('p-zclaudia');
  });

  it('rejects an analysisLlmProfileId that does not exist', async () => {
    const res = await request(app)
      .put('/api/delegation/config')
      .send({ analysisLlmProfileId: 'missing-provider' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('not found');
  });
});
