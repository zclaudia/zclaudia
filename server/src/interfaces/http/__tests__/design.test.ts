import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDesignRoutes, type DesignMediaRoutesDeps } from '../design.js';
import { migration as migration050 } from '../../../infra/storage/migrations/050_design_snapshots.js';
import { migration as migration051 } from '../../../infra/storage/migrations/051_design_media_tasks.js';
import { migration as migration052 } from '../../../infra/storage/migrations/052_design_shares.js';
import { DesignError } from '../../../application/design/design-service.js';
import {
  MediaTaskService,
  type DesignMediaTaskSummary,
} from '../../../application/design/media-task-service.js';
import type { MediaImageProvider } from '../../../application/design/media-types.js';

/** supertest 二进制响应收集（export 与媒体 result 流式端点共用形态）。 */
function parseBinary(res: unknown, callback: (error: Error | null, body?: Buffer) => void): void {
  const stream = res as { on: (event: string, listener: (chunk?: Buffer) => void) => void };
  const chunks: Buffer[] = [];
  stream.on('data', chunk => chunks.push(chunk as Buffer));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('design routes', () => {
  let db: Database.Database;
  let app: express.Express;
  let temp: string;
  let rootA: string;
  let rootB: string;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'design-api-'));
    rootA = path.join(temp, 'a');
    rootB = path.join(temp, 'b');
    await mkdir(rootA);
    await mkdir(rootB);
    db = new Database(':memory:');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, working_directory TEXT);
      INSERT INTO projects VALUES ('pa', '${rootA}'), ('pb', '${rootB}');
      INSERT INTO sessions VALUES ('sa', 'pa', NULL), ('sb', 'pb', NULL), ('sw', 'pa', '${rootB}');`);
    app = express();
    app.use(express.json({ limit: '3mb' }));
    app.use('/api/design', createDesignRoutes(db));
  });
  afterEach(async () => {
    db.close();
    await rm(temp, { recursive: true, force: true });
  });

  it('lists HTML files recursively within each session workspace and skips private/build trees', async () => {
    await mkdir(path.join(rootA, 'pages'));
    await mkdir(path.join(rootA, 'node_modules'));
    await writeFile(path.join(rootA, 'pages', 'index.html'), '<h1>A</h1>');
    await writeFile(path.join(rootA, '.secret.html'), 'private');
    await writeFile(path.join(rootA, 'node_modules', 'pkg.html'), 'ignored');
    await writeFile(path.join(rootB, 'b.htm'), '<h1>B</h1>');
    const a = await request(app).get('/api/design/files').query({ sessionId: 'sa' });
    const b = await request(app).get('/api/design/files').query({ sessionId: 'sw' });
    expect(a.body.data.files).toEqual(['pages/index.html']);
    expect(b.body.data.files).toEqual(['b.htm']);
  });

  it('rejects missing and unknown sessions', async () => {
    expect((await request(app).get('/api/design/files')).status).toBe(400);
    const result = await request(app).get('/api/design/files').query({ sessionId: 'absent' });
    expect(result.status).toBe(404);
    expect(result.body.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('lists workspace image assets and skips non-images, private and build trees', async () => {
    await mkdir(path.join(rootA, 'assets'));
    await mkdir(path.join(rootA, 'assets', 'sub'));
    await mkdir(path.join(rootA, '.git'));
    await mkdir(path.join(rootA, 'node_modules'));
    await mkdir(path.join(rootA, '.hidden'));
    await writeFile(path.join(rootA, 'assets', 'photo.png'), Buffer.from([1]));
    await writeFile(path.join(rootA, 'assets', 'sub', 'pic.JPG'), Buffer.from([2]));
    await writeFile(path.join(rootA, 'hero.webp'), Buffer.from([3]));
    await writeFile(path.join(rootA, 'logo.svg'), '<svg/>');
    await writeFile(path.join(rootA, 'icon.avif'), Buffer.from([4]));
    await writeFile(path.join(rootA, 'page.html'), '<p>doc</p>');
    await writeFile(path.join(rootA, 'notes.txt'), 'no');
    await writeFile(path.join(rootA, '.git', 'commit.png'), Buffer.from([5]));
    await writeFile(path.join(rootA, 'node_modules', 'pkg.png'), Buffer.from([6]));
    await writeFile(path.join(rootA, '.hidden', 'secret.png'), Buffer.from([7]));
    const response = await request(app).get('/api/design/assets').query({ sessionId: 'sa' });
    expect(response.status).toBe(200);
    expect(response.body.data.files).toEqual([
      'assets/photo.png',
      'assets/sub/pic.JPG',
      'hero.webp',
      'icon.avif',
      'logo.svg',
    ]);
  });

  it('silently skips escaping and broken image symlinks and validates the session', async () => {
    await writeFile(path.join(temp, 'outside.png'), Buffer.from([1]));
    await symlink(path.join(temp, 'outside.png'), path.join(rootA, 'escape.png'));
    await symlink(path.join(rootA, 'missing-target.png'), path.join(rootA, 'broken.png'));
    const response = await request(app).get('/api/design/assets').query({ sessionId: 'sa' });
    expect(response.status).toBe(200);
    expect(response.body.data.files).toEqual([]);
    const absent = await request(app).get('/api/design/assets').query({ sessionId: 'absent' });
    expect(absent.status).toBe(404);
    expect(absent.body.error.code).toBe('SESSION_NOT_FOUND');
    expect((await request(app).get('/api/design/assets')).status).toBe(400);
  });

  it('caps asset listing at MAX_LIST_FILES entries', async () => {
    const dir = path.join(rootA, 'many');
    await mkdir(dir);
    const names = Array.from({ length: 5001 }, (_, i) => `img-${String(i).padStart(4, '0')}.png`);
    for (let i = 0; i < names.length; i += 500) {
      await Promise.all(names.slice(i, i + 500).map(name => writeFile(path.join(dir, name), 'x')));
    }
    const response = await request(app).get('/api/design/assets').query({ sessionId: 'sa' });
    expect(response.status).toBe(200);
    expect(response.body.data.files).toHaveLength(5000);
    expect(response.body.data.files[0]).toBe('many/img-0000.png');
  });

  it('reads and updates existing HTML with revision protection', async () => {
    const file = path.join(rootA, 'index.html');
    await writeFile(file, '<p>old</p>');
    const loaded = await request(app)
      .get('/api/design/document')
      .query({ sessionId: 'sa', path: 'index.html' });
    expect(loaded.body.data).toMatchObject({ path: 'index.html', source: '<p>old</p>' });
    const saved = await request(app)
      .put('/api/design/document')
      .send({
        sessionId: 'sa',
        path: 'index.html',
        source: '<p>new</p>',
        expectedRevision: loaded.body.data.revision,
      });
    expect(saved.status).toBe(200);
    expect(saved.body.data.source).toBe('<p>new</p>');
    const stale = await request(app)
      .put('/api/design/document')
      .send({
        sessionId: 'sa',
        path: 'index.html',
        source: '<p>lost</p>',
        expectedRevision: loaded.body.data.revision,
      });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('REVISION_CONFLICT');
    expect(await readFile(file, 'utf8')).toBe('<p>new</p>');
  });

  it('rejects traversal, symlink escapes and creating documents', async () => {
    const external = path.join(temp, 'outside.html');
    await writeFile(external, 'outside');
    await symlink(external, path.join(rootA, 'escape.html'));
    for (const target of ['../outside.html', 'escape.html', '.hidden/index.html']) {
      const response = await request(app)
        .get('/api/design/document')
        .query({ sessionId: 'sa', path: target });
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    const create = await request(app)
      .put('/api/design/document')
      .send({ sessionId: 'sa', path: 'new.html', source: 'new', expectedRevision: '0'.repeat(64) });
    expect(create.status).toBe(404);
  });

  it('rejects symlink aliases to private files and to assets with a different canonical extension', async () => {
    await writeFile(path.join(rootA, '.env'), 'secret');
    await writeFile(path.join(rootA, 'style.css'), 'body{}');
    await symlink(path.join(rootA, '.env'), path.join(rootA, 'secret.png'));
    await symlink(path.join(rootA, 'style.css'), path.join(rootA, 'alias.png'));
    const secret = await request(app)
      .get('/api/design/asset')
      .query({ sessionId: 'sa', path: 'secret.png' });
    const alias = await request(app)
      .get('/api/design/asset')
      .query({ sessionId: 'sa', path: 'alias.png' });
    expect(secret.status).toBe(403);
    expect(alias.status).toBe(403);
  });

  it('rejects oversized documents before reading and refuses directories as assets', async () => {
    await writeFile(path.join(rootA, 'large.html'), Buffer.alloc(2 * 1024 * 1024 + 1, 65));
    await mkdir(path.join(rootA, 'folder.png'));
    const large = await request(app)
      .get('/api/design/document')
      .query({ sessionId: 'sa', path: 'large.html' });
    const directory = await request(app)
      .get('/api/design/asset')
      .query({ sessionId: 'sa', path: 'folder.png' });
    expect(large.status).toBe(413);
    expect(directory.status).toBe(400);
  });

  it('bounds recursive listing depth', async () => {
    const deep = path.join(rootA, ...Array.from({ length: 66 }, (_, i) => `d${i}`));
    await mkdir(deep, { recursive: true });
    await writeFile(path.join(deep, 'too-deep.html'), 'x');
    const listing = await request(app).get('/api/design/files').query({ sessionId: 'sa' });
    expect(listing.body.data.files).not.toContain(
      `${Array.from({ length: 66 }, (_, i) => `d${i}`).join('/')}/too-deep.html`
    );
  });

  it('serves allowed local assets as base64 and rejects other or escaping files', async () => {
    await writeFile(path.join(rootA, 'image.png'), Buffer.from([1, 2, 3]));
    await writeFile(path.join(rootA, 'notes.txt'), 'no');
    const image = await request(app)
      .get('/api/design/asset')
      .query({ sessionId: 'sa', path: 'image.png' });
    expect(image.body.data).toEqual({
      mimeType: 'image/png',
      data: Buffer.from([1, 2, 3]).toString('base64'),
    });
    const denied = await request(app)
      .get('/api/design/asset')
      .query({ sessionId: 'sa', path: 'notes.txt' });
    expect(denied.status).toBe(415);
  });
});

describe('design snapshot routes', () => {
  let db: Database.Database;
  let app: express.Express;
  let temp: string;
  let rootA: string;
  let rootB: string;

  const sha256 = (source: string | Buffer): string =>
    createHash('sha256').update(source).digest('hex');

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'design-snapshot-api-'));
    rootA = path.join(temp, 'a');
    rootB = path.join(temp, 'b');
    await mkdir(rootA);
    await mkdir(rootB);
    // Blob content must stay inside the test temp dir.
    process.env.ZCLAUDIA_DATA_DIR = temp;
    db = new Database(':memory:');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, working_directory TEXT);
      INSERT INTO projects VALUES ('pa', '${rootA}'), ('pb', '${rootB}');
      INSERT INTO sessions VALUES ('sa', 'pa', NULL), ('sa2', 'pa', NULL), ('sb', 'pb', NULL), ('sw', 'pa', '${rootB}');`);
    db.exec(migration050.sql);
    db.exec(migration052.sql); // pruneOldest 引用 design_shares（P7 §3 pin）
    app = express();
    app.use(express.json({ limit: '3mb' }));
    app.use('/api/design', createDesignRoutes(db));
  });

  afterEach(async () => {
    db.close();
    delete process.env.ZCLAUDIA_DATA_DIR;
    await rm(temp, { recursive: true, force: true });
  });

  async function seedSite(): Promise<void> {
    await mkdir(path.join(rootA, 'assets'));
    await writeFile(
      path.join(rootA, 'index.html'),
      '<html><head><link rel="stylesheet" href="assets/site.css"></head><body><p>v1</p></body></html>'
    );
    await writeFile(path.join(rootA, 'assets', 'site.css'), 'p { color: red; }');
  }

  it('captures, lists, reads files and restores through the API', async () => {
    await seedSite();
    const captured = await request(app)
      .post('/api/design/snapshots')
      .send({ sessionId: 'sa', path: 'index.html', label: 'v1' });
    expect(captured.status).toBe(200);
    expect(captured.body.data).toMatchObject({
      complete: true,
      entryPath: 'index.html',
      label: 'v1',
      fileCount: 2,
    });
    const id: string = captured.body.data.id;

    const list = await request(app)
      .get('/api/design/snapshots')
      .query({ sessionId: 'sa', path: 'index.html' });
    expect(list.body.data.map((entry: { id: string }) => entry.id)).toEqual([id]);

    const detail = await request(app).get(`/api/design/snapshots/${id}`).query({ sessionId: 'sa' });
    expect(detail.body.data.summary.id).toBe(id);
    expect(detail.body.data.files.map((file: { path: string }) => file.path).sort()).toEqual([
      'assets/site.css',
      'index.html',
    ]);

    const css = await request(app)
      .get(`/api/design/snapshots/${id}/file`)
      .query({ sessionId: 'sa', path: 'assets/site.css' });
    expect(css.body.data).toEqual({
      mime: 'text/css',
      data: Buffer.from('p { color: red; }').toString('base64'),
    });

    // External edits, then restore back to the snapshot byte-for-byte.
    await writeFile(path.join(rootA, 'index.html'), '<html><body><p>v2</p></body></html>');
    await writeFile(path.join(rootA, 'assets', 'site.css'), 'p { color: blue; }');
    const restored = await request(app)
      .post(`/api/design/snapshots/${id}/restore`)
      .send({
        sessionId: 'sa',
        expectedRevisions: {
          'index.html': sha256('<html><body><p>v2</p></body></html>'),
          'assets/site.css': sha256('p { color: blue; }'),
        },
      });
    expect(restored.status).toBe(200);
    expect(restored.body.data.restored.sort()).toEqual(['assets/site.css', 'index.html']);
    expect(await readFile(path.join(rootA, 'index.html'), 'utf8')).toContain('<p>v1</p>');
    expect(await readFile(path.join(rootA, 'assets', 'site.css'), 'utf8')).toBe('p { color: red; }');
    expect(restored.body.data.summary.source).toBe('restore');
  });

  it('dedupes identical manual captures', async () => {
    await seedSite();
    const first = await request(app)
      .post('/api/design/snapshots')
      .send({ sessionId: 'sa', path: 'index.html' });
    const second = await request(app)
      .post('/api/design/snapshots')
      .send({ sessionId: 'sa', path: 'index.html' });
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it('records panel-save captures as source save and rejects unknown sources', async () => {
    await seedSite();
    const captured = await request(app)
      .post('/api/design/snapshots')
      .send({ sessionId: 'sa', path: 'index.html', source: 'save' });
    expect(captured.status).toBe(200);
    expect(captured.body.data.source).toBe('save');

    // Change the content so the dedupe rule does not return the snapshot above.
    await writeFile(path.join(rootA, 'index.html'), '<html><body><p>v2</p></body></html>');
    const fallback = await request(app)
      .post('/api/design/snapshots')
      .send({ sessionId: 'sa', path: 'index.html', source: 'restore' });
    // Only client-initiated sources are accepted; anything else degrades to manual.
    expect(fallback.body.data.source).toBe('manual');
  });

  it('isolates snapshot lists per workspace and rejects cross-workspace restores', async () => {
    await seedSite();
    const captured = await request(app)
      .post('/api/design/snapshots')
      .send({ sessionId: 'sa', path: 'index.html' });
    const id: string = captured.body.data.id;

    const listA = await request(app)
      .get('/api/design/snapshots')
      .query({ sessionId: 'sa', path: 'index.html' });
    expect(listA.body.data.map((entry: { id: string }) => entry.id)).toEqual([id]);
    const listA2 = await request(app)
      .get('/api/design/snapshots')
      .query({ sessionId: 'sa2', path: 'index.html' });
    // Same workspace root → identical history for both sessions.
    expect(listA2.body.data).toEqual(listA.body.data);

    const listB = await request(app)
      .get('/api/design/snapshots')
      .query({ sessionId: 'sb', path: 'index.html' });
    expect(listB.body.data).toEqual([]);

    const mismatch = await request(app)
      .post(`/api/design/snapshots/${id}/restore`)
      .send({ sessionId: 'sw', expectedRevisions: {} });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe('WORKSPACE_MISMATCH');
  });

  it('returns 404 for unknown snapshots and guards snapshot file paths', async () => {
    await seedSite();
    const missing = await request(app)
      .get('/api/design/snapshots/does-not-exist')
      .query({ sessionId: 'sa' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('SNAPSHOT_NOT_FOUND');

    const captured = await request(app)
      .post('/api/design/snapshots')
      .send({ sessionId: 'sa', path: 'index.html' });
    const id: string = captured.body.data.id;

    const escape = await request(app)
      .get(`/api/design/snapshots/${id}/file`)
      .query({ sessionId: 'sa', path: '../outside.html' });
    expect(escape.status).toBe(403);
    expect(escape.body.error.code).toBe('PATH_FORBIDDEN');

    const outside = await request(app)
      .get(`/api/design/snapshots/${id}/file`)
      .query({ sessionId: 'sa', path: 'not-in-manifest.png' });
    expect(outside.status).toBe(404);
  });

  it('reports restore conflicts with file detail and requires confirmation for incomplete snapshots', async () => {
    await seedSite();
    const captured = await request(app)
      .post('/api/design/snapshots')
      .send({ sessionId: 'sa', path: 'index.html' });
    const id: string = captured.body.data.id;

    await writeFile(path.join(rootA, 'index.html'), '<html><body><p>v2</p></body></html>');
    const stale = await request(app)
      .post(`/api/design/snapshots/${id}/restore`)
      .send({
        sessionId: 'sa',
        expectedRevisions: {
          'index.html': sha256('<html><body><p>v1</p></body></html>'),
          'assets/site.css': sha256('p { color: red; }'),
        },
      });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('RESTORE_CONFLICT');
    expect(stale.body.error.files).toEqual([
      {
        path: 'index.html',
        reason: 'revision-mismatch',
        expectedRevision: sha256('<html><body><p>v1</p></body></html>'),
        actualRevision: sha256('<html><body><p>v2</p></body></html>'),
      },
    ]);

    await writeFile(
      path.join(rootA, 'index.html'),
      '<html><body><img src="missing.png"><p>incomplete</p></body></html>'
    );
    const incomplete = await request(app)
      .post('/api/design/snapshots')
      .send({ sessionId: 'sa', path: 'index.html' });
    expect(incomplete.body.data.complete).toBe(false);
    const incompleteId: string = incomplete.body.data.id;

    const unconfirmed = await request(app)
      .post(`/api/design/snapshots/${incompleteId}/restore`)
      .send({ sessionId: 'sa', expectedRevisions: {} });
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body.error.code).toBe('SNAPSHOT_INCOMPLETE');

    const confirmed = await request(app)
      .post(`/api/design/snapshots/${incompleteId}/restore`)
      .send({
        sessionId: 'sa',
        confirmIncomplete: true,
        expectedRevisions: {
          'index.html': sha256(
            '<html><body><img src="missing.png"><p>incomplete</p></body></html>'
          ),
        },
      });
    expect(confirmed.status).toBe(200);
    expect(await readFile(path.join(rootA, 'index.html'), 'utf8')).toContain('incomplete');
  });
});

describe('design deps and export routes', () => {
  let db: Database.Database;
  let app: express.Express;
  let temp: string;
  let rootA: string;

  const sha256 = (source: string | Buffer): string =>
    createHash('sha256').update(source).digest('hex');

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'design-deps-api-'));
    rootA = path.join(temp, 'a');
    await mkdir(rootA);
    db = new Database(':memory:');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, working_directory TEXT);
      INSERT INTO projects VALUES ('pa', '${rootA}');
      INSERT INTO sessions VALUES ('sa', 'pa', NULL);`);
    app = express();
    app.use(express.json({ limit: '3mb' }));
    app.use('/api/design', createDesignRoutes(db));
  });

  afterEach(async () => {
    db.close();
    await rm(temp, { recursive: true, force: true });
  });

  async function seedSite(): Promise<{ html: string; css: string }> {
    await mkdir(path.join(rootA, 'assets'), { recursive: true });
    const html =
      '<html><head><link rel="stylesheet" href="assets/site.css"></head><body><img src="assets/bg.png"></body></html>';
    const css = 'body { background: url("bg.png"); }';
    await writeFile(path.join(rootA, 'index.html'), html);
    await writeFile(path.join(rootA, 'assets', 'site.css'), css);
    await writeFile(path.join(rootA, 'assets', 'bg.png'), Buffer.from([1, 2, 3, 4]));
    return { html, css };
  }

  function parseBinary(res: unknown, callback: (error: Error | null, body?: Buffer) => void): void {
    const stream = res as { on: (event: string, listener: (chunk?: Buffer) => void) => void };
    const chunks: Buffer[] = [];
    stream.on('data', chunk => chunks.push(chunk as Buffer));
    stream.on('end', () => callback(null, Buffer.concat(chunks)));
  }

  it('returns dependency stats for an entry with kinds and skip reasons', async () => {
    await seedSite();
    const listed = await request(app)
      .get('/api/design/deps')
      .query({ sessionId: 'sa', path: 'index.html' });
    expect(listed.status).toBe(200);
    expect(listed.body.success).toBe(true);
    expect(listed.body.data.entry.path).toBe('index.html');
    expect(typeof listed.body.data.entry.size).toBe('number');
    const files = new Map(
      (listed.body.data.files as Array<{ path: string; kind: string; missing: boolean }>).map(
        file => [file.path, file]
      )
    );
    expect([...files.keys()].sort()).toEqual(['assets/bg.png', 'assets/site.css']);
    expect(files.get('assets/site.css')).toMatchObject({ kind: 'css', missing: false });
    expect(files.get('assets/bg.png')).toMatchObject({ kind: 'image', missing: false });
    expect(listed.body.data.skipped).toEqual([]);

    const missing = await request(app)
      .get('/api/design/deps')
      .query({ sessionId: 'sa', path: 'nope.html' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('FILE_NOT_FOUND');
  });

  it('exports a zip attachment and falls back to JSON errors', async () => {
    const { html } = await seedSite();
    const loaded = await request(app)
      .get('/api/design/document')
      .query({ sessionId: 'sa', path: 'index.html' });
    const revision: string = loaded.body.data.revision;

    const ok = await request(app)
      .post('/api/design/export')
      .buffer(true)
      .parse(parseBinary)
      .send({ sessionId: 'sa', path: 'index.html', mode: 'disk', expectedRevision: revision });
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('application/zip');
    expect(ok.headers['content-disposition']).toMatch(
      /^attachment; filename="index-\d{8}-\d{6}\.zip"$/
    );
    expect(Number(ok.headers['content-length'])).toBe(ok.body.length);
    const zip = await JSZip.loadAsync(ok.body);
    expect(await zip.file('index.html')?.async('string')).toBe(html);
    expect(await zip.file('assets/site.css')?.async('string')).toBe('body { background: url("bg.png"); }');
    expect(zip.file('zclaudia-export.json')).toBeTruthy();

    const stale = await request(app)
      .post('/api/design/export')
      .send({ sessionId: 'sa', path: 'index.html', mode: 'disk', expectedRevision: '0'.repeat(64) });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('REVISION_CONFLICT');

    const unknown = await request(app)
      .post('/api/design/export')
      .send({ sessionId: 'absent', path: 'index.html', mode: 'disk' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('surfaces EXPORT_INCOMPLETE with the missing list and honors confirmIncomplete', async () => {
    await seedSite();
    await writeFile(
      path.join(rootA, 'index.html'),
      '<html><body><img src="gone.png"></body></html>'
    );

    const denied = await request(app)
      .post('/api/design/export')
      .send({ sessionId: 'sa', path: 'index.html', mode: 'disk' });
    expect(denied.status).toBe(409);
    expect(denied.body.error.code).toBe('EXPORT_INCOMPLETE');
    expect(denied.body.error.files).toEqual(['gone.png']);

    const ok = await request(app)
      .post('/api/design/export')
      .buffer(true)
      .parse(parseBinary)
      .send({ sessionId: 'sa', path: 'index.html', mode: 'disk', confirmIncomplete: true });
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('application/zip');
    const zip = await JSZip.loadAsync(ok.body);
    const manifest = JSON.parse((await zip.file('zclaudia-export.json')?.async('string')) ?? 'null');
    expect(manifest.missing).toEqual(['gone.png']);
    expect(zip.file('gone.png')).toBeNull();
  });

  it('recreates a deleted document via allowCreate while keeping the guards', async () => {
    await writeFile(path.join(rootA, 'index.html'), '<p>v1</p>');

    // Rebuild after deletion: empty revision + allowCreate.
    await rm(path.join(rootA, 'index.html'));
    const rebuilt = await request(app)
      .put('/api/design/document')
      .send({ sessionId: 'sa', path: 'index.html', source: '<p>rebuilt</p>', expectedRevision: '', allowCreate: true });
    expect(rebuilt.status).toBe(200);
    expect(rebuilt.body.data.revision).toBe(sha256('<p>rebuilt</p>'));
    expect(await readFile(path.join(rootA, 'index.html'), 'utf8')).toBe('<p>rebuilt</p>');

    // Without allowCreate a missing file stays FILE_NOT_FOUND (an empty
    // revision alone is a VALIDATION_ERROR, so a real hash is sent here).
    await rm(path.join(rootA, 'index.html'));
    const denied = await request(app)
      .put('/api/design/document')
      .send({ sessionId: 'sa', path: 'index.html', source: 'x', expectedRevision: 'b'.repeat(64) });
    expect(denied.status).toBe(404);
    expect(denied.body.error.code).toBe('FILE_NOT_FOUND');

    // allowCreate with a non-empty revision on a missing file is a conflict.
    const conflict = await request(app)
      .put('/api/design/document')
      .send({
        sessionId: 'sa',
        path: 'index.html',
        source: 'x',
        expectedRevision: 'a'.repeat(64),
        allowCreate: true,
      });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('REVISION_CONFLICT');

    // allowCreate against an existing file still verifies the revision.
    await writeFile(path.join(rootA, 'index.html'), '<p>live</p>');
    const stale = await request(app)
      .put('/api/design/document')
      .send({ sessionId: 'sa', path: 'index.html', source: 'x', expectedRevision: '', allowCreate: true });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('REVISION_CONFLICT');
    expect(await readFile(path.join(rootA, 'index.html'), 'utf8')).toBe('<p>live</p>');
  });
});

describe('design template, brand and asset routes', () => {
  let db: Database.Database;
  let app: express.Express;
  let temp: string;
  let rootA: string;

  const sha256 = (source: string | Buffer): string =>
    createHash('sha256').update(source).digest('hex');

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'design-p4-api-'));
    rootA = path.join(temp, 'a');
    await mkdir(rootA);
    db = new Database(':memory:');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, working_directory TEXT);
      INSERT INTO projects VALUES ('pa', '${rootA}');
      INSERT INTO sessions VALUES ('sa', 'pa', NULL);`);
    app = express();
    // Mirrors the production body limit so a >10 MiB decoded import fits as
    // ~13.4 MiB of base64 JSON.
    app.use(express.json({ limit: '15mb' }));
    app.use('/api/design', createDesignRoutes(db));
  });
  afterEach(async () => {
    db.close();
    await rm(temp, { recursive: true, force: true });
  });

  it('lists the built-in template catalog', async () => {
    const response = await request(app).get('/api/design/templates');
    expect(response.status).toBe(200);
    const templates = response.body.data.templates;
    expect(templates.map((template: { id: string }) => template.id)).toEqual([
      'landing',
      'dashboard',
      'mobile',
      'showcase',
    ]);
    for (const template of templates) {
      expect(template).toMatchObject({ version: '1.0.0', source: 'zclaudia-builtin' });
      expect(template.entry).toBe(`design/${template.id}/index.html`);
      expect(template.files).toContain(template.entry);
    }
  });

  it('installs a template end to end and guards repeats with the conflict file list', async () => {
    const installed = await request(app)
      .post('/api/design/templates/install')
      .send({ sessionId: 'sa', templateId: 'landing' });
    expect(installed.status).toBe(200);
    expect(installed.body.data).toEqual({
      installed: [
        'design/landing/index.html',
        'design/landing/styles.css',
        'design/landing/TEMPLATE.json',
      ],
      entry: 'design/landing/index.html',
    });
    expect(await readFile(path.join(rootA, 'design', 'landing', 'index.html'), 'utf8')).toContain(
      '<html lang="zh-CN">'
    );
    const marker = JSON.parse(
      await readFile(path.join(rootA, 'design', 'landing', 'TEMPLATE.json'), 'utf8')
    );
    expect(marker).toMatchObject({
      templateId: 'landing',
      version: '1.0.0',
      entry: 'design/landing/index.html',
    });

    const repeat = await request(app)
      .post('/api/design/templates/install')
      .send({ sessionId: 'sa', templateId: 'landing' });
    expect(repeat.status).toBe(409);
    expect(repeat.body.error.code).toBe('TEMPLATE_TARGET_EXISTS');
    expect(repeat.body.error.files).toEqual([
      'design/landing/index.html',
      'design/landing/styles.css',
      'design/landing/TEMPLATE.json',
    ]);

    const overwritten = await request(app)
      .post('/api/design/templates/install')
      .send({ sessionId: 'sa', templateId: 'landing', overwrite: true });
    expect(overwritten.status).toBe(200);
    expect(overwritten.body.data.installed).toHaveLength(3);

    // An external edit between installs is still replaceable by an explicit
    // overwrite (the service hashes the current content before writing; the
    // mid-install race itself is covered by the application-layer test).
    await writeFile(path.join(rootA, 'design', 'landing', 'index.html'), '<p>hand-edited</p>');
    const restored = await request(app)
      .post('/api/design/templates/install')
      .send({ sessionId: 'sa', templateId: 'landing', overwrite: true });
    expect(restored.status).toBe(200);
    expect(await readFile(path.join(rootA, 'design', 'landing', 'index.html'), 'utf8')).toContain(
      '<html lang="zh-CN">'
    );

    const unknown = await request(app)
      .post('/api/design/templates/install')
      .send({ sessionId: 'sa', templateId: 'nope' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('TEMPLATE_NOT_FOUND');
  });

  it('reads and writes the brand pair with revision protection', async () => {
    const empty = await request(app).get('/api/design/brand').query({ sessionId: 'sa' });
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual({
      designMd: null,
      designMdRevision: null,
      tokensCss: null,
      tokensCssRevision: null,
    });

    const designMd = '# 品牌与设计系统\n';
    const tokensCss = ':root { --color-primary: #4f46e5; }\n';
    const created = await request(app)
      .put('/api/design/brand')
      .send({ sessionId: 'sa', designMd, designMdRevision: '', tokensCss, tokensCssRevision: '' });
    expect(created.status).toBe(200);
    expect(created.body.data).toEqual({
      designMdRevision: sha256(designMd),
      tokensCssRevision: sha256(tokensCss),
    });
    const loaded = await request(app).get('/api/design/brand').query({ sessionId: 'sa' });
    expect(loaded.body.data).toEqual({
      designMd,
      designMdRevision: sha256(designMd),
      tokensCss,
      tokensCssRevision: sha256(tokensCss),
    });

    const stale = await request(app)
      .put('/api/design/brand')
      .send({ sessionId: 'sa', designMd: '# 过期更新\n', designMdRevision: '' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('REVISION_CONFLICT');

    // Single-file commit: tokens.css update leaves DESIGN.md alone.
    const tokensNext = ':root { --color-primary: #7c3aed; }\n';
    const single = await request(app).put('/api/design/brand').send({
      sessionId: 'sa',
      tokensCss: tokensNext,
      tokensCssRevision: sha256(tokensCss),
    });
    expect(single.status).toBe(200);
    expect(single.body.data).toEqual({ designMdRevision: null, tokensCssRevision: sha256(tokensNext) });
    expect((await request(app).get('/api/design/brand').query({ sessionId: 'sa' })).body.data.designMd).toBe(designMd);

    const oversized = 'x'.repeat(256 * 1024 + 1);
    const tooLarge = await request(app)
      .put('/api/design/brand')
      .send({ sessionId: 'sa', designMd: oversized, designMdRevision: '' });
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error.code).toBe('FILE_TOO_LARGE');

    const invalid = await request(app).put('/api/design/brand').send({ sessionId: 'sa' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('filters assets by kinds with image as the backward-compatible default', async () => {
    await mkdir(path.join(rootA, 'assets'), { recursive: true });
    await writeFile(path.join(rootA, 'assets', 'photo.png'), Buffer.from([1]));
    await writeFile(path.join(rootA, 'assets', 'logo.svg'), '<svg/>');
    await writeFile(path.join(rootA, 'assets', 'text.woff2'), Buffer.from([2]));
    await writeFile(path.join(rootA, 'assets', 'font.ttf'), Buffer.from([3]));
    await writeFile(path.join(rootA, 'assets', 'notes.txt'), 'no');

    const byKinds = new Map<string, string[]>();
    for (const kinds of [undefined, 'image', 'font', 'all']) {
      const response = await request(app)
        .get('/api/design/assets')
        .query({ sessionId: 'sa', ...(kinds === undefined ? {} : { kinds }) });
      expect(response.status).toBe(200);
      byKinds.set(kinds ?? 'default', response.body.data.files);
    }
    const images = ['assets/logo.svg', 'assets/photo.png'];
    const fonts = ['assets/font.ttf', 'assets/text.woff2'];
    expect(byKinds.get('default')).toEqual(images);
    expect(byKinds.get('image')).toEqual(images);
    expect(byKinds.get('font')).toEqual(fonts);
    expect(byKinds.get('all')).toEqual([...images, ...fonts].sort());

    // 'video' is a valid kind since P6 §5.3; a truly unknown kind still rejects.
    const bogus = await request(app)
      .get('/api/design/assets')
      .query({ sessionId: 'sa', kinds: 'audio' });
    expect(bogus.status).toBe(400);
    expect(bogus.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('imports assets with dedupe suffixes and rejects invalid names, extensions and payloads', async () => {
    const png = Buffer.from([137, 80, 78, 71]);
    const first = await request(app)
      .post('/api/design/assets/import')
      .send({ sessionId: 'sa', fileName: 'logo.png', dataBase64: png.toString('base64') });
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ path: 'design/assets/logo.png' });
    expect(await readFile(path.join(rootA, 'design', 'assets', 'logo.png'))).toEqual(png);

    const second = await request(app)
      .post('/api/design/assets/import')
      .send({ sessionId: 'sa', fileName: 'logo.png', dataBase64: png.toString('base64') });
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual({ path: 'design/assets/logo-2.png' });
    expect(await readFile(path.join(rootA, 'design', 'assets', 'logo-2.png'))).toEqual(png);
    // Original never overwritten.
    expect(await readFile(path.join(rootA, 'design', 'assets', 'logo.png'))).toEqual(png);

    const custom = await request(app)
      .post('/api/design/assets/import')
      .send({
        sessionId: 'sa',
        fileName: 'brand.woff2',
        dataBase64: Buffer.from([9]).toString('base64'),
        targetDir: 'design/fonts',
      });
    expect(custom.status).toBe(200);
    expect(custom.body.data).toEqual({ path: 'design/fonts/brand.woff2' });

    const rejects: Array<{ payload: Record<string, unknown>; reason: string }> = [
      { payload: { fileName: 'a/b.png', dataBase64: 'AAAA' }, reason: 'path separator' },
      { payload: { fileName: 'notes.txt', dataBase64: 'AAAA' }, reason: 'bad extension' },
      { payload: { fileName: 'noext', dataBase64: 'AAAA' }, reason: 'missing extension' },
      { payload: { fileName: 'ok.png', dataBase64: 'not base64!!' }, reason: 'bad base64' },
      { payload: { fileName: 'ok.png', dataBase64: '' }, reason: 'empty payload' },
      {
        payload: {
          fileName: 'huge.png',
          dataBase64: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64'),
        },
        reason: 'oversize payload',
      },
    ];
    for (const { payload, reason } of rejects) {
      const response = await request(app)
        .post('/api/design/assets/import')
        .send({ sessionId: 'sa', ...payload });
      expect(response.status, reason).toBe(400);
      expect(response.body.error.code, reason).toBe('ASSET_INVALID');
    }

    const traversal = await request(app)
      .post('/api/design/assets/import')
      .send({
        sessionId: 'sa',
        fileName: 'ok.png',
        dataBase64: 'AAAA',
        targetDir: '../outside',
      });
    expect(traversal.status).toBe(400);
    expect(traversal.body.error.code).toBe('VALIDATION_ERROR');
  });
});

/** 媒体路由假件：记录调用并返回固定信封数据（不触真装配）。 */
class FakeMediaService {
  createCalls: Array<{ sessionId: unknown; input: unknown }> = [];
  listCalls: Array<{ sessionId: unknown; limit: unknown }> = [];
  cancelCalls: Array<{ sessionId: unknown; taskId: unknown }> = [];
  resultTargetCalls: Array<{ sessionId: unknown; taskId: unknown }> = [];
  listResult: DesignMediaTaskSummary[] = [];
  createError: DesignError | null = null;
  resultTargetError: DesignError | null = null;
  resultTargetValue: {
    absolutePath: string;
    fileName: string;
    mime: string;
    bytes: number;
  } = { absolutePath: '/nowhere/x.png', fileName: 'x.png', mime: 'image/png', bytes: 0 };

  async create(sessionId: unknown, input: unknown): Promise<DesignMediaTaskSummary> {
    this.createCalls.push({ sessionId, input });
    if (this.createError) throw this.createError;
    return {
      id: `task-${this.createCalls.length}`,
      kind: 'image-generate',
      status: 'queued',
      createdAt: 100,
      updatedAt: 100,
      provider: {
        providerId: 'openai-images',
        profileId: 'p1',
        profileName: 'BigModel',
        model: 'cogview-4',
      },
      params: { type: 'image-generate', prompt: 'a cat', targetDir: 'design/assets' },
      progress: null,
      result: null,
      error: null,
    };
  }

  async list(sessionId: unknown, limit?: unknown): Promise<DesignMediaTaskSummary[]> {
    this.listCalls.push({ sessionId, limit });
    return this.listResult;
  }

  async cancel(sessionId: unknown, taskId: unknown): Promise<DesignMediaTaskSummary> {
    this.cancelCalls.push({ sessionId, taskId });
    return {
      id: String(taskId),
      kind: 'image-generate',
      status: 'cancelled',
      createdAt: 100,
      updatedAt: 200,
      provider: null,
      params: { type: 'image-generate', prompt: 'a cat', targetDir: 'design/assets' },
      progress: null,
      result: null,
      error: null,
    };
  }

  async resultTarget(
    sessionId: unknown,
    taskId: unknown
  ): Promise<{ absolutePath: string; fileName: string; mime: string; bytes: number }> {
    this.resultTargetCalls.push({ sessionId, taskId });
    if (this.resultTargetError) throw this.resultTargetError;
    return this.resultTargetValue;
  }
}

describe('design media routes', () => {
  let db: Database.Database;
  let app: express.Express;
  let temp: string;
  let rootA: string;
  let media: FakeMediaService;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'design-media-api-'));
    rootA = path.join(temp, 'a');
    await mkdir(rootA);
    db = new Database(':memory:');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, working_directory TEXT);
      INSERT INTO projects VALUES ('pa', '${rootA}');
      INSERT INTO sessions VALUES ('sa', 'pa', NULL);`);
    media = new FakeMediaService();
    app = express();
    app.use(express.json({ limit: '3mb' }));
    app.use(
      '/api/design',
      createDesignRoutes(db, {
        mediaService: media as unknown as MediaTaskService,
        listProfiles: () => [
          { id: 'p1', name: 'BigModel', providerType: 'openai', apiKey: 'sk-secret' },
          { id: 'p2', name: 'Keyless', providerType: 'openai' },
          { id: 'p3', name: 'Claude', providerType: 'anthropic', apiKey: 'sk-anthropic' },
        ],
      })
    );
  });
  afterEach(async () => {
    db.close();
    await rm(temp, { recursive: true, force: true });
  });

  it('lists the provider catalog with openai-only profiles and no credential material', async () => {
    const response = await request(app).get('/api/design/media/providers');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.providers).toEqual([
      { id: 'openai-images', label: 'OpenAI-compatible image service', capabilities: ['generate', 'edit'] },
    ]);
    expect(response.body.data.profiles).toEqual([
      { id: 'p1', name: 'BigModel', providerType: 'openai', hasCredential: true },
      { id: 'p2', name: 'Keyless', providerType: 'openai', hasCredential: false },
    ]);
    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain('sk-secret');
    expect(raw).not.toContain('sk-anthropic');
    expect(raw).not.toContain('apiKey');
  });

  it('creates tasks through the service with the body minus sessionId and maps errors to envelopes', async () => {
    const payload = {
      kind: 'image-generate',
      provider: { profileId: 'p1', model: 'cogview-4' },
      prompt: 'a cat',
    };
    const created = await request(app)
      .post('/api/design/media-tasks')
      .send({ sessionId: 'sa', ...payload });
    expect(created.status).toBe(201);
    expect(created.body.success).toBe(true);
    expect(created.body.data).toMatchObject({ id: 'task-1', kind: 'image-generate', status: 'queued' });
    expect(media.createCalls).toEqual([{ sessionId: 'sa', input: payload }]);

    media.createError = new DesignError(409, 'MEDIA_TASK_ACTIVE_EXISTS', 'An identical task is already in progress');
    const conflict = await request(app)
      .post('/api/design/media-tasks')
      .send({ sessionId: 'sa', ...payload });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({
      success: false,
      error: { code: 'MEDIA_TASK_ACTIVE_EXISTS', message: 'An identical task is already in progress' },
    });

    media.createError = new DesignError(400, 'MEDIA_VALIDATION', 'prompt must be a non-empty string');
    const invalid = await request(app)
      .post('/api/design/media-tasks')
      .send({ sessionId: 'sa', kind: 'image-generate' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatchObject({
      code: 'MEDIA_VALIDATION',
      message: 'prompt must be a non-empty string',
    });
  });

  it('lists tasks newest first and coerces a numeric limit from the query', async () => {
    media.listResult = [
      { id: 't2' } as DesignMediaTaskSummary,
      { id: 't1' } as DesignMediaTaskSummary,
    ];
    const all = await request(app).get('/api/design/media-tasks').query({ sessionId: 'sa' });
    expect(all.status).toBe(200);
    expect(all.body).toEqual({ success: true, data: { tasks: media.listResult } });
    expect(media.listCalls[0]).toEqual({ sessionId: 'sa', limit: undefined });

    await request(app).get('/api/design/media-tasks').query({ sessionId: 'sa', limit: '2' });
    expect(media.listCalls[1]).toEqual({ sessionId: 'sa', limit: 2 });
  });

  it('cancels by task id from the path with the body session', async () => {
    const cancelled = await request(app)
      .post('/api/design/media-tasks/task-9/cancel')
      .send({ sessionId: 'sa' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      success: true,
      data: { id: 'task-9', status: 'cancelled' },
    });
    expect(media.cancelCalls).toEqual([{ sessionId: 'sa', taskId: 'task-9' }]);
  });

  it('streams completed results as binary attachments and maps invalid state to a 409 envelope', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    await mkdir(path.join(rootA, 'design', 'assets'), { recursive: true });
    await writeFile(path.join(rootA, 'design', 'assets', 'gen-cat.png'), bytes);
    media.resultTargetValue = {
      absolutePath: path.join(rootA, 'design', 'assets', 'gen-cat.png'),
      fileName: 'gen-cat.png',
      mime: 'image/png',
      bytes: bytes.length,
    };

    const ok = await request(app)
      .get('/api/design/media-tasks/task-1/result')
      .query({ sessionId: 'sa' })
      .buffer(true)
      .parse(parseBinary);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('image/png');
    expect(ok.headers['content-disposition']).toBe('attachment; filename="gen-cat.png"');
    expect(Number(ok.headers['content-length'])).toBe(bytes.length);
    expect(ok.body).toEqual(bytes);
    expect(media.resultTargetCalls).toEqual([{ sessionId: 'sa', taskId: 'task-1' }]);

    media.resultTargetError = new DesignError(
      409,
      'MEDIA_TASK_INVALID_STATE',
      'The task is not finished yet or has no artifact'
    );
    const conflict = await request(app)
      .get('/api/design/media-tasks/task-1/result')
      .query({ sessionId: 'sa' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toMatchObject({
      code: 'MEDIA_TASK_INVALID_STATE',
      message: 'The task is not finished yet or has no artifact',
    });
  });
});

describe('design media routes real assembly', () => {
  let db: Database.Database;
  let temp: string;
  let rootA: string;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'design-media-real-'));
    rootA = path.join(temp, 'a');
    await mkdir(rootA);
    db = new Database(':memory:');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, working_directory TEXT);
      INSERT INTO projects VALUES ('pa', '${rootA}');
      INSERT INTO sessions VALUES ('sa', 'pa', NULL);`);
    db.exec(migration051.sql);
    // llm_profiles 最小 DDL（migration 001 同款前缀列；mapRow 对缺省列宽容）。
    db.exec(`CREATE TABLE IF NOT EXISTS llm_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL DEFAULT 'anthropic',
      base_url TEXT,
      api_key TEXT,
      compat TEXT,
      env TEXT,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );`);
    const insertProfile = db.prepare(
      `INSERT INTO llm_profiles (id, name, provider_type, base_url, api_key, is_default, created_at, updated_at)
       VALUES (?, ?, ?, 'https://api.openai.com/v1', ?, 0, 1, 1)`
    );
    insertProfile.run('p-live', 'BigModel Live', 'openai', 'sk-live-1');
    insertProfile.run('p-blank', 'Keyless OpenAI', 'openai', null);
    insertProfile.run('p-claude', 'Claude', 'anthropic', 'sk-anthropic');
  });
  afterEach(async () => {
    db.close();
    await rm(temp, { recursive: true, force: true });
  });

  function mountApp(mediaDeps?: DesignMediaRoutesDeps): express.Express {
    const app = express();
    app.use(express.json({ limit: '3mb' }));
    app.use('/api/design', createDesignRoutes(db, mediaDeps));
    return app;
  }

  /** 轮询任务列表直至终态（媒体任务经 HTTP 轮询观察，进度即列表）。 */
  async function waitForTerminal(
    app: express.Express,
    sessionId: string,
    taskId: string
  ): Promise<DesignMediaTaskSummary> {
    for (let attempt = 0; attempt < 200; attempt++) {
      const listed = await request(app).get('/api/design/media-tasks').query({ sessionId });
      const task = listed.body.data.tasks.find((entry: { id: string }) => entry.id === taskId);
      if (task && (task.status === 'completed' || task.status === 'failed')) return task;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`task ${taskId} did not reach a terminal state in time`);
  }

  it('serves the provider catalog from the real profile repository without leaking keys', async () => {
    const response = await request(mountApp()).get('/api/design/media/providers');
    expect(response.status).toBe(200);
    expect(response.body.data.providers).toEqual([
      { id: 'openai-images', label: 'OpenAI-compatible image service', capabilities: ['generate', 'edit'] },
    ]);
    // findAllOrdered：is_default DESC 后 name ASC。
    expect(response.body.data.profiles).toEqual([
      { id: 'p-live', name: 'BigModel Live', providerType: 'openai', hasCredential: true },
      { id: 'p-blank', name: 'Keyless OpenAI', providerType: 'openai', hasCredential: false },
    ]);
    expect(JSON.stringify(response.body)).not.toContain('sk-');
  });

  it('validates create bodies through the real service before any task row exists', async () => {
    const app = mountApp();
    const invalid = await request(app)
      .post('/api/design/media-tasks')
      .send({ sessionId: 'sa', kind: 'nope' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('MEDIA_VALIDATION');

    const unknownProfile = await request(app)
      .post('/api/design/media-tasks')
      .send({
        sessionId: 'sa',
        kind: 'image-generate',
        provider: { profileId: 'absent', model: 'm' },
        prompt: 'x',
      });
    expect(unknownProfile.status).toBe(400);
    expect(unknownProfile.body.error.message).toBe('The specified service profile does not exist');
  });

  it('runs image generation end to end with an injected provider and streams the artifact back', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);
    const generate = vi.fn(async () => ({
      bytes: png,
      mime: 'image/png' as const,
      usage: { totalCostUsd: 0.01 },
    }));
    const fakeProvider: MediaImageProvider = {
      info: { id: 'fake-images', label: '假图片服务', capabilities: ['generate'] },
      generate: generate as unknown as MediaImageProvider['generate'],
      edit: async () => ({ bytes: png, mime: 'image/png', usage: null }),
    };
    const app = mountApp({ makeImageProvider: async () => fakeProvider });

    const created = await request(app)
      .post('/api/design/media-tasks')
      .send({
        sessionId: 'sa',
        kind: 'image-generate',
        provider: { profileId: 'p-live', model: 'cogview-4' },
        prompt: 'a cat',
      });
    expect(created.status).toBe(201);
    expect(created.body.data.provider).toEqual({
      providerId: 'openai-images',
      profileId: 'p-live',
      profileName: 'BigModel Live',
      model: 'cogview-4',
    });
    const id: string = created.body.data.id;

    const summary = await waitForTerminal(app, 'sa', id);
    expect(summary.status).toBe('completed');
    expect(summary.result).toMatchObject({ mime: 'image/png', usage: { totalCostUsd: 0.01 } });
    expect(summary.result.path).toMatch(/^design\/assets\/gen-a-cat-\d{8}-\d{6}\.png$/);
    expect(await readFile(path.join(rootA, summary.result.path))).toEqual(png);
    expect(generate).toHaveBeenCalledWith({
      prompt: 'a cat',
      size: undefined,
      signal: expect.anything(),
    });

    const download = await request(app)
      .get(`/api/design/media-tasks/${id}/result`)
      .query({ sessionId: 'sa' })
      .buffer(true)
      .parse(parseBinary);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toBe('image/png');
    expect(download.headers['content-disposition']).toBe(
      `attachment; filename="${path.basename(summary.result.path)}"`
    );
    expect(download.body).toEqual(png);
  });

  it('fails tasks through the real credential guards without touching the network', async () => {
    const app = mountApp();
    // 非 openai 型 profile 在提交期即被拒（resolveProfileName 限定）。
    const anthropic = await request(app)
      .post('/api/design/media-tasks')
      .send({
        sessionId: 'sa',
        kind: 'image-generate',
        provider: { profileId: 'p-claude', model: 'm' },
        prompt: 'guard one',
      });
    expect(anthropic.status).toBe(400);
    expect(anthropic.body.error).toMatchObject({
      code: 'MEDIA_VALIDATION',
      message: 'The specified service profile does not exist',
    });

    // openai 型但缺 apiKey：提交通过，执行期凭据守卫让任务失败（不触网）。
    const keyless = await request(app)
      .post('/api/design/media-tasks')
      .send({
        sessionId: 'sa',
        kind: 'image-generate',
        provider: { profileId: 'p-blank', model: 'm' },
        prompt: 'guard two',
      });
    const missingKey = await waitForTerminal(app, 'sa', keyless.body.data.id);
    expect(missingKey.status).toBe('failed');
    expect(missingKey.error).toMatchObject({
      code: 'INTERNAL',
      message: 'The selected service profile has no API key',
    });

    // 失败任务不落任何产物文件。
    const assets = await request(app).get('/api/design/assets').query({ sessionId: 'sa' });
    expect(assets.body.data.files).toEqual([]);
  });
});

describe('design share routes (P7)', () => {
  let db: Database.Database;
  let app: express.Express;
  let temp: string;
  let rootA: string;
  let rootB: string;

  const DAY_MS = 86_400_000;
  let commentSeq = 0;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'design-share-api-'));
    rootA = path.join(temp, 'a');
    rootB = path.join(temp, 'b');
    await mkdir(rootA);
    await mkdir(rootB);
    // Blob content must stay inside the test temp dir; LAN exposure off by default.
    process.env.ZCLAUDIA_DATA_DIR = temp;
    delete process.env.SERVER_HOST;
    delete process.env.ZCLAUDIA_ALLOW_LAN;
    db = new Database(':memory:');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, working_directory TEXT);
      INSERT INTO projects VALUES ('pa', '${rootA}'), ('pb', '${rootB}');
      INSERT INTO sessions VALUES ('sa', 'pa', NULL), ('sb', 'pb', NULL), ('sw', 'pa', '${rootB}');`);
    db.exec(migration050.sql);
    db.exec(migration052.sql);
    app = express();
    app.use(express.json({ limit: '3mb' }));
    app.use('/api/design', createDesignRoutes(db));
  });

  afterEach(async () => {
    db.close();
    delete process.env.ZCLAUDIA_DATA_DIR;
    await rm(temp, { recursive: true, force: true });
  });

  async function seedSite(): Promise<void> {
    await mkdir(path.join(rootA, 'assets'), { recursive: true });
    await mkdir(path.join(rootA, 'pages'), { recursive: true });
    await writeFile(
      path.join(rootA, 'index.html'),
      '<html><head><link rel="stylesheet" href="assets/site.css"></head><body><p>v1</p></body></html>'
    );
    await writeFile(path.join(rootA, 'assets', 'site.css'), 'p { color: red; }');
    await writeFile(
      path.join(rootA, 'pages', 'about.html'),
      '<html><body><p>about</p></body></html>'
    );
  }

  /** 经真实快照路由（真实 SnapshotService）建快照，返回 snapshotId。 */
  async function captureSnapshot(sessionId: string, entryPath: string): Promise<string> {
    const captured = await request(app)
      .post('/api/design/snapshots')
      .send({ sessionId, path: entryPath, label: 'v1' });
    expect(captured.status).toBe(200);
    return captured.body.data.id as string;
  }

  async function createShare(input: {
    sessionId?: string;
    snapshotId: string;
    scope?: string;
    expiresInDays?: number | null;
    title?: string;
  }): Promise<request.Response> {
    return request(app)
      .post('/api/design/shares')
      .send({ sessionId: 'sa', ...input });
  }

  /** 直插 design_share_comments（评论内容已由 S1 服务测试覆盖，这里只造数）。 */
  function insertComment(
    shareId: string,
    body: string,
    options?: { target?: unknown; createdAtOffsetMs?: number }
  ): string {
    const id = `sc-test-${++commentSeq}`;
    db.prepare(
      `INSERT INTO design_share_comments (id, share_id, author, body, target_json, created_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`
    ).run(
      id,
      shareId,
      'Reviewer',
      body,
      options?.target === undefined ? null : JSON.stringify(options.target),
      Date.now() + (options?.createdAtOffsetMs ?? 0)
    );
    return id;
  }

  it('creates a share with the request host URL, trimmed title and default 7-day expiry', async () => {
    await seedSite();
    const snapshotId = await captureSnapshot('sa', 'index.html');
    const before = Date.now();
    const created = await request(app)
      .post('/api/design/shares')
      .set('Host', 'design.test:4310')
      .send({ sessionId: 'sa', snapshotId, expiresInDays: 7, title: '  Alpha landing  ' });
    const after = Date.now();
    expect(created.status).toBe(201);
    expect(created.body.success).toBe(true);

    const { share, shareUrl, lanUrls } = created.body.data;
    expect(share).toMatchObject({
      snapshotId,
      entryPath: 'index.html',
      title: 'Alpha landing',
      scope: 'link',
      revokedAt: null,
      commentCount: 0,
      lastAccessAt: null,
    });
    expect(share.id).toMatch(/^sh/);
    // token = base64url(32 字节) = 43 字符。
    expect(share.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // shareUrl 按请求 host 拼绝对地址。
    expect(shareUrl).toBe(`http://design.test:4310/s/${share.token}`);
    // SERVER_HOST / ZCLAUDIA_ALLOW_LAN 均未设 → 无局域网地址。
    expect(lanUrls).toEqual([]);

    expect(share.createdAt).toBeGreaterThanOrEqual(before);
    expect(share.createdAt).toBeLessThanOrEqual(after);
    const span = (share.expiresAt as number) - share.createdAt;
    expect(span).toBeGreaterThanOrEqual(7 * DAY_MS);
    expect(span).toBeLessThan(7 * DAY_MS + 10);
  });

  it('validates create inputs and maps unknown or foreign snapshots to 404', async () => {
    await seedSite();
    const snapshotId = await captureSnapshot('sa', 'index.html');

    for (const bad of [
      { scope: 'world' },
      { expiresInDays: 0 },
      { expiresInDays: 366 },
      { title: 'x'.repeat(121) },
    ]) {
      const invalid = await createShare({ snapshotId, ...bad });
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe('SHARE_VALIDATION');
    }

    const missing = await createShare({ snapshotId: 'snap-absent' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('SNAPSHOT_NOT_FOUND');

    await writeFile(path.join(rootB, 'index.html'), '<html><body><p>B</p></body></html>');
    const foreignSnapshotId = await captureSnapshot('sb', 'index.html');
    const foreign = await createShare({ snapshotId: foreignSnapshotId });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('SNAPSHOT_NOT_FOUND');
  });

  it('lists shares newest first, filters by entryPath and isolates per workspace', async () => {
    await seedSite();
    const homeSnapshot = await captureSnapshot('sa', 'index.html');
    const aboutSnapshot = await captureSnapshot('sa', 'pages/about.html');
    const home = (await createShare({ snapshotId: homeSnapshot })).body.data.share;
    const about = (await createShare({ snapshotId: aboutSnapshot })).body.data.share;

    const all = await request(app).get('/api/design/shares').query({ sessionId: 'sa' });
    expect(all.status).toBe(200);
    expect(all.body.data.shares.map((entry: { id: string }) => entry.id)).toEqual([
      about.id,
      home.id,
    ]);

    const filtered = await request(app)
      .get('/api/design/shares')
      .query({ sessionId: 'sa', entryPath: 'pages/about.html' });
    expect(filtered.body.data.shares.map((entry: { id: string }) => entry.id)).toEqual([about.id]);

    const other = await request(app).get('/api/design/shares').query({ sessionId: 'sb' });
    expect(other.body.data.shares).toEqual([]);
  });

  it('revokes once, rejects repeats with 409 and cross-workspace owners with 404', async () => {
    await seedSite();
    const snapshotId = await captureSnapshot('sa', 'index.html');
    const share = (await createShare({ snapshotId })).body.data.share;

    const revoked = await request(app)
      .post(`/api/design/shares/${share.id}/revoke`)
      .send({ sessionId: 'sa' });
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.share.revokedAt).not.toBeNull();

    const repeat = await request(app)
      .post(`/api/design/shares/${share.id}/revoke`)
      .send({ sessionId: 'sa' });
    expect(repeat.status).toBe(409);
    expect(repeat.body.error.code).toBe('SHARE_ALREADY_REVOKED');

    // sw 与 sa 同项目但工作目录指向 rootB → 跨工作区 404。
    const cross = await request(app)
      .post(`/api/design/shares/${share.id}/revoke`)
      .send({ sessionId: 'sw' });
    expect(cross.status).toBe(404);
    expect(cross.body.error.code).toBe('SHARE_NOT_FOUND');

    const unknown = await request(app)
      .post('/api/design/shares/sh-absent/revoke')
      .send({ sessionId: 'sa' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('SHARE_NOT_FOUND');
  });

  it('lists comments ascending with parsed targets and resolves idempotently', async () => {
    await seedSite();
    const snapshotId = await captureSnapshot('sa', 'index.html');
    const share = (await createShare({ snapshotId })).body.data.share;
    const firstId = insertComment(share.id, '整页意见', { createdAtOffsetMs: -2000 });
    const secondId = insertComment(share.id, '这个标题字号偏大', {
      createdAtOffsetMs: -1000,
      target: { elementPath: [0, 1], tagName: 'p', text: 'v1' },
    });
    const thirdId = insertComment(share.id, '按钮颜色再亮一点');

    const listed = await request(app)
      .get(`/api/design/shares/${share.id}/comments`)
      .query({ sessionId: 'sa' });
    expect(listed.status).toBe(200);
    expect(listed.body.data.comments.map((comment: { id: string }) => comment.id)).toEqual([
      firstId,
      secondId,
      thirdId,
    ]);
    expect(listed.body.data.comments[0].target).toBeNull();
    expect(listed.body.data.comments[0].resolvedAt).toBeNull();
    expect(listed.body.data.comments[1].target).toEqual({
      elementPath: [0, 1],
      tagName: 'p',
      text: 'v1',
    });

    const resolved = await request(app)
      .post(`/api/design/shares/${share.id}/comments/${firstId}/resolve`)
      .send({ sessionId: 'sa', resolved: true });
    expect(resolved.status).toBe(200);
    const resolvedAt: number = resolved.body.data.comment.resolvedAt;
    expect(resolvedAt).not.toBeNull();

    // 幂等：重复置 true 返回同一 resolvedAt，不重写时间戳。
    const again = await request(app)
      .post(`/api/design/shares/${share.id}/comments/${firstId}/resolve`)
      .send({ sessionId: 'sa', resolved: true });
    expect(again.status).toBe(200);
    expect(again.body.data.comment.resolvedAt).toBe(resolvedAt);

    const unresolved = await request(app)
      .post(`/api/design/shares/${share.id}/comments/${firstId}/resolve`)
      .send({ sessionId: 'sa', resolved: false });
    expect(unresolved.status).toBe(200);
    expect(unresolved.body.data.comment.resolvedAt).toBeNull();

    const unknownComment = await request(app)
      .post(`/api/design/shares/${share.id}/comments/sc-absent/resolve`)
      .send({ sessionId: 'sa', resolved: true });
    expect(unknownComment.status).toBe(404);
    expect(unknownComment.body.error.code).toBe('SHARE_COMMENT_NOT_FOUND');
  });

  it('omits lanUrls when LAN exposure is not enabled', async () => {
    await seedSite();
    const snapshotId = await captureSnapshot('sa', 'index.html');
    const created = await createShare({ snapshotId });
    expect(created.status).toBe(201);
    expect(created.body.data.lanUrls).toEqual([]);
    // 缺省 expiresInDays → 永不过期。
    expect(created.body.data.share.expiresAt).toBeNull();
  });
});
