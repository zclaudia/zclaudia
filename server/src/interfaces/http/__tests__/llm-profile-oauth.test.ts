import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { LlmProfileRepository } from '../../../domains/llm-profiles/repository.js';
import { CodexOAuthSessionManager } from '../../../domains/llm-profiles/codex-oauth-session.js';
import { createLlmProfileOauthRouter } from '../llm-profile-oauth.js';

vi.mock('@earendil-works/pi-ai/oauth', () => ({
  loginOpenAICodex: vi.fn(),
  loginOpenAICodexDeviceCode: vi.fn(),
}));
import { loginOpenAICodex, loginOpenAICodexDeviceCode } from '@earendil-works/pi-ai/oauth';

function makeApp() {
  const db = new Database(':memory:');
  applyMigrations(db);
  const repo = new LlmProfileRepository(db);
  // Seed a codex profile
  const now = Date.now();
  db.prepare(`INSERT INTO llm_profiles (id, name, provider_type, is_default, created_at, updated_at) VALUES (?, ?, 'openai-codex', 0, ?, ?)`).run('p1', 'codex', now, now);

  const mgr = new CodexOAuthSessionManager({
    updateOAuthCredentials: (profileId, creds) => repo.update(profileId, { oauthCredentials: creds }),
  });
  const app = express();
  app.use(express.json());
  app.use('/api/llm-profiles', createLlmProfileOauthRouter(repo, mgr));
  return { app, repo, mgr, db };
}

describe('llm-profile-oauth router', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /:id/oauth/start (browser) returns sessionId and authUrl', async () => {
    (loginOpenAICodex as any).mockImplementation(async (opts: any) => {
      opts.onAuth({ url: 'https://auth.openai.com/oauth/authorize?x=1' });
      return new Promise(() => {});  // never resolves
    });

    const { app } = makeApp();
    const resp = await request(app).post('/api/llm-profiles/p1/oauth/start').send({ method: 'browser' });
    expect(resp.status).toBe(200);
    expect(resp.body.sessionId).toBeDefined();
    expect(resp.body.authUrl).toContain('auth.openai.com');
  });

  it('POST /:id/oauth/start (device_code) returns user_code', async () => {
    (loginOpenAICodexDeviceCode as any).mockImplementation(async (opts: any) => {
      opts.onDeviceCode({ userCode: 'ABCD-1234', verificationUri: 'https://auth.openai.com/codex/device' });
      return new Promise(() => {});
    });

    const { app } = makeApp();
    const resp = await request(app).post('/api/llm-profiles/p1/oauth/start').send({ method: 'device_code' });
    expect(resp.status).toBe(200);
    expect(resp.body.userCode).toBe('ABCD-1234');
  });

  it('GET /:id/oauth/status returns pending then success', async () => {
    let resolveLogin!: (creds: any) => void;
    (loginOpenAICodex as any).mockImplementation((opts: any) => {
      opts.onAuth({ url: 'http://x' });
      return new Promise((r) => { resolveLogin = r; });
    });

    const { app, repo } = makeApp();
    const start = await request(app).post('/api/llm-profiles/p1/oauth/start').send({ method: 'browser' });
    const sessionId = start.body.sessionId;

    const pendingResp = await request(app).get(`/api/llm-profiles/p1/oauth/status/${sessionId}`);
    expect(pendingResp.body.state).toBe('pending');

    resolveLogin({ access: 'a', refresh: 'r', expires: 1, accountId: 'acct_x' });
    await new Promise((r) => setTimeout(r, 10));

    const successResp = await request(app).get(`/api/llm-profiles/p1/oauth/status/${sessionId}`);
    expect(successResp.body.state).toBe('success');
    expect(successResp.body.accountId).toBe('acct_x');

    // credentials persisted
    const saved = repo.findById('p1');
    expect(saved?.oauthCredentials?.accountId).toBe('acct_x');
  });

  it('POST /:id/oauth/cancel aborts the session', async () => {
    let aborted = false;
    (loginOpenAICodex as any).mockImplementation((opts: any) => {
      opts.onAuth({ url: 'http://x' });
      return new Promise((_, rej) => {
        opts.signal?.addEventListener('abort', () => { aborted = true; rej(new Error('aborted')); });
      });
    });

    const { app } = makeApp();
    const start = await request(app).post('/api/llm-profiles/p1/oauth/start').send({ method: 'browser' });
    await request(app).post(`/api/llm-profiles/p1/oauth/cancel/${start.body.sessionId}`);
    await new Promise((r) => setTimeout(r, 10));
    expect(aborted).toBe(true);
  });

  it('POST /:id/oauth/signout clears oauth_credentials', async () => {
    const { app, repo } = makeApp();
    repo.update('p1', { oauthCredentials: { access: 'a', refresh: 'r', expires: Date.now() + 10_000, accountId: 'acct_x' } });

    const resp = await request(app).post('/api/llm-profiles/p1/oauth/signout');
    expect(resp.status).toBe(200);
    expect(resp.body.ok).toBe(true);

    const after = repo.findById('p1');
    expect(after?.oauthCredentials).toBeUndefined();
  });

  it('GET /:id/codex-models returns models (fallback when fetch fails)', async () => {
    // Seed credentials so the endpoint can attempt a fetch
    const { app, repo } = makeApp();
    repo.update('p1', { oauthCredentials: { access: 'a', refresh: 'r', expires: Date.now() + 10_000, accountId: 'acct_x' } } as any);

    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as any;
    try {
      const resp = await request(app).get('/api/llm-profiles/p1/codex-models');
      expect(resp.status).toBe(200);
      expect(resp.body.source).toBe('fallback');
      expect(Array.isArray(resp.body.models)).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
