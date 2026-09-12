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

  it('returns only the built-in Pi runtime by default (claude ships as a plugin)', async () => {
    const res = await request(app).get('/api/agent-runtimes');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    const byRuntime = Object.fromEntries(
      (res.body.data as Array<{ runtime: string }>).map(d => [d.runtime, d])
    );

    expect(Object.keys(byRuntime)).toEqual(['pi']);
    expect(byRuntime.pi).toBeDefined();
    expect(byRuntime.pi.label).toBe('Pi');
    expect(byRuntime.pi.model).toBeDefined();
    expect(byRuntime.pi.hasCliPath).toBe(false);
    expect(byRuntime.pi.capabilities).toBeDefined();

    expect(byRuntime.claude).toBeUndefined();
  });
});
