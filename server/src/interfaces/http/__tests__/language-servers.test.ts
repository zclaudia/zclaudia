import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanguageServerManager, LanguageServerRegistry } from '../../../infra/lsp/index.js';
import type { LanguageServerPreset } from '../../../infra/lsp/index.js';
import {
  createLanguageServerRoutes,
  readCustomLanguageServers,
  readLanguageServersEnabled,
} from '../language-servers.js';

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
