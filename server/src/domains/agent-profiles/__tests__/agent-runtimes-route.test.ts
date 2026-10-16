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

  it('reports how each runtime honors additional directories (Pi is host-enforced)', async () => {
    const res = await request(app).get('/api/agent-runtimes');
    expect(res.body.data[0].additionalDirectories).toBe('host');
  });

  it('defaults a contributed runtime without the field to none', async () => {
    const base = {
      label: 'X',
      model: { kind: 'native', multimodalFallback: false, thinkingLevel: 'auto' },
      hasCliPath: false,
      capabilities: { tools: 'native', providers: 'external', skills: 'external' },
      manifest: { id: 'x', name: 'X', version: '1', apiVersion: 'pcp/v1', capabilities: [] },
    };
    const contributions = [
      { ...base, type: 'plain' },
      { ...base, type: 'nativeish', additionalDirectories: 'native' },
    ];
    const withContrib = express();
    withContrib.use(
      '/api/agent-runtimes',
      createRuntimeDescriptorRoutes({ builtinRuntimeContributions: () => contributions as never })
    );
    const res = await request(withContrib).get('/api/agent-runtimes');
    const byRuntime = Object.fromEntries(
      (res.body.data as Array<{ runtime: string; additionalDirectories: string }>).map(d => [
        d.runtime,
        d.additionalDirectories,
      ])
    );
    expect(byRuntime).toMatchObject({ pi: 'host', plain: 'none', nativeish: 'native' });
  });
});
