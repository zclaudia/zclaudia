import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createContextUsageRoutes } from '../context-usage-routes.js';
import {
  captureContextSnapshot,
  clearContextSnapshots,
  recordContextUsage,
} from '../context-snapshot.js';

function makeApp(deps?: Parameters<typeof createContextUsageRoutes>[0]) {
  const app = express();
  app.use('/api/providers', createContextUsageRoutes(deps));
  return app;
}

describe('context usage routes', () => {
  beforeEach(() => {
    clearContextSnapshots();
  });

  it('returns available:false (supported by default) when the session has no snapshot', async () => {
    const res = await request(makeApp()).get('/api/providers/sessions/unknown/context-usage');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { available: false, supported: true } });
  });

  it('reports supported:false when the resolver says the runtime never captures snapshots', async () => {
    const app = makeApp({ supportsContextBreakdown: () => false });
    const res = await request(app).get('/api/providers/sessions/ext1/context-usage');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { available: false, supported: false } });
  });

  it('keeps supported:true for a pi session that simply has no run yet', async () => {
    const app = makeApp({ supportsContextBreakdown: () => true });
    const res = await request(app).get('/api/providers/sessions/pi1/context-usage');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { available: false, supported: true } });
  });

  it('returns the computed payload for a snapshot with real usage', async () => {
    captureContextSnapshot({
      sessionId: 's1',
      model: 'claude-sonnet-4-6',
      contextWindow: 200_000,
      contextWindowSource: 'profile_entry',
      systemPromptText: 'a'.repeat(400), // 100 tokens
      skillCatalogText: '', // 0 tokens
      tools: [{ name: 'Read', description: 'c'.repeat(36) }], // 10 tokens
    });
    recordContextUsage('s1', { input: 500, output: 80, cacheRead: 4500, cacheWrite: 0 });

    const res = await request(makeApp()).get('/api/providers/sessions/s1/context-usage');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      available: true,
      model: 'claude-sonnet-4-6',
      contextWindow: 200_000,
      contextWindowSource: 'profile_entry',
      usedTokens: 5000,
      usedTokensFromUsage: true,
      breakdown: {
        systemPrompt: { tokens: 100, estimated: true },
        tools: { tokens: 10, estimated: true, count: 1 },
        skills: { tokens: 0, estimated: true },
        messages: { tokens: 4890, estimated: true, clamped: false },
      },
    });
  });

  it('falls back to estimates when no run has completed yet', async () => {
    captureContextSnapshot({
      sessionId: 's2',
      model: 'claude-sonnet-4-6',
      contextWindow: 200_000,
      contextWindowSource: 'fallback',
      systemPromptText: 'a'.repeat(400),
      skillCatalogText: '',
      tools: [],
    });

    const res = await request(makeApp()).get('/api/providers/sessions/s2/context-usage');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      available: true,
      usedTokens: 100,
      usedTokensFromUsage: false,
    });
  });
});
