import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { DesignError } from '../design-service.js';
import { EXPORT_MANIFEST_NAME, ExportService } from '../export-service.js';

const sha256 = (source: string | Buffer): string => createHash('sha256').update(source).digest('hex');

describe('ExportService', () => {
  let db: Database.Database;
  let temp: string;
  let rootA: string;
  let exporter: ExportService;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'design-export-'));
    rootA = path.join(temp, 'a');
    await mkdir(rootA);
    db = new Database(':memory:');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, working_directory TEXT);
      INSERT INTO projects VALUES ('pa', '${rootA}');
      INSERT INTO sessions VALUES ('sa', 'pa', NULL);`);
    exporter = new ExportService(db);
  });

  afterEach(async () => {
    db.close();
    await rm(temp, { recursive: true, force: true });
  });

  async function seedSite(): Promise<{ html: string; css: string }> {
    await mkdir(path.join(rootA, 'assets'), { recursive: true });
    const html = [
      '<!doctype html><html><head>',
      '<link rel="stylesheet" href="assets/site.css">',
      '</head><body>',
      '<img src="assets/bg.png">',
      '<p>hello</p></body></html>',
    ].join('\n');
    const css = 'body { background: url("bg.png"); }';
    await writeFile(path.join(rootA, 'index.html'), html);
    await writeFile(path.join(rootA, 'assets', 'site.css'), css);
    await writeFile(path.join(rootA, 'assets', 'bg.png'), Buffer.from([1, 2, 3, 4]));
    return { html, css };
  }

  it('packages the workspace at relative paths with a faithful manifest', async () => {
    const { html, css } = await seedSite();
    const result = await exporter.exportZip({
      sessionId: 'sa',
      path: 'index.html',
      mode: 'disk',
      expectedRevision: sha256(html),
    });
    expect(result.filename).toMatch(/^index-\d{8}-\d{6}\.zip$/);
    expect(result.buffer.length).toBeGreaterThan(0);

    const zip = await JSZip.loadAsync(result.buffer);
    expect(await zip.file('index.html')?.async('nodebuffer')).toEqual(Buffer.from(html));
    expect(await zip.file('assets/site.css')?.async('string')).toBe(css);
    expect(await zip.file('assets/bg.png')?.async('nodebuffer')).toEqual(Buffer.from([1, 2, 3, 4]));

    expect(result.manifest.mode).toBe('disk');
    expect(result.manifest.entryPath).toBe('index.html');
    expect(typeof result.manifest.exportedAt).toBe('number');
    expect(new Map(result.manifest.files.map(file => [file.path, file]))).toEqual(
      new Map(
        [
          { path: 'index.html', sha256: sha256(html), bytes: Buffer.byteLength(html), kind: 'entry' },
          { path: 'assets/site.css', sha256: sha256(css), bytes: Buffer.byteLength(css), kind: 'css' },
          { path: 'assets/bg.png', sha256: sha256(Buffer.from([1, 2, 3, 4])), bytes: 4, kind: 'image' },
        ].map(file => [file.path, file])
      )
    );
    expect(result.manifest.missing).toEqual([]);
    expect(result.manifest.skipped).toEqual([]);

    // The embedded manifest matches the returned one and every local reference
    // in the entry resolves inside the archive (offline-openable).
    const embedded = JSON.parse((await zip.file(EXPORT_MANIFEST_NAME)?.async('string')) ?? 'null');
    expect(embedded).toEqual(result.manifest);
    expect(zip.file('assets/site.css')).toBeTruthy();
    expect(zip.file('assets/bg.png')).toBeTruthy();
  });

  it('exports draft bytes as the entry without touching the disk revision', async () => {
    await seedSite();
    const draft = '<html><body><p>unsaved draft</p><img src="assets/bg.png"></body></html>';
    const result = await exporter.exportZip({
      sessionId: 'sa',
      path: 'index.html',
      mode: 'draft',
      draftSource: draft,
    });

    const zip = await JSZip.loadAsync(result.buffer);
    expect(await zip.file('index.html')?.async('string')).toBe(draft);
    expect(result.manifest.mode).toBe('draft');
    expect(result.manifest.files.find(file => file.kind === 'entry')).toMatchObject({
      path: 'index.html',
      sha256: sha256(draft),
      bytes: Buffer.byteLength(draft),
    });
    // Resources are still discovered from the draft source.
    expect(zip.file('assets/bg.png')).toBeTruthy();
  });

  it('rejects missing resources with EXPORT_INCOMPLETE listing the files unless confirmed', async () => {
    await seedSite();
    const html = '<html><body><img src="gone.png"><img src="also-gone.png"></body></html>';
    await writeFile(path.join(rootA, 'index.html'), html);

    const failure = (await exporter
      .exportZip({ sessionId: 'sa', path: 'index.html', mode: 'disk' })
      .catch((error: unknown) => error)) as DesignError;
    expect(failure).toBeInstanceOf(DesignError);
    expect(failure.status).toBe(409);
    expect(failure.code).toBe('EXPORT_INCOMPLETE');
    expect(failure.details).toEqual({ files: ['gone.png', 'also-gone.png'] });

    const confirmed = await exporter.exportZip({
      sessionId: 'sa',
      path: 'index.html',
      mode: 'disk',
      confirmIncomplete: true,
    });
    const zip = await JSZip.loadAsync(confirmed.buffer);
    expect(zip.file('gone.png')).toBeNull();
    expect(zip.file('also-gone.png')).toBeNull();
    expect(confirmed.manifest.missing).toEqual(['gone.png', 'also-gone.png']);
    expect(await zip.file('index.html')?.async('string')).toBe(html);
  });

  it('rejects stale disk revisions with REVISION_CONFLICT', async () => {
    await seedSite();
    await expect(
      exporter.exportZip({
        sessionId: 'sa',
        path: 'index.html',
        mode: 'disk',
        expectedRevision: sha256('<p>stale</p>'),
      })
    ).rejects.toMatchObject({ status: 409, code: 'REVISION_CONFLICT' });
  });

  it('enforces reference and per-file size limits with EXPORT_LIMIT_EXCEEDED', async () => {
    const images = Array.from({ length: 201 }, (_, i) => `<img src="r${i}.png">`).join('\n');
    await writeFile(path.join(rootA, 'index.html'), images);
    await expect(
      exporter.exportZip({ sessionId: 'sa', path: 'index.html', mode: 'disk' })
    ).rejects.toMatchObject({ status: 413, code: 'EXPORT_LIMIT_EXCEEDED' });

    await writeFile(path.join(rootA, 'index.html'), '<img src="big.png">');
    await writeFile(path.join(rootA, 'big.png'), Buffer.alloc(10 * 1024 * 1024 + 1, 65));
    await expect(
      exporter.exportZip({ sessionId: 'sa', path: 'index.html', mode: 'disk' })
    ).rejects.toMatchObject({ status: 413, code: 'EXPORT_LIMIT_EXCEEDED' });
  });

  it('bounds draft sources and requires them in draft mode', async () => {
    await seedSite();
    await expect(
      exporter.exportZip({
        sessionId: 'sa',
        path: 'index.html',
        mode: 'draft',
        draftSource: 'x'.repeat(2 * 1024 * 1024 + 1),
      })
    ).rejects.toMatchObject({ status: 413, code: 'EXPORT_LIMIT_EXCEEDED' });
    await expect(
      exporter.exportZip({ sessionId: 'sa', path: 'index.html', mode: 'draft' })
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    await expect(
      exporter.exportZip({ sessionId: 'sa', path: 'index.html', mode: 'verbose' as unknown as 'disk' })
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it('skips external references while packaging local ones', async () => {
    await seedSite();
    await writeFile(
      path.join(rootA, 'index.html'),
      [
        '<html><head>',
        '<link rel="stylesheet" href="https://cdn.example.com/x.css">',
        '</head><body>',
        '<img src="/absolute.png">',
        '<img src="../escape.png">',
        '<p>x</p></body></html>',
      ].join('\n')
    );
    const result = await exporter.exportZip({
      sessionId: 'sa',
      path: 'index.html',
      mode: 'disk',
    });
    expect(result.manifest.missing).toEqual([]);
    expect(result.manifest.skipped.map(skip => skip.reason).sort()).toEqual([
      'absolute-path',
      'escapes-workspace',
      'external-url',
    ]);
    const zip = await JSZip.loadAsync(result.buffer);
    expect(zip.file('assets/site.css')).toBeNull();
    const names = Object.keys(zip.files)
      .filter(name => !name.endsWith('/'))
      .sort();
    // The overwritten entry no longer references the seeded assets: the zip
    // carries exactly the entry and the manifest.
    expect(names).toEqual(['index.html', EXPORT_MANIFEST_NAME]);
  });

  it('sanitizes the entry basename for the archive filename', async () => {
    await seedSite();
    await writeFile(path.join(rootA, 'my page!.html'), '<p>x</p>');
    const result = await exporter.exportZip({
      sessionId: 'sa',
      path: 'my page!.html',
      mode: 'disk',
    });
    expect(result.filename).toMatch(/^my_page_-\d{8}-\d{6}\.zip$/);
  });

  it('packages referenced videos with kind video in the manifest (§5.3)', async () => {
    const html = '<html><body><video src="assets/demo.mp4" controls></video></body></html>';
    await writeFile(path.join(rootA, 'index.html'), html);
    await mkdir(path.join(rootA, 'assets'), { recursive: true });
    await writeFile(path.join(rootA, 'assets', 'demo.mp4'), Buffer.from([9, 9, 9, 9]));
    const result = await exporter.exportZip({
      sessionId: 'sa',
      path: 'index.html',
      mode: 'disk',
    });
    expect(result.manifest.missing).toEqual([]);
    const entry = result.manifest.files.find(file => file.path === 'assets/demo.mp4');
    expect(entry).toMatchObject({
      kind: 'video',
      sha256: sha256(Buffer.from([9, 9, 9, 9])),
      bytes: 4,
    });
    const zip = await JSZip.loadAsync(result.buffer);
    expect(await zip.file('assets/demo.mp4')?.async('nodebuffer')).toEqual(Buffer.from([9, 9, 9, 9]));
  });
});
