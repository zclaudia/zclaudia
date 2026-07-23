import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mountBrowserShell } from '../browser-shell.js';

describe('browser shell static serving', () => {
  let tmpDir: string;
  let distDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zclaudia-browser-shell-'));
    distDir = path.join(tmpDir, 'apps/desktop/dist');
    fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'), '<div id="root"></div>');
    fs.writeFileSync(path.join(distDir, 'assets/app.js'), 'console.log("ok");');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('serves static assets from the desktop dist directory', async () => {
    const app = express();
    mountBrowserShell(app, { repoRoot: tmpDir });

    const res = await request(app).get('/assets/app.js');

    expect(res.status).toBe(200);
    expect(res.text).toBe('console.log("ok");');
  });

  it('falls browser routes back to index.html', async () => {
    const app = express();
    mountBrowserShell(app, { repoRoot: tmpDir });

    const res = await request(app).get('/projects/abc/sessions/def');

    expect(res.status).toBe(200);
    expect(res.text).toBe('<div id="root"></div>');
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('does not swallow API routes mounted before the browser fallback', async () => {
    const app = express();
    app.get('/api/example', (_req, res) => res.json({ ok: true }));
    mountBrowserShell(app, { repoRoot: tmpDir });

    const res = await request(app).get('/api/example');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns 404 for missing files under /assets instead of index.html', async () => {
    const app = express();
    mountBrowserShell(app, { repoRoot: tmpDir });

    const res = await request(app).get('/assets/missing.js');

    expect(res.status).toBe(404);
    expect(res.text).not.toBe('<div id="root"></div>');
  });

  it('returns 404 for exact /assets instead of redirecting or returning index.html', async () => {
    const app = express();
    mountBrowserShell(app, { repoRoot: tmpDir });

    const res = await request(app).get('/assets');

    expect(res.status).toBe(404);
    expect(res.headers.location).toBeUndefined();
    expect(res.text).not.toBe('<div id="root"></div>');
  });

  it('continues without routes when the desktop dist directory is missing', async () => {
    fs.rmSync(distDir, { recursive: true, force: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = express();
    app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

    mountBrowserShell(app, { repoRoot: tmpDir });

    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Browser shell assets not found'));
  });

  it('does not mount browser shell when LAN mode is enabled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = express();
    app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

    mountBrowserShell(app, { repoRoot: tmpDir, env: { ZCLAUDIA_ALLOW_LAN: '1' } });

    const browserRes = await request(app).get('/projects/abc');
    const apiRes = await request(app).get('/api/health');

    expect(browserRes.status).toBe(404);
    expect(browserRes.text).not.toBe('<div id="root"></div>');
    expect(apiRes.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('disabled for non-local host 0.0.0.0')
    );
  });

  it('does not mount browser shell for explicit wildcard host', async () => {
    const app = express();

    mountBrowserShell(app, { repoRoot: tmpDir, env: { SERVER_HOST: '0.0.0.0' } });

    const res = await request(app).get('/projects/abc');

    expect(res.status).toBe(404);
    expect(res.text).not.toBe('<div id="root"></div>');
  });
});
