import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
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
      const res = await request(app)
        .post('/api/llm-profiles')
        .send({
          name: 'with-headers',
          providerType: 'openai',
          requestHeaders: { 'X-Org-Id': 'abc' },
        });
      expect(res.status).toBe(201);
      expect(res.body.data.requestHeaders).toEqual({ 'X-Org-Id': 'abc' });
    });

    it('POST rejects Authorization in requestHeaders', async () => {
      const res = await request(app)
        .post('/api/llm-profiles')
        .send({
          name: 'bad',
          providerType: 'openai',
          requestHeaders: { Authorization: 'Bearer leaked' },
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toMatch(/Authorization/);
    });

    it('POST rejects Content-Type (case-insensitive)', async () => {
      const res = await request(app)
        .post('/api/llm-profiles')
        .send({
          name: 'bad',
          providerType: 'openai',
          requestHeaders: { 'CONTENT-TYPE': 'application/x-evil' },
        });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Content-Type|CONTENT-TYPE/i);
    });

    it('POST rejects Host', async () => {
      const res = await request(app)
        .post('/api/llm-profiles')
        .send({
          name: 'bad',
          providerType: 'openai',
          requestHeaders: { host: 'evil.example.com' },
        });
      expect(res.status).toBe(400);
    });

    it('POST rejects non-string header value', async () => {
      const res = await request(app)
        .post('/api/llm-profiles')
        .send({
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
      const res = await request(app)
        .post('/api/llm-profiles')
        .send({
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
      const res = await request(app)
        .put(`/api/llm-profiles/${id}`)
        .send({
          requestHeaders: { Authorization: 'Bearer x' },
        });
      expect(res.status).toBe(400);
    });

    it('PUT clears requestHeaders when null is sent', async () => {
      const createRes = await request(app)
        .post('/api/llm-profiles')
        .send({
          name: 'with-headers',
          providerType: 'openai',
          requestHeaders: { 'X-Org-Id': 'abc' },
        });
      const id = createRes.body.data.id;

      const res = await request(app).put(`/api/llm-profiles/${id}`).send({
        requestHeaders: null,
      });

      expect(res.status).toBe(200);
      expect(res.body.data.requestHeaders).toBeUndefined();
      expect(new LlmProfileRepository(db).findById(id)?.requestHeaders).toBeUndefined();
    });
  });

  describe('models validation', () => {
    it('accepts a single well-formed entry', async () => {
      const res = await request(app)
        .post('/api/llm-profiles')
        .send({
          name: 'ok',
          providerType: 'anthropic',
          models: [{ modelId: 'claude-opus-4-7', contextWindow: 1_000_000 }],
        });
      expect(res.status).toBe(201);
      expect(res.body.data.models).toEqual([
        { modelId: 'claude-opus-4-7', contextWindow: 1_000_000 },
      ]);
    });

    it('normalizes image inputModalities by including text', async () => {
      const res = await request(app)
        .post('/api/llm-profiles')
        .send({
          name: 'vision',
          providerType: 'openai',
          models: [{ modelId: 'gpt-4o', inputModalities: ['image'] }],
        });
      expect(res.status).toBe(201);
      expect(res.body.data.models).toEqual([
        { modelId: 'gpt-4o', inputModalities: ['text', 'image'] },
      ]);
    });

    it('rejects invalid inputModalities values', async () => {
      const res = await request(app)
        .post('/api/llm-profiles')
        .send({
          name: 'bad-modalities',
          providerType: 'openai',
          models: [{ modelId: 'gpt-4o', inputModalities: ['audio'] }],
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toMatch(/inputModalities/i);
    });

    it('rejects duplicate modelId', async () => {
      const res = await request(app)
        .post('/api/llm-profiles')
        .send({
          name: 'dup',
          providerType: 'anthropic',
          models: [{ modelId: 'foo' }, { modelId: 'foo' }],
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects empty modelId', async () => {
      const res = await request(app)
        .post('/api/llm-profiles')
        .send({
          name: 'mid',
          providerType: 'anthropic',
          models: [{}],
        });
      expect(res.status).toBe(400);
    });

    it('rejects zero / negative contextWindow', async () => {
      const res = await request(app)
        .post('/api/llm-profiles')
        .send({
          name: 'cw0',
          providerType: 'anthropic',
          models: [{ modelId: 'm', contextWindow: 0 }],
        });
      expect(res.status).toBe(400);
    });

    it('rejects non-integer contextWindow', async () => {
      const res = await request(app)
        .post('/api/llm-profiles')
        .send({
          name: 'frac',
          providerType: 'anthropic',
          models: [{ modelId: 'm', contextWindow: 1.5 }],
        });
      expect(res.status).toBe(400);
    });

    it('rejects non-string displayName', async () => {
      const res = await request(app)
        .post('/api/llm-profiles')
        .send({
          name: 'dn',
          providerType: 'anthropic',
          models: [{ modelId: 'm', displayName: 123 }],
        });
      expect(res.status).toBe(400);
    });

    it('persists a valid dialect', async () => {
      const res = await request(app)
        .post('/api/llm-profiles')
        .send({
          name: 'dialect-ok',
          providerType: 'openai',
          models: [{ modelId: 'kimi-k2', dialect: 'moonshotai' }],
        });
      expect(res.status).toBe(201);
      expect(res.body.data.models).toEqual([{ modelId: 'kimi-k2', dialect: 'moonshotai' }]);
    });

    it('rejects unknown dialect values', async () => {
      const res = await request(app)
        .post('/api/llm-profiles')
        .send({
          name: 'dialect-bad',
          providerType: 'openai',
          models: [{ modelId: 'x', dialect: 'kimi' }],
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toMatch(/models\[0\]\.dialect/);
    });

    it('rejects models not being an array', async () => {
      const res = await request(app).post('/api/llm-profiles').send({
        name: 'bad',
        providerType: 'anthropic',
        models: 'oops',
      });
      expect(res.status).toBe(400);
    });

    it('treats models = null as no override (saves as undefined)', async () => {
      const res = await request(app).post('/api/llm-profiles').send({
        name: 'nil',
        providerType: 'anthropic',
        models: null,
      });
      expect(res.status).toBe(201);
      expect(res.body.data.models).toBeUndefined();
    });

    it('PUT applies same validator', async () => {
      const created = await request(app).post('/api/llm-profiles').send({
        name: 'patch-target',
        providerType: 'anthropic',
      });
      const id = created.body.data.id;
      const res = await request(app)
        .put(`/api/llm-profiles/${id}`)
        .send({
          models: [{ modelId: 'a' }, { modelId: 'a' }],
        });
      expect(res.status).toBe(400);
    });

    it('PUT persists valid inputModalities', async () => {
      const created = await request(app).post('/api/llm-profiles').send({
        name: 'patch-modalities',
        providerType: 'openai',
      });
      const id = created.body.data.id;
      const res = await request(app)
        .put(`/api/llm-profiles/${id}`)
        .send({
          models: [{ modelId: 'gpt-4o', inputModalities: ['text', 'image', 'image'] }],
        });
      expect(res.status).toBe(200);
      expect(res.body.data.models).toEqual([
        { modelId: 'gpt-4o', inputModalities: ['text', 'image'] },
      ]);
    });
  });

  describe('POST /models/fetch-preview', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns the model list from the upstream endpoint without persisting anything', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: 'gpt-5' }, { id: 'gpt-4o' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
      const before = new LlmProfileRepository(db).findAllOrdered().length;
      const res = await request(app).post('/api/llm-profiles/models/fetch-preview').send({
        providerType: 'openai',
        apiKey: 'sk-x',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.models).toEqual(['gpt-4o', 'gpt-5']);
      // No profile created as a side effect.
      expect(new LlmProfileRepository(db).findAllOrdered().length).toBe(before);
    });

    it('rejects body missing providerType with 400', async () => {
      const res = await request(app).post('/api/llm-profiles/models/fetch-preview').send({
        apiKey: 'sk-x',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('preview is reachable on a non-existent profile id (literal route precedence)', async () => {
      // Belt-and-braces: confirm the `/models/fetch-preview` literal segment
      // is NOT swallowed by the `:id` matcher.
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: 'm' }] }), { status: 200 })
      );
      const res = await request(app).post('/api/llm-profiles/models/fetch-preview').send({
        providerType: 'anthropic',
        apiKey: 'k',
      });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /models/probe-preview', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns ok=false on upstream error without persisting anything', async () => {
      // probeModel uses pi-ai's completeSimple, which goes through fetch.
      // Stub fetch to a 401; probeModel translates it to {ok:false}.
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('unauthorized', { status: 401 })
      );
      const before = new LlmProfileRepository(db).findAllOrdered().length;
      const res = await request(app).post('/api/llm-profiles/models/probe-preview').send({
        providerType: 'anthropic',
        apiKey: 'bad',
        modelId: 'claude-opus-4-7',
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.ok).toBe(false);
      expect(typeof res.body.data.error).toBe('string');
      expect(new LlmProfileRepository(db).findAllOrdered().length).toBe(before);
    });

    it('rejects body missing modelId with 400', async () => {
      const res = await request(app).post('/api/llm-profiles/models/probe-preview').send({
        providerType: 'anthropic',
        apiKey: 'k',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('cacheRetention validation', () => {
    it('accepts a valid cacheRetention on create', async () => {
      const res = await request(app).post('/api/llm-profiles').send({
        name: 'c1',
        providerType: 'anthropic',
        cacheRetention: 'long',
      });
      expect(res.status).toBe(201);
      expect(res.body.data.cacheRetention).toBe('long');
    });

    it('rejects an invalid cacheRetention on create', async () => {
      const res = await request(app).post('/api/llm-profiles').send({
        name: 'c2',
        providerType: 'anthropic',
        cacheRetention: 'weekly',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('updates and clears cacheRetention via PUT', async () => {
      const createRes = await request(app).post('/api/llm-profiles').send({
        name: 'c3',
        providerType: 'anthropic',
        cacheRetention: 'short',
      });
      expect(createRes.status).toBe(201);
      const id = createRes.body.data.id;

      const updateRes = await request(app).put(`/api/llm-profiles/${id}`).send({
        cacheRetention: 'none',
      });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.cacheRetention).toBe('none');

      const clearRes = await request(app).put(`/api/llm-profiles/${id}`).send({
        cacheRetention: null,
      });
      expect(clearRes.status).toBe(200);
      expect(clearRes.body.data.cacheRetention).toBeUndefined();
    });

    it('rejects an invalid cacheRetention on update', async () => {
      const createRes = await request(app).post('/api/llm-profiles').send({
        name: 'c4',
        providerType: 'anthropic',
      });
      expect(createRes.status).toBe(201);
      const id = createRes.body.data.id;

      const res = await request(app).put(`/api/llm-profiles/${id}`).send({
        cacheRetention: 'forever',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /models/resolve-preview', () => {
    it('returns {value, source, matchedProvider} from the resolution chain without persisting anything', async () => {
      // claude-opus-4-7 is in pi-ai's registry under the `anthropic`
      // provider key — and we pass no override on the entry so we hit the
      // pi_ai_registry branch, not profile_entry. This also exercises the
      // "self-edit gotcha avoided" behavior: the entry for
      // `claude-opus-4-7` carries no contextWindow, mirroring what the
      // desktop ModelRow strips before calling.
      const before = new LlmProfileRepository(db).findAllOrdered().length;
      const res = await request(app)
        .post('/api/llm-profiles/models/resolve-preview')
        .send({
          providerType: 'anthropic',
          apiKey: 'k',
          models: [{ modelId: 'claude-opus-4-7' }],
          modelId: 'claude-opus-4-7',
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.source).toBe('pi_ai_registry');
      expect(res.body.data.matchedProvider).toBe('anthropic');
      expect(res.body.data.value).toBeGreaterThan(100_000);
      // No side-effect on the profile table.
      expect(new LlmProfileRepository(db).findAllOrdered().length).toBe(before);
    });

    it('cross-provider sweep surfaces matchedProvider for a model under a different pi-ai provider key', async () => {
      // claude-opus-4-7 is registered under `anthropic` in pi-ai's
      // registry. If the user picks providerType=openai (e.g. routing
      // through an openai-compat proxy) the same-provider lookup misses
      // but the cross-provider sweep finds the entry under `anthropic` and
      // surfaces it via matchedProvider.
      const res = await request(app).post('/api/llm-profiles/models/resolve-preview').send({
        providerType: 'openai',
        apiKey: 'k',
        baseUrl: 'https://proxy.example.com/v1',
        modelId: 'claude-opus-4-7',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.source).toBe('pi_ai_registry');
      expect(res.body.data.matchedProvider).toBe('anthropic');
    });

    it('returns openai_compat_default for an unknown id under an openai-compat proxy', async () => {
      const res = await request(app).post('/api/llm-profiles/models/resolve-preview').send({
        providerType: 'openai',
        apiKey: 'k',
        baseUrl: 'https://proxy.example.com/v1',
        modelId: 'totally-unregistered-xyz',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.source).toBe('openai_compat_default');
      expect(res.body.data.value).toBe(128_000);
      expect(res.body.data.matchedProvider).toBeUndefined();
    });

    it('rejects body missing modelId with 400', async () => {
      const res = await request(app).post('/api/llm-profiles/models/resolve-preview').send({
        providerType: 'anthropic',
        apiKey: 'k',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects body missing providerType with 400', async () => {
      const res = await request(app).post('/api/llm-profiles/models/resolve-preview').send({
        modelId: 'claude-opus-4-7',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
