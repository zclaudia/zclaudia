import Database from 'better-sqlite3';
import { mkdtemp, mkdir, readFile, realpath, rm, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BlobStore } from '../../../infra/design/blob-store.js';
import { migration as migration050 } from '../../../infra/storage/migrations/050_design_snapshots.js';
import { migration as migration052 } from '../../../infra/storage/migrations/052_design_shares.js';
import { DesignError } from '../design-service.js';
import { RestoreService } from '../restore-service.js';
import { MAX_SNAPSHOTS_PER_WORKSPACE, SnapshotService, sha256 } from '../snapshot-service.js';

const INDEX_HTML = [
  '<!doctype html>',
  '<html><head>',
  '<link rel="stylesheet" href="assets/site.css">',
  '</head><body>',
  '<img src="assets/bg.png">',
  '<img srcset="assets/a.png 1x, assets/b.png 2x">',
  '</body></html>',
].join('\n');

const SITE_CSS = [
  "@import 'extra.css';",
  'body { background: url("bg.png"); }',
  '@font-face { font-family: X; src: url("fonts/f.woff2"); }',
].join('\n');

async function writeSite(root: string): Promise<void> {
  await mkdir(path.join(root, 'assets', 'fonts'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), INDEX_HTML);
  await writeFile(path.join(root, 'assets', 'site.css'), SITE_CSS);
  await writeFile(path.join(root, 'assets', 'extra.css'), '.extra { color: red; }');
  await writeFile(path.join(root, 'assets', 'bg.png'), Buffer.from([1, 2, 3, 4]));
  await writeFile(path.join(root, 'assets', 'a.png'), Buffer.from([5, 6]));
  await writeFile(path.join(root, 'assets', 'b.png'), Buffer.from([7, 8, 9]));
  await writeFile(path.join(root, 'assets', 'fonts', 'f.woff2'), Buffer.from([10, 11, 12]));
}

describe('SnapshotService', () => {
  let db: Database.Database;
  let temp: string;
  let rootA: string;
  let rootB: string;
  let blobs: BlobStore;
  let snapshots: SnapshotService;
  let restores: RestoreService;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'design-snapshot-'));
    rootA = path.join(temp, 'a');
    rootB = path.join(temp, 'b');
    await mkdir(rootA);
    await mkdir(rootB);
    db = new Database(':memory:');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, working_directory TEXT);
      INSERT INTO projects VALUES ('pa', '${rootA}'), ('pb', '${rootB}');
      INSERT INTO sessions VALUES ('sa', 'pa', NULL), ('sa2', 'pa', NULL), ('sb', 'pb', NULL);`);
    db.exec(migration050.sql);
    db.exec(migration052.sql); // design_shares: pruneOldest pins snapshots with unrevoked shares
    blobs = new BlobStore(path.join(temp, 'blobs-root'));
    snapshots = new SnapshotService(db, blobs);
    restores = new RestoreService(db, blobs, snapshots);
  });

  afterEach(async () => {
    db.close();
    await rm(temp, { recursive: true, force: true });
  });

  it('captures an html+css+binary site, serves manifest files back byte-for-byte', async () => {
    await writeSite(rootA);
    const summary = await snapshots.capture('sa', 'index.html', 'first version');
    expect(summary.complete).toBe(true);
    expect(summary.incompleteReasons).toEqual([]);
    expect(summary.label).toBe('first version');
    expect(summary.source).toBe('manual');
    expect(summary.entryPath).toBe('index.html');
    // entry + site.css + extra.css + bg.png + a.png + b.png + f.woff2
    expect(summary.fileCount).toBe(7);
    expect(summary.totalBytes).toBe(
      Buffer.byteLength(INDEX_HTML) +
        Buffer.byteLength(SITE_CSS) +
        Buffer.byteLength('.extra { color: red; }') +
        4 +
        2 +
        3 +
        3
    );

    const detail = await snapshots.detail('sa', summary.id);
    const kinds = new Map(detail.files.map(file => [file.path, file.kind]));
    expect(kinds.get('index.html')).toBe('entry');
    expect(kinds.get('assets/site.css')).toBe('css');
    expect(kinds.get('assets/fonts/f.woff2')).toBe('font');
    expect(kinds.get('assets/bg.png')).toBe('image');

    const served = await snapshots.readFile('sa', summary.id, 'assets/bg.png');
    expect(served.mime).toBe('image/png');
    expect(Buffer.from(served.data, 'base64')).toEqual(Buffer.from([1, 2, 3, 4]));

    const listed = await snapshots.list('sa', 'index.html');
    expect(listed.map(entry => entry.id)).toEqual([summary.id]);
  });

  it('dedupes identical consecutive captures and records changes as new snapshots', async () => {
    await writeSite(rootA);
    const first = await snapshots.capture('sa', 'index.html');
    const second = await snapshots.capture('sa', 'index.html');
    expect(second.id).toBe(first.id);
    await writeFile(path.join(rootA, 'assets', 'site.css'), 'body { color: black; }');
    const third = await snapshots.capture('sa', 'index.html');
    expect(third.id).not.toBe(first.id);
    const listed = await snapshots.list('sa', 'index.html');
    expect(listed.map(entry => entry.id)).toEqual([third.id, first.id]);
  });

  it('shares one history across sessions of the same workspace and isolates others', async () => {
    await writeSite(rootA);
    const captured = await snapshots.capture('sa', 'index.html');
    const fromSa = await snapshots.list('sa', 'index.html');
    const fromSa2 = await snapshots.list('sa2', 'index.html');
    expect(fromSa2).toEqual(fromSa);
    expect(await snapshots.list('sb', 'index.html')).toEqual([]);

    await expect(snapshots.detail('sb', captured.id)).rejects.toMatchObject({
      status: 409,
      code: 'WORKSPACE_MISMATCH',
    });
    await expect(
      restores.restore('sb', captured.id, {})
    ).rejects.toMatchObject({ status: 409, code: 'WORKSPACE_MISMATCH' });
  });

  it('marks snapshots with missing referenced resources incomplete, naming the path', async () => {
    await writeFile(
      path.join(rootA, 'index.html'),
      '<html><body><img src="missing.png"></body></html>'
    );
    const summary = await snapshots.capture('sa', 'index.html');
    expect(summary.complete).toBe(false);
    expect(summary.incompleteReasons.some(reason => reason.includes('missing.png'))).toBe(true);
  });

  it('treats non-local references as skipped resources, not failures', async () => {
    await writeFile(
      path.join(rootA, 'index.html'),
      [
        '<html><head>',
        '<link rel="stylesheet" href="https://cdn.example.com/x.css">',
        '</head><body>',
        '<img src="data:image/png;base64,AAA">',
        '<img src="/absolute.png">',
        '<img src="../escape.png">',
        '</body></html>',
      ].join('\n')
    );
    const summary = await snapshots.capture('sa', 'index.html');
    expect(summary.complete).toBe(true);
    expect(summary.fileCount).toBe(1); // only the entry itself
  });

  it('flags oversized single resources as incomplete', async () => {
    await writeFile(path.join(rootA, 'index.html'), '<img src="big.png">');
    await writeFile(path.join(rootA, 'big.png'), Buffer.alloc(10 * 1024 * 1024 + 1, 65));
    const summary = await snapshots.capture('sa', 'index.html');
    expect(summary.complete).toBe(false);
    expect(summary.incompleteReasons.some(reason => reason.includes('big.png'))).toBe(true);
  });

  it('captures a small referenced video with kind video and its mime (§5.3)', async () => {
    await writeFile(
      path.join(rootA, 'index.html'),
      '<html><body><video src="media/clip.mp4" controls></video></body></html>'
    );
    await mkdir(path.join(rootA, 'media'));
    await writeFile(path.join(rootA, 'media', 'clip.mp4'), Buffer.from([1, 2, 3, 4]));
    const summary = await snapshots.capture('sa', 'index.html');
    expect(summary.complete).toBe(true);
    const detail = await snapshots.detail('sa', summary.id);
    const clip = detail.files.find(file => file.path === 'media/clip.mp4');
    expect(clip).toMatchObject({ kind: 'video', mime: 'video/mp4', bytes: 4 });
  });

  it('marks a >10 MiB video incomplete (sparse file) without claiming a full snapshot', async () => {
    await writeFile(
      path.join(rootA, 'index.html'),
      '<html><body><video src="media/big.mp4" controls></video></body></html>'
    );
    await mkdir(path.join(rootA, 'media'));
    // Sparse file: stat.size exceeds the 10 MiB capture cap without real bytes.
    await writeFile(path.join(rootA, 'media', 'big.mp4'), '');
    await truncate(path.join(rootA, 'media', 'big.mp4'), 10 * 1024 * 1024 + 1);
    const summary = await snapshots.capture('sa', 'index.html');
    expect(summary.complete).toBe(false);
    expect(summary.incompleteReasons.some(reason => reason.includes('media/big.mp4'))).toBe(true);
    const detail = await snapshots.detail('sa', summary.id);
    expect(detail.files.map(file => file.path)).toEqual(['index.html']);
  });

  it('stops at the resource reference limit with an explicit reason', async () => {
    const images = Array.from({ length: 205 }, (_, i) => `<img src="r${i}.png">`).join('\n');
    await writeFile(path.join(rootA, 'index.html'), images);
    for (let i = 0; i < 205; i++) {
      await writeFile(path.join(rootA, `r${i}.png`), Buffer.from([i % 256]));
    }
    const summary = await snapshots.capture('sa', 'index.html');
    expect(summary.complete).toBe(false);
    expect(summary.incompleteReasons.some(reason => reason.startsWith('resource-limit'))).toBe(
      true
    );
    expect(summary.fileCount).toBeLessThanOrEqual(1 + 200);
  });

  it('follows css imports up to depth 4 and reports deeper ones', async () => {
    await writeFile(
      path.join(rootA, 'index.html'),
      '<link rel="stylesheet" href="css0.css">'
    );
    for (let i = 0; i < 6; i++) {
      await writeFile(path.join(rootA, `css${i}.css`), `@import "css${i + 1}.css";`);
    }
    const summary = await snapshots.capture('sa', 'index.html');
    expect(summary.complete).toBe(false);
    expect(summary.incompleteReasons).toContain('css4.css: css import depth limit exceeded');
    const detail = await snapshots.detail('sa', summary.id);
    const paths = detail.files.map(file => file.path).sort();
    expect(paths).toEqual(['css0.css', 'css1.css', 'css2.css', 'css3.css', 'index.html']);
  });

  it('prunes beyond the per-workspace limit and sweeps unreferenced blobs', async () => {
    await writeSite(rootA);
    // The service stores snapshots under the resolved (realpath) workspace root.
    const storedRoot = await realpath(rootA);
    const junkSha = await blobs.writeBlob(Buffer.from('junk'));
    const insertSnapshot = db.prepare(
      `INSERT INTO design_snapshots (id, workspace_root, session_id, entry_path, label, source, run_id, complete, incomplete_reasons, file_count, total_bytes, created_at)
       VALUES (?, ?, NULL, 'index.html', NULL, 'manual', NULL, 1, '[]', 1, 4, ?)`
    );
    const insertFile = db.prepare(
      `INSERT INTO design_snapshot_files (snapshot_id, path, sha256, bytes, kind, mime)
       VALUES (?, 'index.html', ?, 4, 'entry', 'text/html')`
    );
    for (let i = 1; i <= MAX_SNAPSHOTS_PER_WORKSPACE; i++) {
      insertSnapshot.run(`seed-${i}`, storedRoot, i);
      insertFile.run(`seed-${i}`, junkSha);
    }
    const straySha = await blobs.writeBlob(Buffer.from('stray-unreferenced-content'));
    expect(await blobs.hasBlob(straySha)).toBe(true);

    const captured = await snapshots.capture('sa', 'index.html', null, 'save');

    const count = db
      .prepare('SELECT COUNT(*) AS count FROM design_snapshots WHERE workspace_root = ?')
      .get(storedRoot) as { count: number };
    expect(count.count).toBe(MAX_SNAPSHOTS_PER_WORKSPACE);
    const ids = db
      .prepare('SELECT id FROM design_snapshots WHERE workspace_root = ?')
      .all(storedRoot) as Array<{ id: string }>;
    expect(ids.some(row => row.id === 'seed-1')).toBe(false);
    expect(ids.some(row => row.id === `seed-${MAX_SNAPSHOTS_PER_WORKSPACE}`)).toBe(true);
    expect(ids.some(row => row.id === captured.id)).toBe(true);
    // The junk blob is still referenced by surviving seeds; the stray one is gone.
    expect(await blobs.hasBlob(junkSha)).toBe(true);
    expect(await blobs.hasBlob(straySha)).toBe(false);
    expect(captured.source).toBe('save');
  });

  // —— P7 §3 snapshot pin：存在未撤销分享的快照永不进入裁剪候选 ——

  /**
   * Batch-seed minimal valid snapshot+file rows straight into the db: pruning
   * only reads manifests, never blob content, so the fake blob need not exist.
   */
  function seedSnapshotRows(
    prefix: string,
    storedRoot: string,
    from: number,
    to: number,
    baseCreatedAt = 0
  ): void {
    const insertSnapshot = db.prepare(
      `INSERT INTO design_snapshots (id, workspace_root, session_id, entry_path, label, source, run_id, complete, incomplete_reasons, file_count, total_bytes, created_at)
       VALUES (?, ?, 'sa', 'index.html', NULL, 'save', NULL, 1, '[]', 1, 4, ?)`
    );
    const insertFile = db.prepare(
      `INSERT INTO design_snapshot_files (snapshot_id, path, sha256, bytes, kind, mime)
       VALUES (?, 'index.html', ?, 4, 'entry', 'text/html')`
    );
    const fakeSha = 'ab'.repeat(32); // any valid 64-hex; never read as a blob
    for (let i = from; i <= to; i++) {
      insertSnapshot.run(`${prefix}-${i}`, storedRoot, baseCreatedAt + i);
      insertFile.run(`${prefix}-${i}`, fakeSha);
    }
  }

  function pinWithShare(shareId: string, storedRoot: string, snapshotId: string): void {
    db.prepare(
      `INSERT INTO design_shares (id, workspace_root, session_id, snapshot_id, token, title, scope, created_at)
       VALUES (?, ?, 'sa', ?, ?, NULL, 'link', ?)`
    ).run(shareId, storedRoot, snapshotId, `tok-${shareId}`, Date.now());
  }

  function snapshotIds(storedRoot: string): string[] {
    return (
      db.prepare('SELECT id FROM design_snapshots WHERE workspace_root = ?').all(storedRoot) as Array<{
        id: string;
      }>
    ).map(row => row.id);
  }

  function fileRowCount(snapshotId: string): number {
    return (
      db.prepare('SELECT COUNT(*) AS count FROM design_snapshot_files WHERE snapshot_id = ?').get(
        snapshotId
      ) as { count: number }
    ).count;
  }

  it('never prunes a snapshot pinned by an unrevoked share (P7 §3)', async () => {
    await writeSite(rootA);
    const storedRoot = await realpath(rootA);
    seedSnapshotRows('pin-seed', storedRoot, 1, MAX_SNAPSHOTS_PER_WORKSPACE + 1);
    pinWithShare('sh-pin', storedRoot, 'pin-seed-1'); // pins the oldest row

    const captured = await snapshots.capture('sa', 'index.html', null, 'save');

    // The pinned row and its file row survive although it is the oldest...
    expect(snapshotIds(storedRoot).some(id => id === 'pin-seed-1')).toBe(true);
    expect(fileRowCount('pin-seed-1')).toBe(1);
    // ...while the quota still trims the oldest unpinned row: 502 rows
    // (501 seeds + capture) minus the pinned one leave exactly one excess.
    const ids = snapshotIds(storedRoot);
    expect(ids).toHaveLength(MAX_SNAPSHOTS_PER_WORKSPACE + 1);
    expect(ids.some(id => id === 'pin-seed-2')).toBe(false);
    expect(fileRowCount('pin-seed-2')).toBe(0);
    expect(ids.some(id => id === `pin-seed-${MAX_SNAPSHOTS_PER_WORKSPACE + 1}`)).toBe(true);
    expect(ids.some(id => id === captured.id)).toBe(true);
  });

  it('prunes a formerly pinned snapshot once its share is revoked (P7 §3)', async () => {
    await writeSite(rootA);
    const storedRoot = await realpath(rootA);
    seedSnapshotRows('rev-seed', storedRoot, 1, MAX_SNAPSHOTS_PER_WORKSPACE);
    pinWithShare('sh-rev', storedRoot, 'rev-seed-1'); // pins the oldest row

    // At the quota with the pin held: the capture leaves the oldest row alone.
    const first = await snapshots.capture('sa', 'index.html', 'protected', 'save');
    expect(snapshotIds(storedRoot).some(id => id === 'rev-seed-1')).toBe(true);

    // Revocation lifts the pin; the next prune deletes the now-oldest rows.
    db.prepare('UPDATE design_shares SET revoked_at = ? WHERE id = ?').run(Date.now(), 'sh-rev');
    await writeFile(path.join(rootA, 'assets', 'site.css'), 'body { color: black; }');
    const second = await snapshots.capture('sa', 'index.html', 'unprotected', 'save');

    const ids = snapshotIds(storedRoot);
    expect(ids.some(id => id === 'rev-seed-1')).toBe(false);
    expect(fileRowCount('rev-seed-1')).toBe(0);
    expect(ids.some(id => id === 'rev-seed-3')).toBe(true);
    expect(ids.some(id => id === first.id)).toBe(true);
    expect(ids.some(id => id === second.id)).toBe(true);
    expect(ids).toHaveLength(MAX_SNAPSHOTS_PER_WORKSPACE);
  });

  it('keeps a pinned snapshot out of the blob sweep, so its blobs stay readable (P7 §3)', async () => {
    await writeSite(rootA);
    const storedRoot = await realpath(rootA);
    const pinned = await snapshots.capture('sa', 'index.html', 'pinned', 'save');
    const bg = (await snapshots.detail('sa', pinned.id)).files.find(
      file => file.path === 'assets/bg.png'
    );
    expect(bg).toBeTruthy();
    expect(await blobs.hasBlob(bg!.sha256)).toBe(true);
    pinWithShare('sh-blob', storedRoot, pinned.id);

    // Push the workspace over the quota with unpinned rows newer than the
    // pinned snapshot, then capture to trigger prune + blob sweep.
    seedSnapshotRows('sweep-seed', storedRoot, 1, MAX_SNAPSHOTS_PER_WORKSPACE, pinned.createdAt);
    await writeFile(path.join(rootA, 'assets', 'site.css'), 'body { color: black; }');
    await snapshots.capture('sa', 'index.html', 'trigger', 'save');

    // The pinned snapshot's manifest rows survive, so its blobs stay
    // referenced and survive sweepUnreferenced.
    expect(fileRowCount(pinned.id)).toBe(pinned.fileCount);
    expect(await blobs.hasBlob(bg!.sha256)).toBe(true);
    expect(await blobs.readBlob(bg!.sha256)).toEqual(Buffer.from([1, 2, 3, 4]));
    const served = await snapshots.readFile('sa', pinned.id, 'assets/bg.png');
    expect(Buffer.from(served.data, 'base64')).toEqual(Buffer.from([1, 2, 3, 4]));
  });
});

describe('RestoreService', () => {
  let db: Database.Database;
  let temp: string;
  let rootA: string;
  let blobs: BlobStore;
  let snapshots: SnapshotService;
  let restores: RestoreService;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'design-restore-'));
    rootA = path.join(temp, 'a');
    await mkdir(rootA);
    db = new Database(':memory:');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, working_directory TEXT);
      INSERT INTO projects VALUES ('pa', '${rootA}');
      INSERT INTO sessions VALUES ('sa', 'pa', NULL);`);
    db.exec(migration050.sql);
    db.exec(migration052.sql); // design_shares: pruneOldest pins snapshots with unrevoked shares
    blobs = new BlobStore(path.join(temp, 'blobs-root'));
    snapshots = new SnapshotService(db, blobs);
    restores = new RestoreService(db, blobs, snapshots);
  });

  afterEach(async () => {
    db.close();
    await rm(temp, { recursive: true, force: true });
  });

  async function diskHash(relative: string): Promise<string> {
    return sha256(await readFile(path.join(rootA, relative)));
  }

  async function captureSimpleSite(): Promise<string> {
    await mkdir(path.join(rootA, 'assets'), { recursive: true });
    await writeFile(
      path.join(rootA, 'index.html'),
      '<html><head><link rel="stylesheet" href="assets/site.css"></head><body><p>one</p></body></html>'
    );
    await writeFile(path.join(rootA, 'assets', 'site.css'), 'p { color: red; }');
    const captured = await snapshots.capture('sa', 'index.html');
    expect(captured.complete).toBe(true);
    return captured.id;
  }

  it('restores files byte-for-byte, logs success and captures a restore snapshot', async () => {
    const snapshotId = await captureSimpleSite();
    await writeFile(path.join(rootA, 'index.html'), '<html><body><p>two</p></body></html>');
    await writeFile(path.join(rootA, 'assets', 'site.css'), 'p { color: blue; }');

    const result = await restores.restore('sa', snapshotId, {
      'index.html': await diskHash('index.html'),
      'assets/site.css': await diskHash('assets/site.css'),
    });

    expect(result.restored.sort()).toEqual(['assets/site.css', 'index.html']);
    expect(await readFile(path.join(rootA, 'index.html'), 'utf8')).toContain('<p>one</p>');
    expect(await readFile(path.join(rootA, 'assets', 'site.css'), 'utf8')).toBe(
      'p { color: red; }'
    );

    const detail = await snapshots.detail('sa', result.summary.id);
    expect(detail.summary.source).toBe('restore');
    for (const file of detail.files) {
      const served = await snapshots.readFile('sa', result.summary.id, file.path);
      expect(Buffer.from(served.data, 'base64')).toEqual(
        await readFile(path.join(rootA, file.path))
      );
    }

    const log = db
      .prepare('SELECT status, report FROM design_restore_log WHERE snapshot_id = ?')
      .get(snapshotId) as { status: string; report: string };
    expect(log.status).toBe('succeeded');
    const report = JSON.parse(log.report);
    expect(report.restored.sort()).toEqual(['assets/site.css', 'index.html']);
    expect(report.failed).toEqual([]);
    expect(report.pending).toEqual([]);
  });

  it('recreates deleted files including their nested directories', async () => {
    await mkdir(path.join(rootA, 'assets', 'fonts'), { recursive: true });
    await writeFile(
      path.join(rootA, 'index.html'),
      '<html><body><img src="assets/fonts/f.woff2"></body></html>'
    );
    await writeFile(path.join(rootA, 'assets', 'fonts', 'f.woff2'), Buffer.from([1, 2, 3]));
    const captured = await snapshots.capture('sa', 'index.html');
    expect((await snapshots.detail('sa', captured.id)).files).toHaveLength(2);

    await rm(path.join(rootA, 'assets'), { recursive: true, force: true });
    const result = await restores.restore('sa', captured.id, {
      'index.html': await diskHash('index.html'),
    });

    expect(result.restored.sort()).toEqual(['assets/fonts/f.woff2', 'index.html']);
    expect(await readFile(path.join(rootA, 'assets', 'fonts', 'f.woff2'))).toEqual(
      Buffer.from([1, 2, 3])
    );
  });

  it('rejects restores when disk diverged or expectations are missing, leaving disk intact', async () => {
    const snapshotId = await captureSimpleSite();
    await writeFile(path.join(rootA, 'index.html'), '<html><body><p>two</p></body></html>');
    const staleRevision = sha256(Buffer.from('<html><body><p>one</p></body></html>'));

    const conflict = (await restores
      .restore('sa', snapshotId, {
        'index.html': staleRevision,
        'assets/site.css': await diskHash('assets/site.css'),
      })
      .catch((error: unknown) => error)) as DesignError;
    expect(conflict).toBeInstanceOf(DesignError);
    expect(conflict.status).toBe(409);
    expect(conflict.code).toBe('RESTORE_CONFLICT');
    const files = (conflict.details as { files: Array<{ path: string; reason: string }> }).files;
    expect(files).toEqual([
      {
        path: 'index.html',
        reason: 'revision-mismatch',
        expectedRevision: staleRevision,
        actualRevision: await diskHash('index.html'),
      },
    ]);
    expect(await readFile(path.join(rootA, 'index.html'), 'utf8')).toBe(
      '<html><body><p>two</p></body></html>'
    );

    const missing = (await restores
      .restore('sa', snapshotId, {})
      .catch((error: unknown) => error)) as DesignError;
    expect(missing.code).toBe('RESTORE_CONFLICT');
    const missingFiles = (missing.details as { files: Array<{ path: string; reason: string; actualRevision?: string }> })
      .files;
    expect(missingFiles).toEqual([
      {
        path: 'assets/site.css',
        reason: 'missing-expected-revision',
        actualRevision: await diskHash('assets/site.css'),
      },
      {
        path: 'index.html',
        reason: 'missing-expected-revision',
        actualRevision: await diskHash('index.html'),
      },
    ]);
    expect(
      (db.prepare('SELECT status FROM design_restore_log').all() as Array<{ status: string }>).every(
        row => row.status === 'conflict'
      )
    ).toBe(true);
  });

  it('requires explicit confirmation before restoring incomplete snapshots', async () => {
    await writeFile(
      path.join(rootA, 'index.html'),
      '<html><body><img src="missing.png"><p>v1</p></body></html>'
    );
    const captured = await snapshots.capture('sa', 'index.html');
    expect(captured.complete).toBe(false);

    await writeFile(path.join(rootA, 'index.html'), '<html><body><p>v2</p></body></html>');
    await expect(
      restores.restore('sa', captured.id, { index: 'x' })
    ).rejects.toMatchObject({ status: 409, code: 'SNAPSHOT_INCOMPLETE' });
    expect(await readFile(path.join(rootA, 'index.html'), 'utf8')).toBe(
      '<html><body><p>v2</p></body></html>'
    );

    await restores.restore(
      'sa',
      captured.id,
      { 'index.html': await diskHash('index.html') },
      true
    );
    expect(await readFile(path.join(rootA, 'index.html'), 'utf8')).toBe(
      '<html><body><img src="missing.png"><p>v1</p></body></html>'
    );
  });

  it('reports interrupted restores honestly and keeps the pre-restore snapshot', async () => {
    await writeFile(
      path.join(rootA, 'index.html'),
      '<html><body><img src="a.png"><img src="m.png"><img src="z.png"></body></html>'
    );
    await writeFile(path.join(rootA, 'a.png'), Buffer.from([1]));
    await writeFile(path.join(rootA, 'm.png'), Buffer.from([2]));
    await writeFile(path.join(rootA, 'z.png'), Buffer.from([3]));
    const captured = await snapshots.capture('sa', 'index.html');
    const detail = await snapshots.detail('sa', captured.id);
    expect(detail.files.map(file => file.path).sort()).toEqual([
      'a.png',
      'index.html',
      'm.png',
      'z.png',
    ]);

    // Renames run in manifest (path) order: a.png, index.html, m.png, z.png.
    await rm(path.join(rootA, 'm.png'));
    await mkdir(path.join(rootA, 'm.png')); // rename onto a directory must fail

    const failure = (await restores
      .restore('sa', captured.id, {
        'a.png': await diskHash('a.png'),
        'index.html': await diskHash('index.html'),
        // m.png is a directory: no revision expectation applies.
        // z.png exists and must be declared.
        'z.png': await diskHash('z.png'),
      })
      .catch((error: unknown) => error)) as DesignError;

    expect(failure).toBeInstanceOf(DesignError);
    expect(failure.status).toBe(500);
    expect(failure.code).toBe('RESTORE_FAILED');
    const report = (failure.details as { report: { restored: string[]; failed: Array<{ path: string }>; pending: string[] } })
      .report;
    expect(report.restored).toEqual(['a.png', 'index.html']);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.path).toBe('m.png');
    expect(report.pending).toEqual(['z.png']);
    expect(await readFile(path.join(rootA, 'z.png'))).toEqual(Buffer.from([3]));

    const preRestore = db
      .prepare(
        "SELECT COUNT(*) AS count FROM design_snapshots WHERE source = 'pre-restore' AND workspace_root = ?"
      )
      .get(await realpath(rootA)) as { count: number };
    expect(preRestore.count).toBeGreaterThan(0);

    const log = db
      .prepare('SELECT status, report FROM design_restore_log WHERE snapshot_id = ?')
      .get(captured.id) as { status: string; report: string };
    expect(log.status).toBe('failed');
    const loggedReport = JSON.parse(log.report);
    expect(Object.keys(loggedReport).sort()).toEqual(['failed', 'pending', 'restored']);
    expect(loggedReport.pending).toEqual(['z.png']);
  });

  it('fails cleanly when a snapshot blob is missing from the store', async () => {
    const snapshotId = await captureSimpleSite();
    const detail = await snapshots.detail('sa', snapshotId);
    const css = detail.files.find(file => file.path === 'assets/site.css');
    expect(css).toBeTruthy();
    // Remove the css from disk AND from the blob store: the pre-restore
    // capture must not be able to re-upload its content from disk.
    await rm(path.join(rootA, 'assets', 'site.css'), { force: true });
    await rm(path.join(temp, 'blobs-root', 'blobs', css!.sha256.slice(0, 2), css!.sha256), {
      force: true,
    });

    const failure = (await restores
      .restore('sa', snapshotId, { 'index.html': await diskHash('index.html') })
      .catch((error: unknown) => error)) as DesignError;
    expect(failure).toBeInstanceOf(DesignError);
    expect(failure.status).toBe(500);
    expect(failure.code).toBe('RESTORE_FAILED');
    expect(await readFile(path.join(rootA, 'index.html'), 'utf8')).toContain('<p>one</p>');
    const log = db.prepare('SELECT status, report FROM design_restore_log').get() as {
      status: string;
      report: string;
    };
    expect(log.status).toBe('failed');
    const report = JSON.parse(log.report) as {
      restored: string[];
      failed: Array<{ path: string }>;
      pending: string[];
    };
    expect(report.restored).toEqual([]);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.path).toBe('assets/site.css');
    // Staging failed on the first manifest path, so nothing was staged.
    expect(report.pending).toEqual(['assets/site.css', 'index.html']);
  });

  it('rejects unknown snapshots', async () => {
    await expect(restores.restore('sa', 'dsnope', {})).rejects.toMatchObject({
      status: 404,
      code: 'SNAPSHOT_NOT_FOUND',
    });
  });
});
