import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRuntimeDescriptorRoutes } from '../runtime-descriptors-routes.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agent-runtimes', createRuntimeDescriptorRoutes());
  return app;
}

describe('GET /api/agent-runtimes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  it('returns only the built-in zclaudia runtime by default (claude ships as a plugin)', async () => {
    const res = await request(app).get('/api/agent-runtimes');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    const byRuntime = Object.fromEntries(
      (res.body.data as Array<{ runtime: string }>).map(d => [d.runtime, d])
    );

    expect(byRuntime.zclaudia).toBeDefined();
    expect(byRuntime.zclaudia.label).toBe('ZClaudia');
    expect(byRuntime.zclaudia.model).toBeDefined();
    expect(byRuntime.zclaudia.hasCliPath).toBe(false);
    expect(byRuntime.zclaudia.capabilities).toBeDefined();

    expect(byRuntime.claude).toBeUndefined();
  });
});
