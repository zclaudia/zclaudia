import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'express';
import { mountSessionInvocableRoutes } from '../session-invocables.js';
import { sessionInvocableCatalogService } from '../../../application/invocations/session-catalog.js';

describe('session invocable catalog routes', () => {
  beforeEach(() => sessionInvocableCatalogService.invalidateAll());

  it('mounts exactly once under /api/sessions and refreshes adapter discovery', async () => {
    const discover = vi.fn(async () => ({
      items: [],
      diagnostics: [],
      phase: 'live' as const,
      completeness: 'complete' as const,
    }));
    const app = express();
    const router = Router();
    mountSessionInvocableRoutes(router, {} as never, {
      buildRequest: async (_db, sessionId) =>
        sessionId === 'missing'
          ? null
          : {
              backendIdentity: 'local',
              sessionId,
              runtimeType: 'fixture',
              engineMode: 'cli',
              canonicalCwd: '/repo',
              configurationRootFingerprint: 'cfg',
              settingsSourcePolicy: ['user'],
              adapterVersion: '1',
              hostDescriptors: [],
              portableEntries: [],
              runtimeSource: { discover },
            },
    });
    app.use('/api/sessions', router);

    const first = await request(app).get('/api/sessions/session-1/invocables');
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ protocolVersion: 1, phase: 'live' });
    expect(discover).toHaveBeenCalledTimes(1);

    expect((await request(app).get('/api/sessions/sessions/session-1/invocables')).status).toBe(
      404
    );
    expect((await request(app).get('/api/sessions/missing/invocables')).status).toBe(404);

    const refreshed = await request(app).post('/api/sessions/session-1/invocables/refresh');
    expect(refreshed.status).toBe(200);
    expect(discover).toHaveBeenCalledTimes(2);
  });
});
