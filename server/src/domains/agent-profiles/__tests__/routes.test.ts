import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { createAgentProfileRoutes } from '../routes.js';
import { LlmProfileRepository } from '../../llm-profiles/repository.js';

function buildApp(db: Database.Database) {
  const app = express();
  app.use(express.json());
  app.use('/api/agent-profiles', createAgentProfileRoutes(db));
  return app;
}

describe('agent-profiles routes', () => {
  let db: Database.Database;
  let llmProfileId: string;
  let app: express.Express;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    const lp = new LlmProfileRepository(db).create({
      name: 'lp',
      providerType: 'anthropic',
      apiKey: 'sk',
    });
    llmProfileId = lp.id;
    app = buildApp(db);
  });

  it('POST creates an agent profile with full body', async () => {
    const res = await request(app)
      .post('/api/agent-profiles')
      .send({
        name: 'coder',
        llmProfileId,
        model: 'claude-sonnet-4-6',
        systemPrompt: 'You are a coder.',
        enabledTools: ['read', 'write', 'bash'],
        thinkingLevel: 'medium',
        isDefault: true,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('coder');
    expect(res.body.data.thinkingLevel).toBe('medium');
  });

  it('POST creates an agent profile with a cross-profile multimodal fallback', async () => {
    const vision = new LlmProfileRepository(db).create({
      name: 'vision',
      providerType: 'openai',
      apiKey: 'sk-vision',
      models: [{ modelId: 'gpt-4o', inputModalities: ['text', 'image'] }],
    });

    const res = await request(app)
      .post('/api/agent-profiles')
      .send({
        name: 'coder',
        llmProfileId,
        model: 'claude-haiku-4-5',
        systemPrompt: '',
        enabledTools: ['read'],
        multimodalFallback: { llmProfileId: vision.id, model: 'gpt-4o' },
      });

    expect(res.status).toBe(201);
    expect(res.body.data.multimodalFallback).toEqual({ llmProfileId: vision.id, model: 'gpt-4o' });
  });

  it('POST accepts claude runtime type', async () => {
    const res = await request(app)
      .post('/api/agent-profiles')
      .send({
        name: 'claude',
        runtimeType: 'claude',
        llmProfileId,
        model: 'claude-sonnet-4-6',
        systemPrompt: '',
        enabledTools: ['read'],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.runtimeType).toBe('claude');
  });

  it('POST rejects invalid runtime type', async () => {
    const res = await request(app)
      .post('/api/agent-profiles')
      .send({
        name: 'bad',
        runtimeType: 'bad-runtime',
        llmProfileId,
        model: 'm',
        systemPrompt: '',
        enabledTools: ['read'],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/runtimeType/);
  });

  it('POST rejects fallback models declared without image support', async () => {
    const textOnly = new LlmProfileRepository(db).create({
      name: 'text-only',
      providerType: 'openai',
      apiKey: 'sk-text',
      models: [{ modelId: 'gpt-text', inputModalities: ['text'] }],
    });

    const res = await request(app)
      .post('/api/agent-profiles')
      .send({
        name: 'coder',
        llmProfileId,
        model: 'claude-haiku-4-5',
        systemPrompt: '',
        enabledTools: ['read'],
        multimodalFallback: { llmProfileId: textOnly.id, model: 'gpt-text' },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/image/i);
  });

  it('POST rejects missing required fields', async () => {
    const res = await request(app)
      .post('/api/agent-profiles')
      .send({ name: 'a', enabledTools: [] });
    expect(res.status).toBe(400);
  });

  it('GET / lists agents', async () => {
    await request(app)
      .post('/api/agent-profiles')
      .send({
        name: 'a',
        llmProfileId,
        model: 'm',
        systemPrompt: '',
        enabledTools: ['read'],
      });
    const res = await request(app).get('/api/agent-profiles');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('PATCH updates partial fields', async () => {
    const create = await request(app)
      .post('/api/agent-profiles')
      .send({
        name: 'a',
        llmProfileId,
        model: 'm',
        systemPrompt: '',
        enabledTools: ['read'],
      });
    const res = await request(app)
      .patch(`/api/agent-profiles/${create.body.data.id}`)
      .send({ name: 'updated' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('updated');
  });

  it('PATCH updates runtime type', async () => {
    const create = await request(app)
      .post('/api/agent-profiles')
      .send({
        name: 'a',
        llmProfileId,
        model: 'm',
        systemPrompt: '',
        enabledTools: ['read'],
      });

    const res = await request(app)
      .patch(`/api/agent-profiles/${create.body.data.id}`)
      .send({ runtimeType: 'claude' });

    expect(res.status).toBe(200);
    expect(res.body.data.runtimeType).toBe('claude');
  });

  it('PATCH accepts clearing llmProfileId when switching to claude', async () => {
    const created = await request(app)
      .post('/api/agent-profiles')
      .send({ name: 'p', llmProfileId, model: 'm', runtimeType: 'zclaudia', enabledTools: [] });
    const id = created.body.data.id;

    const res = await request(app)
      .patch(`/api/agent-profiles/${id}`)
      .send({ runtimeType: 'claude', llmProfileId: '', model: 'claude-opus-4-8' });

    expect(res.status).toBe(200);
    expect(res.body.data.runtimeType).toBe('claude');
    expect(res.body.data.llmProfileId).toBe('');
  });

  it('PATCH clears a multimodal fallback with null', async () => {
    const vision = new LlmProfileRepository(db).create({
      name: 'vision',
      providerType: 'openai',
      apiKey: 'sk-vision',
      models: [{ modelId: 'gpt-4o', inputModalities: ['text', 'image'] }],
    });
    const create = await request(app)
      .post('/api/agent-profiles')
      .send({
        name: 'a',
        llmProfileId,
        model: 'm',
        systemPrompt: '',
        enabledTools: ['read'],
        multimodalFallback: { llmProfileId: vision.id, model: 'gpt-4o' },
      });

    const res = await request(app)
      .patch(`/api/agent-profiles/${create.body.data.id}`)
      .send({ multimodalFallback: null });

    expect(res.status).toBe(200);
    expect(res.body.data.multimodalFallback).toBeUndefined();
  });

  it('DELETE rejects when sessions reference the agent (409)', async () => {
    const create = await request(app)
      .post('/api/agent-profiles')
      .send({
        name: 'a',
        llmProfileId,
        model: 'm',
        systemPrompt: '',
        enabledTools: ['read'],
      });
    const agentId = create.body.data.id;
    const now = Date.now();
    db.prepare(
      'INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?,?,?,?,?)'
    ).run('p1', 'p1', '/tmp', now, now);
    db.prepare(
      'INSERT INTO sessions (id, project_id, agent_profile_id, created_at, updated_at) VALUES (?,?,?,?,?)'
    ).run('s1', 'p1', agentId, now, now);

    const res = await request(app).delete(`/api/agent-profiles/${agentId}`);
    expect(res.status).toBe(409);
    expect(res.body.error.sessionCount).toBe(1);
  });

  it('DELETE default transfers default to another agent', async () => {
    const a = await request(app)
      .post('/api/agent-profiles')
      .send({
        name: 'a',
        llmProfileId,
        model: 'm',
        systemPrompt: '',
        enabledTools: ['read'],
        isDefault: true,
      });
    await request(app)
      .post('/api/agent-profiles')
      .send({
        name: 'b',
        llmProfileId,
        model: 'm',
        systemPrompt: '',
        enabledTools: ['read'],
      });
    const del = await request(app).delete(`/api/agent-profiles/${a.body.data.id}`);
    expect(del.status).toBe(200);
    const list = await request(app).get('/api/agent-profiles');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].isDefault).toBe(true);
  });

  it('POST /:id/set-default makes another agent default', async () => {
    const a = await request(app)
      .post('/api/agent-profiles')
      .send({
        name: 'a',
        llmProfileId,
        model: 'm',
        systemPrompt: '',
        enabledTools: ['read'],
        isDefault: true,
      });
    const b = await request(app)
      .post('/api/agent-profiles')
      .send({
        name: 'b',
        llmProfileId,
        model: 'm',
        systemPrompt: '',
        enabledTools: ['read'],
      });
    await request(app).post(`/api/agent-profiles/${b.body.data.id}/set-default`);
    const fetchA = await request(app).get(`/api/agent-profiles/${a.body.data.id}`);
    expect(fetchA.body.data.isDefault).toBe(false);
  });

  it('POST allows a claude profile without llmProfileId and stores NULL', async () => {
    const res = await request(app)
      .post('/api/agent-profiles')
      .send({ name: 'claude-agent', model: 'claude-opus-4-8', runtimeType: 'claude', enabledTools: [] });
    expect(res.status).toBe(201);
    expect(res.body.data.runtimeType).toBe('claude');
    expect(res.body.data.llmProfileId).toBe(''); // API surfaces '' for "no profile"

    const row = db.prepare('SELECT llm_profile_id FROM agent_profiles WHERE id = ?').get(res.body.data.id) as { llm_profile_id: string | null };
    expect(row.llm_profile_id).toBeNull(); // persisted as NULL, not ''
  });

  it('POST still requires llmProfileId for zclaudia runtime', async () => {
    const res = await request(app)
      .post('/api/agent-profiles')
      .send({ name: 'z', model: 'gpt', runtimeType: 'zclaudia', enabledTools: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/llmProfileId is required/);
  });

  it('keeps the llm_profile_id foreign key (RESTRICT) for zclaudia profiles', async () => {
    const created = await request(app)
      .post('/api/agent-profiles')
      .send({ name: 'z', llmProfileId, model: 'm', runtimeType: 'zclaudia', enabledTools: [] });
    expect(created.status).toBe(201);
    // Deleting the referenced LLM profile must fail — the FK is still enforced.
    expect(() => db.prepare('DELETE FROM llm_profiles WHERE id = ?').run(llmProfileId)).toThrow();
  });
});
