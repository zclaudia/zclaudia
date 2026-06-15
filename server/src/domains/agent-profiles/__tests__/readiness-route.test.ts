import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { createAgentProfileRoutes } from '../routes.js';

function buildApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  app.use('/api/agent-profiles', createAgentProfileRoutes(db));
  return app;
}

describe('GET /api/agent-profiles/readiness', () => {
  let app: express.Express;

  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    app = buildApp(db);
  });

  it('returns no_agent on a fresh DB (no agents)', async () => {
    const res = await request(app).get('/api/agent-profiles/readiness');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ usable: false, reason: 'no_agent' });
  });

  it('does not collide with the /:id route', async () => {
    const res = await request(app).get('/api/agent-profiles/readiness');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('usable');
  });
});
