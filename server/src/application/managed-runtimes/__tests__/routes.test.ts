import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createManagedRuntimeRoutes } from '../routes.js';
import type { ManagedRuntimeService } from '../service.js';

function fixtureService(): ManagedRuntimeService {
  return {
    listStatuses: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({
      schemaVersion: 1,
      policy: 'managed-ask',
      trustedPublishers: [],
      enterpriseMirrorOrigins: [],
    })),
    setPolicy: vi.fn(async policy => ({
      schemaVersion: 1,
      policy,
      trustedPublishers: [],
      enterpriseMirrorOrigins: [],
    })),
    installForPlugin: vi.fn(),
    pinVersion: vi.fn(),
    rollbackReference: vi.fn(),
    testRuntime: vi.fn(),
    garbageCollect: vi.fn(async () => ({ removed: [] })),
  } as unknown as ManagedRuntimeService;
}

function appWith(service: ManagedRuntimeService, guard: RequestHandler) {
  const app = express();
  app.use(express.json());
  app.use('/api/managed-runtimes', createManagedRuntimeRoutes(guard, service));
  return app;
}

describe('managed runtime HTTP routes', () => {
  it('exposes status read-only but protects policy and installation mutations', async () => {
    const service = fixtureService();
    const guard: RequestHandler = (_req, res) => {
      res.status(403).json({ success: false, error: { code: 'LOCAL_ONLY' } });
    };
    const app = appWith(service, guard);

    expect((await request(app).get('/api/managed-runtimes')).status).toBe(200);
    expect(
      (
        await request(app).put('/api/managed-runtimes/settings/policy').send({
          policy: 'managed-auto',
        })
      ).status
    ).toBe(403);
    expect(
      (
        await request(app).post('/api/managed-runtimes/install').send({
          pluginId: 'com.example.fixture',
          pluginVersion: '1.0.0',
          runtime: 'fixture',
          approved: true,
        })
      ).status
    ).toBe(403);
    expect(service.setPolicy).not.toHaveBeenCalled();
    expect(service.installForPlugin).not.toHaveBeenCalled();
  });

  it('requires an explicit approval bit and accepts valid local installation approval', async () => {
    const service = fixtureService();
    vi.mocked(service.installForPlugin).mockResolvedValue({
      status: 'resolved',
      runtime: 'fixture',
      executablePath: '/runtime-store/fixture',
      source: 'managed',
      compatibilityState: 'compatible',
      authState: 'unknown',
      verification: { checksumVerified: true },
    });
    const app = appWith(service, (_req, _res, next) => next());
    const payload = {
      pluginId: 'com.example.fixture',
      pluginVersion: '1.0.0',
      runtime: 'fixture',
    };

    expect((await request(app).post('/api/managed-runtimes/install').send(payload)).status).toBe(
      400
    );
    const installed = await request(app)
      .post('/api/managed-runtimes/install')
      .send({ ...payload, approved: true });
    expect(installed.status).toBe(200);
    expect(service.installForPlugin).toHaveBeenCalledWith({
      ...payload,
      version: undefined,
      approved: true,
      pin: true,
    });
  });
});
