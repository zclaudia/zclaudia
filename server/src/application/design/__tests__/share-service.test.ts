// P7 S1 分享服务测试：真临时工作区 + 真快照（SnapshotService.capture）+ :memory: SQLite
// + migration 050/052。风格对齐 snapshot-service.test.ts / media-task-service.test.ts。

import Database from 'better-sqlite3';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BlobStore } from '../../../infra/design/blob-store.js';
import { migration as migration050 } from '../../../infra/storage/migrations/050_design_snapshots.js';
import { migration as migration052 } from '../../../infra/storage/migrations/052_design_shares.js';
import { DesignService } from '../design-service.js';
import { SnapshotService, sha256, type SnapshotSummary } from '../snapshot-service.js';
import { ShareService, type ShareAccess } from '../share-service.js';
import {
  SHARE_COMMENT_AUTHOR_MAX_LENGTH,
  SHARE_COMMENT_BODY_MAX_LENGTH,
  SHARE_COMMENTS_PER_SHARE_LIMIT,
  SHARE_ELEMENT_PATH_MAX_DEPTH,
  SHARE_ELEMENT_PATH_MAX_INDEX,
  SHARE_FILE_PATH_MAX_LENGTH,
  SHARE_LIST_LIMIT,
  SHARE_TARGET_TAG_NAME_MAX_LENGTH,
  SHARE_TARGET_TEXT_MAX_LENGTH,
  SHARE_TITLE_MAX_LENGTH,
} from '../share-types.js';

const INDEX_HTML = [
  '<!doctype html>',
  '<html><head>',
  '<link rel="stylesheet" href="assets/site.css">',
  '</head><body>',
  '<img src="assets/bg.png">',
  '<p>hello share</p>',
  '</body></html>',
].join('\n');

const SITE_CSS = 'body { background: #fff; }';
const BG_BYTES = Buffer.from([1, 2, 3, 4]);
const DAY_MS = 86_400_000;

async function writeSite(root: string): Promise<void> {
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), INDEX_HTML);
  await writeFile(path.join(root, 'assets', 'site.css'), SITE_CSS);
  await writeFile(path.join(root, 'assets', 'bg.png'), BG_BYTES);
}

describe('ShareService', () => {
  let db: Database.Database;
  let temp: string;
  let rootA: string;
  let rootB: string;
  let blobs: BlobStore;
  let snapshots: SnapshotService;
  let shares: ShareService;
  let storedRootA: string;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'design-share-'));
    rootA = path.join(temp, 'a');
    rootB = path.join(temp, 'b');
    await mkdir(rootA);
    await mkdir(rootB);
    db = new Database(':memory:');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, working_directory TEXT);
      INSERT INTO projects VALUES ('pa', '${rootA}'), ('pb', '${rootB}');
      INSERT INTO sessions VALUES ('sa', 'pa', NULL), ('sb', 'pb', NULL);`);
    db.exec(migration050.sql);
    db.exec(migration052.sql);
    blobs = new BlobStore(path.join(temp, 'blobs-root'));
    snapshots = new SnapshotService(db, blobs);
    shares = new ShareService(db, new DesignService(db), blobs);
    storedRootA = await realpath(rootA);
  });

  afterEach(async () => {
    db.close();
    await rm(temp, { recursive: true, force: true });
  });

  /** 在 rootA 建站点并从 'sa' 捕获一份完整快照。 */
  async function captureSite(entrySource: string = INDEX_HTML): Promise<SnapshotSummary> {
    await mkdir(path.join(rootA, 'assets'), { recursive: true });
    await writeFile(path.join(rootA, 'index.html'), entrySource);
    await writeFile(path.join(rootA, 'assets', 'site.css'), SITE_CSS);
    await writeFile(path.join(rootA, 'assets', 'bg.png'), BG_BYTES);
    const captured = await snapshots.capture('sa', 'index.html', 'v1');
    expect(captured.complete).toBe(true);
    return captured;
  }

  /** 捕获站点 + 建一个默认分享，返回二者。 */
  async function setupShare(
    overrides: Record<string, unknown> = {}
  ): Promise<{ snapshot: SnapshotSummary; share: Awaited<ReturnType<ShareService['create']>> }> {
    const snapshot = await captureSite();
    const share = await shares.create('sa', { snapshotId: snapshot.id, ...overrides });
    return { snapshot, share };
  }

  async function accessOf(share: { token: string }): Promise<ShareAccess> {
    return shares.resolveByToken(share.token);
  }

  describe('create', () => {
    it('creates a share with defaults and returns the full summary shape', async () => {
      const { snapshot, share } = await setupShare();
      expect(share.id).toMatch(/^sh[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(share.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(share.snapshotId).toBe(snapshot.id);
      expect(share.entryPath).toBe('index.html');
      expect(share.title).toBeNull();
      expect(share.scope).toBe('link');
      expect(share.createdAt).toBeLessThanOrEqual(Date.now());
      expect(share.expiresAt).toBeNull();
      expect(share.revokedAt).toBeNull();
      expect(share.commentCount).toBe(0);
      expect(share.lastAccessAt).toBeNull();
    });

    it('honors scope local, expiry days and trimmed non-empty titles', async () => {
      const { snapshot } = await setupShare();
      const before = Date.now();
      const share = await shares.create('sa', {
        snapshotId: snapshot.id,
        scope: 'local',
        expiresInDays: 7,
        title: '  设计评审  ',
      });
      expect(share.scope).toBe('local');
      expect(share.title).toBe('设计评审');
      expect(share.expiresAt).toBeGreaterThanOrEqual(before + 7 * DAY_MS);
      expect(share.expiresAt).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS);
    });

    it('accepts the expiry day bounds and rejects out-of-range or non-integer days', async () => {
      const { snapshot } = await setupShare();
      for (const days of [1, 365]) {
        const share = await shares.create('sa', { snapshotId: snapshot.id, expiresInDays: days });
        expect(share.expiresAt).not.toBeNull();
      }
      // 显式 null 与缺省同义：永不过期。
      expect(
        (await shares.create('sa', { snapshotId: snapshot.id, expiresInDays: null })).expiresAt
      ).toBeNull();
      for (const days of [0, 366, 1.5, '3', -1]) {
        await expect(
          shares.create('sa', { snapshotId: snapshot.id, expiresInDays: days })
        ).rejects.toMatchObject({ status: 400, code: 'SHARE_VALIDATION' });
      }
    });

    it('rejects invalid scope values and accepts the two defined ones', async () => {
      const { snapshot } = await setupShare();
      for (const scope of ['public', 'LINK', 42, null]) {
        await expect(
          shares.create('sa', { snapshotId: snapshot.id, scope })
        ).rejects.toMatchObject({ status: 400, code: 'SHARE_VALIDATION' });
      }
      const link = await shares.create('sa', { snapshotId: snapshot.id, scope: 'link' });
      expect(link.scope).toBe('link');
      const local = await shares.create('sa', { snapshotId: snapshot.id, scope: 'local' });
      expect(local.scope).toBe('local');
    });

    it('normalizes the title: whitespace-only becomes null and the max length is enforced', async () => {
      const { snapshot } = await setupShare();
      expect(
        (await shares.create('sa', { snapshotId: snapshot.id, title: '   ' })).title
      ).toBeNull();
      await expect(
        shares.create('sa', {
          snapshotId: snapshot.id,
          title: 'a'.repeat(SHARE_TITLE_MAX_LENGTH + 1),
        })
      ).rejects.toMatchObject({ status: 400, code: 'SHARE_VALIDATION' });
      expect(
        (await shares.create('sa', {
          snapshotId: snapshot.id,
          title: 'a'.repeat(SHARE_TITLE_MAX_LENGTH),
        })).title
      ).toHaveLength(SHARE_TITLE_MAX_LENGTH);
      await expect(
        shares.create('sa', { snapshotId: snapshot.id, title: 42 })
      ).rejects.toMatchObject({ status: 400, code: 'SHARE_VALIDATION' });
    });

    it('validates snapshotId shape and workspace ownership', async () => {
      await captureSite();
      await expect(shares.create('sa', {})).rejects.toMatchObject({
        status: 400,
        code: 'SHARE_VALIDATION',
      });
      await expect(shares.create('sa', { snapshotId: '' })).rejects.toMatchObject({
        status: 400,
        code: 'SHARE_VALIDATION',
      });
      await expect(shares.create('sa', { snapshotId: 42 })).rejects.toMatchObject({
        status: 400,
        code: 'SHARE_VALIDATION',
      });
      await expect(shares.create('sa', { snapshotId: 'dsnope' })).rejects.toMatchObject({
        status: 404,
        code: 'SNAPSHOT_NOT_FOUND',
      });
      // 跨工作区：rootB 的快照对 'sa' 不可分享。
      await writeSite(rootB);
      const foreign = await snapshots.capture('sb', 'index.html');
      await expect(shares.create('sa', { snapshotId: foreign.id })).rejects.toMatchObject({
        status: 404,
        code: 'SNAPSHOT_NOT_FOUND',
      });
    });

    it('rejects non-object input and invalid sessions', async () => {
      const snapshot = await captureSite();
      for (const input of [null, 'x', 42, []]) {
        await expect(shares.create('sa', input)).rejects.toMatchObject({
          status: 400,
          code: 'SHARE_VALIDATION',
        });
      }
      await expect(shares.create(42, { snapshotId: snapshot.id })).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
      });
      await expect(shares.create('snope', { snapshotId: snapshot.id })).rejects.toMatchObject({
        status: 404,
        code: 'SESSION_NOT_FOUND',
      });
    });

    it('generates unique base64url tokens', async () => {
      const first = await setupShare();
      const second = await setupShare();
      expect(first.share.token).not.toBe(second.share.token);
      expect(first.share.id).not.toBe(second.share.id);
      expect(second.share.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(second.share.id).toMatch(/^sh[0-9a-f-]+$/);
    });
  });

  describe('list', () => {
    it('lists newest first, filters by entry path and aggregates comment counts', async () => {
      const snapshot = await captureSite();
      const shareIndex = await shares.create('sa', { snapshotId: snapshot.id, title: 'A' });

      // 第二个入口（不同 entryPath）。
      await mkdir(path.join(rootA, 'pages'), { recursive: true });
      await writeFile(
        path.join(rootA, 'pages', 'about.html'),
        '<html><body><p>about</p></body></html>'
      );
      const aboutSnapshot = await snapshots.capture('sa', 'pages/about.html');
      const shareAbout = await shares.create('sa', { snapshotId: aboutSnapshot.id, title: 'B' });

      const access = await accessOf(shareIndex);
      await shares.addComment(access, { body: 'c1' });
      await shares.addComment(access, { body: 'c2' });

      const listed = await shares.list('sa');
      expect(listed.map(entry => entry.id)).toEqual([shareAbout.id, shareIndex.id]);
      const byId = new Map(listed.map(entry => [entry.id, entry]));
      expect(byId.get(shareIndex.id)?.commentCount).toBe(2);
      expect(byId.get(shareAbout.id)?.commentCount).toBe(0);

      expect((await shares.list('sa', 'index.html')).map(entry => entry.id)).toEqual([
        shareIndex.id,
      ]);
      expect((await shares.list('sa', 'pages/about.html')).map(entry => entry.id)).toEqual([
        shareAbout.id,
      ]);
      expect(await shares.list('sb')).toEqual([]);
      await expect(shares.list('sa', 42)).rejects.toMatchObject({
        status: 400,
        code: 'SHARE_VALIDATION',
      });
    });

    it('includes revoked shares and keeps their aggregated comments', async () => {
      const { share } = await setupShare();
      const access = await accessOf(share);
      await shares.addComment(access, { body: 'note' });
      const revoked = await shares.revoke('sa', share.id);
      expect(revoked.commentCount).toBe(1);
      const listed = await shares.list('sa');
      expect(listed).toHaveLength(1);
      expect(listed[0]?.id).toBe(share.id);
      expect(listed[0]?.revokedAt).not.toBeNull();
    });

    it('caps the listing at SHARE_LIST_LIMIT with newest first', async () => {
      const snapshot = await captureSite();
      const newest = await shares.create('sa', { snapshotId: snapshot.id });
      const insert = db.prepare(
        `INSERT INTO design_shares
         (id, workspace_root, session_id, snapshot_id, token, title, scope, created_at, expires_at)
         VALUES (?, ?, 'sa', ?, ?, NULL, 'link', ?, NULL)`
      );
      const base = newest.createdAt;
      for (let i = 1; i <= SHARE_LIST_LIMIT + 5; i++) {
        insert.run(`sh-seed-${i}`, storedRootA, snapshot.id, `tok-${i}`, base - i);
      }
      const listed = await shares.list('sa');
      expect(listed).toHaveLength(SHARE_LIST_LIMIT);
      expect(listed[0]?.id).toBe(newest.id);
      const timestamps = listed.map(entry => entry.createdAt);
      expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
    });
  });

  describe('revoke', () => {
    it('revokes once, blocks the token and enforces ownership', async () => {
      const { share } = await setupShare();
      const revoked = await shares.revoke('sa', share.id);
      expect(revoked.revokedAt).not.toBeNull();
      expect(revoked.id).toBe(share.id);
      expect(revoked.entryPath).toBe('index.html');
      await expect(shares.resolveByToken(share.token)).rejects.toMatchObject({
        status: 404,
        code: 'SHARE_NOT_FOUND',
      });
      await expect(shares.revoke('sa', share.id)).rejects.toMatchObject({
        status: 409,
        code: 'SHARE_ALREADY_REVOKED',
      });
      await expect(shares.revoke('sb', share.id)).rejects.toMatchObject({
        status: 404,
        code: 'SHARE_NOT_FOUND',
      });
      await expect(shares.revoke('sa', 'shnope')).rejects.toMatchObject({
        status: 404,
        code: 'SHARE_NOT_FOUND',
      });
      await expect(shares.revoke('sa', 42)).rejects.toMatchObject({
        status: 404,
        code: 'SHARE_NOT_FOUND',
      });
    });
  });

  describe('resolveByToken', () => {
    it('resolves the four token states', async () => {
      const { snapshot, share } = await setupShare();

      // 1) 正常：share + snapshot 完整形态。
      const access = await shares.resolveByToken(share.token);
      expect(access.share).toMatchObject({
        id: share.id,
        token: share.token,
        snapshotId: snapshot.id,
        entryPath: 'index.html',
        title: null,
        scope: 'link',
        commentCount: 0,
      });
      expect(access.share.workspaceRoot).toBe(storedRootA);
      expect(access.snapshot).toEqual({
        id: snapshot.id,
        entryPath: 'index.html',
        label: 'v1',
        createdAt: snapshot.createdAt,
        complete: true,
        incompleteReasons: [],
      });

      // 2) 未知（含非串/空串）。
      await expect(shares.resolveByToken('nope-token')).rejects.toMatchObject({
        status: 404,
        code: 'SHARE_NOT_FOUND',
      });
      await expect(shares.resolveByToken(42)).rejects.toMatchObject({
        status: 404,
        code: 'SHARE_NOT_FOUND',
      });
      await expect(shares.resolveByToken('')).rejects.toMatchObject({
        status: 404,
        code: 'SHARE_NOT_FOUND',
      });

      // 3) 撤销后 → 404（与未知不可区分）。
      await shares.revoke('sa', share.id);
      await expect(shares.resolveByToken(share.token)).rejects.toMatchObject({
        status: 404,
        code: 'SHARE_NOT_FOUND',
      });

      // 4) 过期 → 410（expires_at null = 永不过期；到期含恰好 now）。
      const expiring = await shares.create('sa', { snapshotId: snapshot.id, expiresInDays: 1 });
      expect(await shares.resolveByToken(expiring.token)).toBeTruthy();
      db.prepare('UPDATE design_shares SET expires_at = ? WHERE id = ?').run(Date.now(), expiring.id);
      await expect(shares.resolveByToken(expiring.token)).rejects.toMatchObject({
        status: 410,
        code: 'SHARE_EXPIRED',
      });
      db.prepare('UPDATE design_shares SET expires_at = ? WHERE id = ?').run(
        Date.now() - 1000,
        expiring.id
      );
      await expect(shares.resolveByToken(expiring.token)).rejects.toMatchObject({
        status: 410,
        code: 'SHARE_EXPIRED',
      });
    });

    it('treats a share whose snapshot row is gone as unknown', async () => {
      const { snapshot, share } = await setupShare();
      db.prepare('DELETE FROM design_snapshot_files WHERE snapshot_id = ?').run(snapshot.id);
      db.prepare('DELETE FROM design_snapshots WHERE id = ?').run(snapshot.id);
      await expect(shares.resolveByToken(share.token)).rejects.toMatchObject({
        status: 404,
        code: 'SHARE_NOT_FOUND',
      });
    });
  });

  describe('publicManifest', () => {
    it('returns the manifest shape, defaults the title to the entry basename and bumps last_access_at', async () => {
      const { snapshot, share } = await setupShare(); // title null
      const before = Date.now();
      const manifest = await shares.publicManifest(await accessOf(share));
      expect(manifest.title).toBe('index.html');
      expect(manifest.entryPath).toBe('index.html');
      expect(manifest.snapshotLabel).toBe('v1');
      expect(manifest.snapshotCreatedAt).toBe(snapshot.createdAt);
      expect(manifest.complete).toBe(true);
      expect(manifest.incompleteReasons).toEqual([]);
      expect(manifest.files).toEqual([
        { path: 'assets/bg.png', kind: 'image', bytes: BG_BYTES.length },
        { path: 'assets/site.css', kind: 'css', bytes: Buffer.byteLength(SITE_CSS) },
        { path: 'index.html', kind: 'entry', bytes: Buffer.byteLength(INDEX_HTML) },
      ]);
      expect(manifest.shareCreatedAt).toBe(share.createdAt);
      expect(manifest.expiresAt).toBeNull();

      const row = db
        .prepare('SELECT last_access_at FROM design_shares WHERE id = ?')
        .get(share.id) as { last_access_at: number | null };
      expect(row.last_access_at).not.toBeNull();
      expect(row.last_access_at).toBeGreaterThanOrEqual(before);

      // 显式标题优先于 basename。
      const titled = await setupShare({ title: '设计评审' });
      const titledManifest = await shares.publicManifest(await accessOf(titled.share));
      expect(titledManifest.title).toBe('设计评审');

      // 嵌套入口的 basename 兜底取最后一段。
      await mkdir(path.join(rootA, 'pages'), { recursive: true });
      await writeFile(
        path.join(rootA, 'pages', 'page.html'),
        '<html><body><p>nested</p></body></html>'
      );
      const nested = await snapshots.capture('sa', 'pages/page.html');
      const nestedShare = await shares.create('sa', { snapshotId: nested.id });
      expect((await shares.publicManifest(await accessOf(nestedShare))).title).toBe('page.html');
    });

    it('reports incomplete snapshots honestly', async () => {
      await mkdir(path.join(rootA, 'assets'), { recursive: true });
      await writeFile(
        path.join(rootA, 'index.html'),
        '<html><body><img src="missing.png"><p>v1</p></body></html>'
      );
      const captured = await snapshots.capture('sa', 'index.html');
      expect(captured.complete).toBe(false);
      const share = await shares.create('sa', { snapshotId: captured.id });
      const manifest = await shares.publicManifest(await accessOf(share));
      expect(manifest.complete).toBe(false);
      expect(manifest.incompleteReasons.some(reason => reason.includes('missing.png'))).toBe(true);
    });
  });

  describe('publicFile', () => {
    it('serves manifest files byte-for-byte and rejects unlisted paths', async () => {
      const { share } = await setupShare();
      const access = await accessOf(share);

      const html = await shares.publicFile(access, 'index.html');
      expect(html.mime).toBe('text/html');
      expect(html.bytes).toEqual(Buffer.from(INDEX_HTML));
      expect(html.sha256).toBe(sha256(Buffer.from(INDEX_HTML)));

      const png = await shares.publicFile(access, 'assets/bg.png');
      expect(png.mime).toBe('image/png');
      expect(png.bytes).toEqual(BG_BYTES);
      expect(png.sha256).toBe(sha256(BG_BYTES));

      await expect(shares.publicFile(access, 'missing.png')).rejects.toMatchObject({
        status: 404,
        code: 'SHARE_FILE_NOT_FOUND',
      });
      await expect(shares.publicFile(access, 'assets/nope.css')).rejects.toMatchObject({
        status: 404,
        code: 'SHARE_FILE_NOT_FOUND',
      });
    });

    it('falls back to application/octet-stream when the manifest mime is null', async () => {
      const { share } = await setupShare();
      db.prepare("UPDATE design_snapshot_files SET mime = NULL WHERE path = 'assets/site.css'").run();
      const file = await shares.publicFile(await accessOf(share), 'assets/site.css');
      expect(file.mime).toBe('application/octet-stream');
    });

    it('rejects traversal, dot-prefix, backslash, absolute and malformed paths', async () => {
      const { share } = await setupShare();
      const access = await accessOf(share);
      const forbidden = [
        '../secret.txt',
        'assets/../../secret.txt',
        './index.html',
        '.git/config',
        'assets/.hidden.png',
        'assets\\bg.png',
        '/etc/passwd',
        'index.html/', // 空组件
      ];
      for (const value of forbidden) {
        await expect(shares.publicFile(access, value)).rejects.toMatchObject({
          status: 403,
          code: 'PATH_FORBIDDEN',
        });
      }
      for (const value of ['', 42, null, 'a\0b', 'x'.repeat(SHARE_FILE_PATH_MAX_LENGTH + 1)]) {
        await expect(shares.publicFile(access, value)).rejects.toMatchObject({
          status: 400,
          code: 'VALIDATION_ERROR',
        });
      }
      // 恰好 512 的合法形状不算超长（走清单查询 → 404）。
      const maxed = `${'a'.repeat(508)}.png`;
      expect(maxed).toHaveLength(SHARE_FILE_PATH_MAX_LENGTH);
      await expect(shares.publicFile(access, maxed)).rejects.toMatchObject({
        status: 404,
        code: 'SHARE_FILE_NOT_FOUND',
      });
    });
  });

  describe('addComment / publicComments', () => {
    it('adds comments with author normalization and round-trips targets', async () => {
      const { share } = await setupShare();
      const access = await accessOf(share);

      const anonymous = await shares.addComment(access, { body: '  这里有问题  ' });
      expect(anonymous.author).toBe('Anonymous');
      expect(anonymous.body).toBe('这里有问题');
      expect(anonymous.target).toBeNull();
      expect(anonymous.resolvedAt).toBeNull();
      expect(anonymous.id).toMatch(/^sc[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(anonymous.createdAt).toBeLessThanOrEqual(Date.now());

      expect((await shares.addComment(access, { author: '   ', body: 'x' })).author).toBe('Anonymous');
      expect((await shares.addComment(access, { author: ' 小明 ', body: 'x' })).author).toBe('小明');

      const target = { elementPath: [0, 2, 1], tagName: 'p', text: 'hello share' };
      const located = await shares.addComment(access, { body: '定位评论', target });
      expect(located.target).toEqual(target);

      // 公开列表：仅本分享、插入序（created_at ASC + rowid ASC）、target 是对象。
      const publicList = await shares.publicComments(access);
      expect(publicList.map(entry => entry.body)).toEqual(['这里有问题', 'x', 'x', '定位评论']);
      expect(publicList[3]?.target).toEqual(target);
    });

    it('enforces the comment validation matrix', async () => {
      const { share } = await setupShare();
      const access = await accessOf(share);
      const invalid = async (input: unknown): Promise<void> => {
        await expect(shares.addComment(access, input)).rejects.toMatchObject({
          status: 400,
          code: 'SHARE_COMMENT_INVALID',
        });
      };

      // 非对象输入。
      for (const input of [null, 'x', 42, []]) await invalid(input);
      // author。
      await invalid({ body: 'x', author: 42 });
      await invalid({ body: 'x', author: 'a'.repeat(SHARE_COMMENT_AUTHOR_MAX_LENGTH + 1) });
      expect(
        (await shares.addComment(access, {
          body: 'x',
          author: 'a'.repeat(SHARE_COMMENT_AUTHOR_MAX_LENGTH),
        })).author
      ).toHaveLength(SHARE_COMMENT_AUTHOR_MAX_LENGTH);
      // body。
      await invalid({});
      await invalid({ body: 42 });
      await invalid({ body: '   ' });
      await invalid({ body: 'a'.repeat(SHARE_COMMENT_BODY_MAX_LENGTH + 1) });
      await shares.addComment(access, { body: 'a'.repeat(SHARE_COMMENT_BODY_MAX_LENGTH) });
      // target。
      await invalid({ body: 'x', target: 'p' });
      await invalid({ body: 'x', target: [] });
      await invalid({ body: 'x', target: {} });
      await invalid({ body: 'x', target: { tagName: 'p', text: 't' } });
      await invalid({ body: 'x', target: { elementPath: [], tagName: 'p', text: 't' } });
      await invalid({
        body: 'x',
        target: {
          elementPath: Array(SHARE_ELEMENT_PATH_MAX_DEPTH + 1).fill(0),
          tagName: 'p',
          text: 't',
        },
      });
      await invalid({ body: 'x', target: { elementPath: [0.5], tagName: 'p', text: 't' } });
      await invalid({ body: 'x', target: { elementPath: [-1], tagName: 'p', text: 't' } });
      await invalid({
        body: 'x',
        target: { elementPath: [SHARE_ELEMENT_PATH_MAX_INDEX + 1], tagName: 'p', text: 't' },
      });
      await invalid({ body: 'x', target: { elementPath: ['0'], tagName: 'p', text: 't' } });
      await invalid({ body: 'x', target: { elementPath: [0], tagName: '', text: 't' } });
      await invalid({ body: 'x', target: { elementPath: [0], tagName: '   ', text: 't' } });
      await invalid({
        body: 'x',
        target: {
          elementPath: [0],
          tagName: 'x'.repeat(SHARE_TARGET_TAG_NAME_MAX_LENGTH + 1),
          text: 't',
        },
      });
      await invalid({ body: 'x', target: { elementPath: [0], tagName: 'p', text: 42 } });
      await invalid({
        body: 'x',
        target: {
          elementPath: [0],
          tagName: 'p',
          text: 'x'.repeat(SHARE_TARGET_TEXT_MAX_LENGTH + 1),
        },
      });
      // 边界合法值。
      const ok = await shares.addComment(access, {
        body: 'x',
        target: {
          elementPath: [0, SHARE_ELEMENT_PATH_MAX_INDEX],
          tagName: 'x'.repeat(SHARE_TARGET_TAG_NAME_MAX_LENGTH),
          text: '',
        },
      });
      expect(ok.target).toEqual({
        elementPath: [0, SHARE_ELEMENT_PATH_MAX_INDEX],
        tagName: 'x'.repeat(SHARE_TARGET_TAG_NAME_MAX_LENGTH),
        text: '',
      });
    });

    it('caps comments per share at the limit', async () => {
      const { share } = await setupShare();
      const access = await accessOf(share);
      const insert = db.prepare(
        `INSERT INTO design_share_comments (id, share_id, author, body, target_json, created_at)
         VALUES (?, ?, 'seeder', 'seeded', NULL, ?)`
      );
      const base = Date.now();
      for (let i = 0; i < SHARE_COMMENTS_PER_SHARE_LIMIT; i++) {
        insert.run(`sc-seed-${i}`, share.id, base + i);
      }
      expect(await shares.publicComments(access)).toHaveLength(SHARE_COMMENTS_PER_SHARE_LIMIT);
      await expect(shares.addComment(access, { body: 'one too many' })).rejects.toMatchObject({
        status: 400,
        code: 'SHARE_COMMENT_LIMIT',
      });
    });
  });

  describe('owner comments (listComments / setResolved)', () => {
    it('lists comments in order and resolves idempotently', async () => {
      const { share } = await setupShare();
      const access = await accessOf(share);
      const target = { elementPath: [1], tagName: 'p', text: 'hello' };
      const c1 = await shares.addComment(access, { body: 'c1' });
      const c2 = await shares.addComment(access, { body: 'c2', target });
      // 别的分享的评论不掺进来。
      const { share: otherShare } = await setupShare({ title: 'other' });
      const otherAccess = await accessOf(otherShare);
      const foreign = await shares.addComment(otherAccess, { body: 'foreign' });

      const ownerList = await shares.listComments('sa', share.id);
      expect(ownerList.map(entry => entry.id)).toEqual([c1.id, c2.id]);
      expect(ownerList[1]?.target).toEqual(target);

      // 解决：resolvedAt 落定。
      const resolved = await shares.setResolved('sa', share.id, c1.id, true);
      expect(resolved.resolvedAt).not.toBeNull();
      // 幂等：目标态已达成时不重写 resolved_at（人为挪动后再次 resolve 保持不变）。
      db.prepare('UPDATE design_share_comments SET resolved_at = 1234567 WHERE id = ?').run(c1.id);
      expect((await shares.setResolved('sa', share.id, c1.id, true)).resolvedAt).toBe(1234567);

      // 取消解决；重复取消同样幂等。
      expect((await shares.setResolved('sa', share.id, c1.id, false)).resolvedAt).toBeNull();
      expect((await shares.setResolved('sa', share.id, c1.id, false)).resolvedAt).toBeNull();

      // 校验与归属。
      await expect(shares.setResolved('sa', share.id, c1.id, 'yes')).rejects.toMatchObject({
        status: 400,
        code: 'SHARE_VALIDATION',
      });
      await expect(shares.setResolved('sa', share.id, 'scnope', true)).rejects.toMatchObject({
        status: 404,
        code: 'SHARE_COMMENT_NOT_FOUND',
      });
      await expect(shares.setResolved('sa', share.id, foreign.id, true)).rejects.toMatchObject({
        status: 404,
        code: 'SHARE_COMMENT_NOT_FOUND',
      });
      await expect(shares.setResolved('sa', 'shnope', c1.id, true)).rejects.toMatchObject({
        status: 404,
        code: 'SHARE_NOT_FOUND',
      });
      await expect(shares.setResolved('sb', share.id, c1.id, true)).rejects.toMatchObject({
        status: 404,
        code: 'SHARE_NOT_FOUND',
      });
      await expect(shares.listComments('sa', 42)).rejects.toMatchObject({
        status: 404,
        code: 'SHARE_NOT_FOUND',
      });
    });

    it('aggregates commentCount across owner and public reads', async () => {
      const { share } = await setupShare();
      const access = await accessOf(share);
      await shares.addComment(access, { body: 'one' });
      await shares.addComment(access, { body: 'two' });

      expect((await shares.list('sa'))[0]?.commentCount).toBe(2);
      expect((await shares.revoke('sa', share.id)).commentCount).toBe(2);

      // 公开侧读取同一计数（未撤销的分享）。
      const { share: fresh } = await setupShare({ title: 'fresh' });
      const freshAccess = await accessOf(fresh);
      await shares.addComment(freshAccess, { body: 'a' });
      await shares.addComment(freshAccess, { body: 'b' });
      await shares.addComment(freshAccess, { body: 'c' });
      expect((await shares.resolveByToken(fresh.token)).share.commentCount).toBe(3);
      // entryPath 过滤同时命中两个分享：fresh（3）在新、已撤销（2）在后。
      expect((await shares.list('sa', 'index.html')).map(entry => entry.commentCount)).toEqual([
        3, 2,
      ]);
    });
  });
});
