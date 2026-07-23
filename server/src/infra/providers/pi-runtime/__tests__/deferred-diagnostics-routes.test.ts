import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createDeferredDiagnosticsRoutes } from '../deferred-diagnostics-routes.js';
import { scheduleDeferredDiagnostics } from '../write-lifecycle.js';

describe('deferred diagnostics routes', () => {
  it('returns completed deferred diagnostics by id', async () => {
    const scheduled = scheduleDeferredDiagnostics(
      async () => [
        {
          path: 'f.ts',
          line: 2,
          column: 4,
          severity: 'warning',
          message: 'late warning',
          source: 'tsc',
        },
      ],
      {
        operation: 'write',
        type: 'create',
        path: 'f.ts',
        absolutePath: '/tmp/f.ts',
        originalContent: null,
        updatedContent: 'const a = 1;\n',
        diff: '',
      }
    );
    const id = scheduled?.deferredDiagnostics?.id;
    expect(id).toBeTruthy();

    const app = express();
    app.use('/api/providers', createDeferredDiagnosticsRoutes());

    // Terminal results are single-read, so poll the route itself until the
    // provider settles — the completed GET is the consuming read. The first
    // GET may already see the completed result.
    let res = await request(app).get(`/api/providers/deferred-diagnostics/${id}`);
    if (res.body.data?.status !== 'completed') {
      await vi.waitFor(async () => {
        res = await request(app).get(`/api/providers/deferred-diagnostics/${id}`);
        expect(res.status).toBe(200);
        expect(res.body.data?.status).toBe('completed');
      });
    }

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        status: 'completed',
        diagnostics: [
          {
            path: 'f.ts',
            line: 2,
            column: 4,
            severity: 'warning',
            message: 'late warning',
            source: 'tsc',
          },
        ],
      },
    });

    // The completed result was consumed by the read above.
    const consumed = await request(app).get(`/api/providers/deferred-diagnostics/${id}`);
    expect(consumed.status).toBe(404);
  });

  it('returns 404 for unknown deferred diagnostics ids', async () => {
    const app = express();
    app.use('/api/providers', createDeferredDiagnosticsRoutes());

    const res = await request(app).get('/api/providers/deferred-diagnostics/missing');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});
