import express from 'express';
import Database from 'better-sqlite3';
import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { GoalRepository } from '../repository.js';
import { GoalService } from '../service.js';
import { createGoalRoutes } from '../routes.js';

function makeApp() {
  const db = new Database(':memory:');
  applyMigrations(db);
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run('p1', 'p', now, now);
  db.prepare(
    `INSERT INTO llm_profiles (id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run('lp1', 'lp', now, now);
  db.prepare(
    `INSERT INTO agent_profiles (id, name, llm_profile_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('ap1', 'ap', 'lp1', now, now);
  db.prepare(
    `INSERT INTO sessions (id, project_id, agent_profile_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('s1', 'p1', 'ap1', now, now);
  const repo = new GoalRepository(db);
  const svc = new GoalService(repo, { publish: () => {} });
  const app = express();
  app.use(express.json());
  app.use('/sessions/:id/goal', createGoalRoutes(svc));
  return { app, svc, db };
}

describe('goal routes', () => {
  it('GET returns null when no goal', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/sessions/s1/goal');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('PUT creates a goal', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .put('/sessions/s1/goal')
      .send({ objective: 'tests pass' });
    expect(res.status).toBe(201);
    expect(res.body.data.objective).toBe('tests pass');
    expect(res.body.data.status).toBe('active');
  });

  it('PUT rejects empty objective', async () => {
    const { app } = makeApp();
    const res = await request(app).put('/sessions/s1/goal').send({});
    expect(res.status).toBe(400);
  });

  it('PUT returns 409 when active goal exists', async () => {
    const { app, svc } = makeApp();
    svc.setGoal('s1', { objective: 'a' });
    const res = await request(app).put('/sessions/s1/goal').send({ objective: 'b' });
    expect(res.status).toBe(409);
  });

  it('pause / resume cycle', async () => {
    const { app, svc } = makeApp();
    svc.setGoal('s1', { objective: 'a' });
    const paused = await request(app).post('/sessions/s1/goal/pause');
    expect(paused.body.data.status).toBe('paused');
    const resumed = await request(app).post('/sessions/s1/goal/resume');
    expect(resumed.body.data.status).toBe('active');
  });

  it('DELETE clears active goal', async () => {
    const { app, svc } = makeApp();
    svc.setGoal('s1', { objective: 'a' });
    const res = await request(app).delete('/sessions/s1/goal');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('aborted');
  });

  it('returns 404 when pausing without active goal', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/sessions/s1/goal/pause');
    expect(res.status).toBe(404);
  });
});
