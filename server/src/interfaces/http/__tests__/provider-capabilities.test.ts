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
});
