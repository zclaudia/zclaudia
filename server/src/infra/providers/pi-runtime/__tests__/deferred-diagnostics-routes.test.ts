import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createDeferredDiagnosticsRoutes } from '../deferred-diagnostics-routes.js';
import { scheduleDeferredDiagnostics, getDeferredDiagnosticsResult } from '../write-lifecycle.js';

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

    await vi.waitFor(() => {
      expect(getDeferredDiagnosticsResult(String(id))?.status).toBe('completed');
    });

    const app = express();
    app.use('/api/providers', createDeferredDiagnosticsRoutes());

    const res = await request(app).get(`/api/providers/deferred-diagnostics/${id}`);

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
