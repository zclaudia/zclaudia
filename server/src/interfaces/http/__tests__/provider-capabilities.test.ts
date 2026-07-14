import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { registerRuntimeRoutes } from '../../../infra/providers/runtime-routes.js';

function makeApp() {
  const app = express();
  const db = {
    prepare: vi.fn(() => ({
      get: vi.fn(() => ({ id: 'llm-1' })),
    })),
  };
  registerRuntimeRoutes({
    app,
    authMiddleware: (_req, _res, next) => next(),
    db: db as never,
  });
  return app;
}

describe('provider capability routes', () => {
  it('exposes AI review support for runtime type and LLM profile routes', async () => {
    const app = makeApp();

    const byType = await request(app).get('/api/providers/type/zclaudia/capabilities');
    const byProfile = await request(app).get('/api/providers/llm-1/capabilities');

    expect(byType.status).toBe(200);
    expect(byType.body.data.supportsAIReview).toBe(true);
    expect(byProfile.status).toBe(200);
    expect(byProfile.body.data.supportsAIReview).toBe(true);
  });

  it('returns cursor runtime capabilities with default/plan/ask modes', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/providers/type/cursor/capabilities');
    expect(res.status).toBe(200);
    expect(res.body.data.supportsAIReview).toBe(false);
    expect(res.body.data.defaultModeId).toBe('default');
    expect(res.body.data.modes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'default' }),
        expect.objectContaining({ id: 'plan' }),
        expect.objectContaining({ id: 'ask' }),
      ])
    );
  });

  it('returns claude runtime capabilities by type', async () => {
    const app = makeApp();

    const res = await request(app).get('/api/providers/type/claude/capabilities');

    expect(res.status).toBe(200);
    expect(res.body.data.modeLabel).toBe('Mode');
    expect(res.body.data.defaultModeId).toBe('default');
    expect(res.body.data.supportsAIReview).toBe(false);
    expect(res.body.data.supportsImages).toBeFalsy();
    expect(res.body.data.modes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'default' }),
        expect.objectContaining({ id: 'plan' }),
      ])
    );
  });

  it('returns codex runtime capabilities with default/plan/acceptEdits/bypassPermissions modes', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/providers/type/codex/capabilities');
    expect(res.status).toBe(200);
    expect(res.body.data.supportsAIReview).toBe(false);
    expect(res.body.data.defaultModeId).toBe('default');
    expect(res.body.data.modes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'default' }),
        expect.objectContaining({ id: 'plan' }),
        expect.objectContaining({ id: 'acceptEdits' }),
        expect.objectContaining({ id: 'bypassPermissions' }),
      ])
    );
  });

  it('returns commands for the claude and codex runtime types', async () => {
    const app = makeApp();

    const res = await request(app).get('/api/providers/type/claude/commands');
    const codex = await request(app).get('/api/providers/type/codex/commands');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(codex.status).toBe(200);
    expect(Array.isArray(codex.body.data)).toBe(true);
  });
});
