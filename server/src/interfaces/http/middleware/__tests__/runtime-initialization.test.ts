import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createRuntimeInitializationMiddleware } from '../runtime-initialization.js';

describe('runtime startup boundary', () => {
  it('rejects partial-catalog reads and mutations until initialization completes', async () => {
    let ready = false;
    const app = express();
    app.use(createRuntimeInitializationMiddleware(() => ready));
    app.use((_req, res) => res.json({ success: true }));
    for (const endpoint of [
      '/api/agent-profiles',
      '/api/plugins',
      '/API/SESSIONS/session-id',
      '/api/workflows/w/trigger',
    ]) {
      const response = await request(app).post(endpoint);
      expect(response.status).toBe(503);
      expect(response.headers['retry-after']).toBe('1');
      expect(response.body.error.code).toBe('RUNTIMES_INITIALIZING');
    }
    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).get('/api/server/info')).status).toBe(200);
    ready = true;
    expect((await request(app).post('/api/sessions')).status).toBe(200);
  });
});
