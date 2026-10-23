import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDesignRoutes } from '../design.js';
import { migration as migration050 } from '../../../infra/storage/migrations/050_design_snapshots.js';

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

    const bogus = await request(app)
      .get('/api/design/assets')
      .query({ sessionId: 'sa', kinds: 'video' });
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
