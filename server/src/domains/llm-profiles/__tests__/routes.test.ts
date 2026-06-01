import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { createLlmProfileRoutes } from '../routes.js';
import { LlmProfileRepository } from '../repository.js';
import { AgentProfileRepository } from '../../agent-profiles/repository.js';

function buildApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  app.use('/api/llm-profiles', createLlmProfileRoutes(db));
  return app;
}

describe('llm-profiles routes', () => {
  let db: Database.Database;
  let app: express.Express;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    app = buildApp(db);
  });

  it('DELETE returns 200 for an unreferenced profile', async () => {
    const lp = new LlmProfileRepository(db).create({
      name: 'lp',
      providerType: 'anthropic',
      apiKey: 'sk',
    });
    const res = await request(app).delete(`/api/llm-profiles/${lp.id}`);
    expect(res.status).toBe(200);
  });

  it('DELETE returns 404 for an unknown id', async () => {
    const res = await request(app).delete('/api/llm-profiles/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('DELETE returns 409 when an agent_profile references the LLM profile', async () => {
    const lp = new LlmProfileRepository(db).create({
      name: 'lp',
      providerType: 'anthropic',
      apiKey: 'sk',
    });
    new AgentProfileRepository(db).create({
      name: 'coder',
      llmProfileId: lp.id,
      model: 'claude-sonnet-4-6',
      systemPrompt: '',
      enabledTools: ['read'],
    });

    const res = await request(app).delete(`/api/llm-profiles/${lp.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IN_USE');
    expect(res.body.error.agentCount).toBe(1);
    expect(res.body.error.message).toMatch(/agent profile/i);

    // Profile must remain after a rejected delete.
    const check = await request(app).get(`/api/llm-profiles/${lp.id}`);
    expect(check.status).toBe(200);
  });
});
