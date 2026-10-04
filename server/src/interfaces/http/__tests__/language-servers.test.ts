import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageServerManager, LanguageServerRegistry } from '../../../infra/lsp/index.js';
import type { LanguageServerPreset } from '../../../infra/lsp/index.js';
import {
  createLanguageServerRoutes,
  readCustomLanguageServers,
  readLanguageServersEnabled,
  VIEWER_LEASE_TTL_MS,
} from '../language-servers.js';
import { createFakeServer } from '../../../infra/lsp/__tests__/fake-lsp-server.js';

const preset: LanguageServerPreset = {
  id: 'fake',
  name: 'Fake',
  languages: ['fake'],
  extensions: { '.fk': 'fake' },
  rootMarkers: ['fake.json'],
  resolveLaunch: root =>
    // Detected only where the marker exists, like a real preset.
    existsSync(path.join(root, 'fake.json')) ? { command: 'fake', args: [], cwd: root } : null,
};

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT);
    CREATE TABLE agent_profiles (id TEXT PRIMARY KEY, runtime_type TEXT, is_default INTEGER);
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, project_id TEXT, agent_profile_id TEXT, working_directory TEXT
    );
  `);
  return db;
}

describe('language-server routes', () => {
  let db: Database.Database;
  let root: string;
  let manager: LanguageServerManager;
  let app: express.Express;

  beforeEach(() => {
    db = createDb();
    root = mkdtempSync(path.join(tmpdir(), 'lsp-routes-'));
    writeFileSync(path.join(root, 'fake.json'), '{}');
    manager = new LanguageServerManager({ presets: [preset] });
    app = express();
    app.use(express.json());
    app.use(
      '/api/language-servers',
      createLanguageServerRoutes(db, () => manager)
    );
    db.prepare(`INSERT INTO projects VALUES ('p1', ?)`).run(root);
    db.prepare(`INSERT INTO agent_profiles VALUES ('pi', 'pi', 1), ('claude', 'claude', 0)`).run();
  });
  afterEach(async () => {
    await manager.dispose();
    rmSync(root, { recursive: true, force: true });
  });

  it('reports a Pi session’s detected servers, idle until first use', async () => {
    db.prepare(`INSERT INTO sessions VALUES ('s1', 'p1', 'pi', NULL)`).run();
    const res = await request(app).get('/api/language-servers/sessions/s1');
    expect(res.body.data).toMatchObject({
      applicable: true,
      enabled: true,
      root,
      servers: [
        {
          id: 'fake',
          name: 'Fake',
          state: 'idle',
          leases: 0,
          lastError: null,
          installHint: null,
          source: 'builtin',
          pluginId: null,
        },
      ],
    });
  });

  it('uses the session worktree over the project root, and the default profile when unset', async () => {
    const worktree = mkdtempSync(path.join(tmpdir(), 'lsp-routes-wt-'));
    try {
      db.prepare(`INSERT INTO sessions VALUES ('s2', 'p1', NULL, ?)`).run(worktree);
      const res = await request(app).get('/api/language-servers/sessions/s2');
      // Pi via the default profile; the worktree has no marker, so no servers.
      expect(res.body.data).toMatchObject({ applicable: true, root: worktree, servers: [] });
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it('is not applicable to external runtimes', async () => {
    db.prepare(`INSERT INTO sessions VALUES ('s3', 'p1', 'claude', NULL)`).run();
    const res = await request(app).get('/api/language-servers/sessions/s3');
    expect(res.body.data).toMatchObject({ applicable: false, servers: [] });
  });

  it('404s an unknown session', async () => {
    expect((await request(app).get('/api/language-servers/sessions/nope')).status).toBe(404);
  });

  it('persists the master switch and turns the manager off', async () => {
    db.prepare(`INSERT INTO sessions VALUES ('s1', 'p1', 'pi', NULL)`).run();
    const off = await request(app).put('/api/language-servers').send({ enabled: false });
    expect(off.body.data.enabled).toBe(false);
    expect(readLanguageServersEnabled(db)).toBe(false);
    expect(manager.serversFor(root)).toEqual([]);
    const session = await request(app).get('/api/language-servers/sessions/s1');
    expect(session.body.data).toMatchObject({ enabled: false, servers: [] });

    await request(app).put('/api/language-servers').send({ enabled: true });
    expect(readLanguageServersEnabled(db)).toBe(true);
    expect(manager.serversFor(root).map(s => s.id)).toEqual(['fake']);
  });

  it('rejects a non-boolean switch value', async () => {
    const res = await request(app).put('/api/language-servers').send({ enabled: 'yes' });
    expect(res.status).toBe(400);
  });

  it('lists servers a known project needs but lacks, and re-probes on refresh', async () => {
    let installed = false;
    let refreshed = 0;
    const missable: LanguageServerPreset = {
      ...preset,
      id: 'gopls',
      name: 'Go',
      extensions: { '.go': 'go' },
      rootMarkers: ['go.mod'],
      installHint: 'go install golang.org/x/tools/gopls@latest',
      resolveLaunch: root => (installed ? { command: 'gopls', args: [], cwd: root } : null),
      refreshDetection: () => {
        refreshed += 1;
      },
    };
    await manager.dispose();
    manager = new LanguageServerManager({ presets: [preset, missable] });
    writeFileSync(path.join(root, 'go.mod'), 'module x');

    const res = await request(app).get('/api/language-servers');
    expect(res.body.data.servers).toEqual([
      expect.objectContaining({
        id: 'gopls',
        root,
        state: 'missing',
        installHint: 'go install golang.org/x/tools/gopls@latest',
      }),
    ]);

    installed = true;
    await request(app).get('/api/language-servers?refresh=1');
    expect(refreshed).toBe(1);
    db.prepare(`INSERT INTO sessions VALUES ('s1', 'p1', 'pi', NULL)`).run();
    const session = await request(app).get('/api/language-servers/sessions/s1');
    expect(
      session.body.data.servers.map((s: { id: string; state: string }) => [s.id, s.state])
    ).toEqual([
      ['fake', 'idle'],
      ['gopls', 'idle'],
    ]);
  });

  it('saves custom servers, which the manager then uses, and rejects invalid ones', async () => {
    const registry = new LanguageServerRegistry([preset]);
    await manager.dispose();
    manager = new LanguageServerManager({ registry });
    const custom = express();
    custom.use(express.json());
    custom.use(
      '/api/language-servers',
      createLanguageServerRoutes(db, () => manager, registry)
    );

    const bad = await request(custom)
      .put('/api/language-servers/custom')
      .send({ servers: [{ id: 'x', command: '' }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toContain('servers[0]');

    const clangd = {
      id: 'clangd',
      name: 'C (clangd)',
      command: process.execPath, // any existing absolute path
      extensions: { '.c': 'c' },
      rootMarkers: ['fake.json'],
    };
    const saved = await request(custom)
      .put('/api/language-servers/custom')
      .send({ servers: [clangd] });
    expect(saved.body.data.servers).toEqual([clangd]);
    expect(readCustomLanguageServers(db)).toEqual([clangd]);
    expect((await request(custom).get('/api/language-servers/custom')).body.data.servers).toEqual([
      clangd,
    ]);
    expect(manager.statusFor(root).map(s => [s.id, s.source])).toEqual([
      ['clangd', 'user'],
      ['fake', 'builtin'],
    ]);
  });

  it('defaults to on when nothing is stored', () => {
    expect(readLanguageServersEnabled(db)).toBe(true);
  });
});

describe('file-viewer routes', () => {
  let db: Database.Database;
  let root: string;
  let manager: LanguageServerManager;
  let app: express.Express;

  beforeEach(() => {
    db = createDb();
    root = mkdtempSync(path.join(tmpdir(), 'lsp-viewer-'));
    writeFileSync(path.join(root, 'fake.json'), '{}');
    writeFileSync(path.join(root, 'a.fk'), 'ok\nERR: broken\n');
    db.prepare(`INSERT INTO projects VALUES ('p1', ?)`).run(root);
    manager = new LanguageServerManager({
      presets: [preset],
      settleMs: 10,
      spawn: async () => createFakeServer().transport,
    });
    app = express();
    app.use(express.json());
    app.use(
      '/api/language-servers',
      createLanguageServerRoutes(db, () => manager)
    );
  });
  afterEach(async () => {
    vi.useRealTimers();
    await manager.dispose();
    rmSync(root, { recursive: true, force: true });
  });

  const diagnostics = (r: string, file: string) =>
    request(app).get('/api/language-servers/file-diagnostics').query({ root: r, path: file });

  it('refuses workspaces that are not a project or session root', async () => {
    const other = mkdtempSync(path.join(tmpdir(), 'lsp-viewer-other-'));
    try {
      expect((await diagnostics(other, 'a.fk')).status).toBe(403);
      const lease = await request(app)
        .post('/api/language-servers/viewer-leases')
        .send({ root: other });
      expect(lease.status).toBe(403);
      expect(manager.status()).toEqual([]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('never starts a server itself; a viewer lease does, and then diagnostics flow', async () => {
    expect((await diagnostics(root, 'notes.txt')).body.data).toMatchObject({
      state: 'unavailable',
    });
    expect((await diagnostics(root, 'a.fk')).body.data).toEqual({
      state: 'not_running',
      server: { id: 'fake', name: 'Fake' },
      diagnostics: [],
    });
    expect(manager.status()).toEqual([]);

    const lease = await request(app).post('/api/language-servers/viewer-leases').send({ root });
    expect(lease.body.data).toMatchObject({ ttlMs: VIEWER_LEASE_TTL_MS });
    expect(manager.status()[0].leases).toEqual(['file viewer']);
    const deadline = Date.now() + 2000;
    let data;
    do {
      data = (await diagnostics(root, 'a.fk')).body.data;
    } while (data.state !== 'ready' && Date.now() < deadline);
    expect(data).toMatchObject({
      state: 'ready',
      diagnostics: [{ line: 2, severity: 'error', message: 'broken' }],
    });

    const leaseId = lease.body.data.leaseId;
    expect(
      (await request(app).post(`/api/language-servers/viewer-leases/${leaseId}/renew`)).status
    ).toBe(200);
    expect(
      (await request(app).delete(`/api/language-servers/viewer-leases/${leaseId}`)).body.data
    ).toEqual({ released: true });
    expect(manager.status()[0].leases).toEqual([]);
    expect(
      (await request(app).post(`/api/language-servers/viewer-leases/${leaseId}/renew`)).status
    ).toBe(404);
  });

  it('lets a lease lapse when the client stops renewing it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await request(app).post('/api/language-servers/viewer-leases').send({ root });
    expect(manager.status()[0].leases).toEqual(['file viewer']);
    await vi.advanceTimersByTimeAsync(VIEWER_LEASE_TTL_MS + 1);
    expect(manager.status()[0].leases).toEqual([]);
  });
});
