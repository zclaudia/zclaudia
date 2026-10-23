import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
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
