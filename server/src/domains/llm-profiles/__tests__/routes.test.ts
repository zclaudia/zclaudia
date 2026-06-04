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

  describe('requestHeaders validation', () => {
    it('POST with valid requestHeaders → 201', async () => {
      const res = await request(app).post('/api/llm-profiles').send({
        name: 'with-headers',
        providerType: 'openai',
        requestHeaders: { 'X-Org-Id': 'abc' },
      });
      expect(res.status).toBe(201);
      expect(res.body.data.requestHeaders).toEqual({ 'X-Org-Id': 'abc' });
    });

    it('POST rejects Authorization in requestHeaders', async () => {
      const res = await request(app).post('/api/llm-profiles').send({
        name: 'bad',
        providerType: 'openai',
        requestHeaders: { 'Authorization': 'Bearer leaked' },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toMatch(/Authorization/);
    });

    it('POST rejects Content-Type (case-insensitive)', async () => {
      const res = await request(app).post('/api/llm-profiles').send({
        name: 'bad',
        providerType: 'openai',
        requestHeaders: { 'CONTENT-TYPE': 'application/x-evil' },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Content-Type|CONTENT-TYPE/i);
    });

    it('POST rejects Host', async () => {
      const res = await request(app).post('/api/llm-profiles').send({
        name: 'bad',
        providerType: 'openai',
        requestHeaders: { 'host': 'evil.example.com' },
      });
      expect(res.status).toBe(400);
    });

    it('POST rejects non-string header value', async () => {
      const res = await request(app).post('/api/llm-profiles').send({
        name: 'bad',
        providerType: 'openai',
        requestHeaders: { 'X-Foo': 123 },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/X-Foo/);
    });

    it('POST rejects non-object requestHeaders', async () => {
      const res = await request(app).post('/api/llm-profiles').send({
        name: 'bad',
        providerType: 'openai',
        requestHeaders: 'not-an-object',
      });
      expect(res.status).toBe(400);
    });

    it('POST rejects array as requestHeaders', async () => {
      const res = await request(app).post('/api/llm-profiles').send({
        name: 'bad',
        providerType: 'openai',
        requestHeaders: [['X-Foo', 'bar']],
      });
      expect(res.status).toBe(400);
    });

    it('PUT applies same validation', async () => {
      const createRes = await request(app).post('/api/llm-profiles').send({
        name: 'pre',
        providerType: 'openai',
      });
      const id = createRes.body.data.id;
      const res = await request(app).put(`/api/llm-profiles/${id}`).send({
        requestHeaders: { 'Authorization': 'Bearer x' },
      });
      expect(res.status).toBe(400);
    });
  });
});
