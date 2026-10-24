// P7 S2 分享视图路由测试：supertest 直挂 router + 真临时工作区 + 真快照
// （SnapshotService.capture）+ :memory: SQLite + migration 050/052。
// 风格对齐 design.test.ts / share-service.test.ts。

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createDesignShareRoutes,
  SHARE_VIEWER_HTML,
  type DesignShareRoutesDeps,
} from '../share-viewer.js';
import { BlobStore } from '../../../infra/design/blob-store.js';
import { migration as migration050 } from '../../../infra/storage/migrations/050_design_snapshots.js';
import { migration as migration052 } from '../../../infra/storage/migrations/052_design_shares.js';
import { DesignService } from '../../../application/design/design-service.js';
import { SnapshotService } from '../../../application/design/snapshot-service.js';
import { ShareService } from '../../../application/design/share-service.js';
import { SHARE_COMMENT_BODY_MAX_LENGTH } from '../../../application/design/share-types.js';

const INDEX_HTML = [
  '<!doctype html>',
  '<html><head>',
  '<link rel="stylesheet" href="assets/site.css">',
  '</head><body>',
  '<img src="assets/bg.png">',
  '<p>hello share</p>',
  '</body></html>',
].join('\n');

const NESTED_HTML =
  '<html><head><link rel="stylesheet" href="style.css"></head><body><p>嵌套页面</p></body></html>';

const SITE_CSS = 'body { background: #fff; }';
const NESTED_CSS = 'p { color: #333; }';
const BG_BYTES = Buffer.from([1, 2, 3, 4]);
const SHARE_FILE_CSP =
  "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'";

/** supertest 二进制响应收集（design.test.ts 同款形态）。 */
function parseBinary(res: unknown, callback: (error: Error | null, body?: Buffer) => void): void {
  const stream = res as { on: (event: string, listener: (chunk?: Buffer) => void) => void };
  const chunks: Buffer[] = [];
  stream.on('data', chunk => chunks.push(chunk as Buffer));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}

/**
 * 原始请求目标直发：node:http 不做点段归一化。supertest/superagent 与真实
 * 浏览器（RFC 3986 remove_dot_segments）一样会在客户端吃掉 `..`/`.` 段，
 * 因此 `..` 场景用本 helper 绕开客户端归一化、直测路由侧的 decode 循环。
 */
function rawGet(
  app: express.Express,
  target: string
): Promise<{ status: number; body: string; headers: IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('listener has no address'));
        return;
      }
      const req = httpRequest({ host: '127.0.0.1', port: address.port, path: target }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk as Buffer));
        res.on('end', () => {
          server.close();
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          });
        });
      });
      req.on('error', error => {
        server.close();
        reject(error);
      });
      req.end();
    });
  });
}

describe('design share viewer routes', () => {
  let db: Database.Database;
  let app: express.Express;
  let temp: string;
  let rootA: string;
  let blobs: BlobStore;
  let snapshots: SnapshotService;
  let shares: ShareService;

  /** （重）挂 router：默认本机判定；local 语义测试注入 isLocal。 */
  function mount(deps?: DesignShareRoutesDeps): void {
    app = express();
    app.use(express.json());
    app.use(createDesignShareRoutes(db, deps));
  }

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'share-viewer-'));
    rootA = path.join(temp, 'a');
    await mkdir(rootA);
    // Blob 内容必须落在测试临时目录（router 的 BlobStore 根 = $ZCLAUDIA_DATA_DIR/design-snapshots）。
    process.env.ZCLAUDIA_DATA_DIR = temp;
    db = new Database(':memory:');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, working_directory TEXT);
      INSERT INTO projects VALUES ('pa', '${rootA}');
      INSERT INTO sessions VALUES ('sa', 'pa', NULL);`);
    db.exec(migration050.sql);
    db.exec(migration052.sql);
    // 与 router 内装配同根：temp/design-snapshots。
    blobs = new BlobStore(path.join(temp, 'design-snapshots'));
    snapshots = new SnapshotService(db, blobs);
    shares = new ShareService(db, new DesignService(db), blobs);
    mount();
  });

  afterEach(async () => {
    db.close();
    delete process.env.ZCLAUDIA_DATA_DIR;
    await rm(temp, { recursive: true, force: true });
  });

  async function seedSite(): Promise<void> {
    await mkdir(path.join(rootA, 'assets'), { recursive: true });
    await writeFile(path.join(rootA, 'index.html'), INDEX_HTML);
    await writeFile(path.join(rootA, 'assets', 'site.css'), SITE_CSS);
    await writeFile(path.join(rootA, 'assets', 'bg.png'), BG_BYTES);
  }

  async function setupShare(
    overrides: Record<string, unknown> = {}
  ): Promise<{ snapshotId: string; share: Awaited<ReturnType<ShareService['create']>> }> {
    await seedSite();
    const snapshot = await snapshots.capture('sa', 'index.html', 'v1');
    const share = await shares.create('sa', { snapshotId: snapshot.id, ...overrides });
    return { snapshotId: snapshot.id, share };
  }

  /** /s/<token>/f/<逐段 encode 的清单路径>。 */
  function fileUrl(share: { token: string }, manifestPath: string): string {
    return (
      `/s/${share.token}/f/` +
      manifestPath
        .split('/')
        .map(encodeURIComponent)
        .join('/')
    );
  }

  // ---------------------------------------------------------------------------
  // 视图 HTML
  // ---------------------------------------------------------------------------

  it('serves the view HTML with no-store, a scripts-free sandbox and no external resources', async () => {
    const { share } = await setupShare();
    const res = await request(app).get(`/s/${share.token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toBe(SHARE_VIEWER_HTML);
    // iframe 沙箱：保留同源（选区需要）且绝无 allow-scripts。
    expect(res.text).toContain('sandbox="allow-same-origin"');
    expect(res.text).not.toContain('allow-scripts');
    // 无外链资源、无外链脚本。
    expect(res.text).not.toMatch(/src="https?:/);
    expect(res.text).not.toMatch(/href="https?:/);
    expect(res.text).not.toMatch(/<script[^>]*\ssrc=/);
    // 姓名持久化键与中文文案就位。
    expect(res.text).toContain('zclaudia-share-name');
    expect(res.text).toContain('Clear anchor (comment on the whole page)');
    expect(res.text).toContain('Shared as a static snapshot; link navigation is disabled');
  });

  // ---------------------------------------------------------------------------
  // manifest.json
  // ---------------------------------------------------------------------------

  it('serves the full public manifest and bumps last_access_at', async () => {
    const { snapshotId, share } = await setupShare({ title: '设计评审' });
    const snapshotCreatedAt = (
      db.prepare('SELECT created_at FROM design_snapshots WHERE id = ?').get(snapshotId) as {
        created_at: number;
      }
    ).created_at;
    const before = Date.now();
    const res = await request(app).get(`/s/${share.token}/manifest.json`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({
      title: '设计评审',
      entryPath: 'index.html',
      snapshotLabel: 'v1',
      snapshotCreatedAt,
      complete: true,
      incompleteReasons: [],
      files: [
        { path: 'assets/bg.png', kind: 'image', bytes: BG_BYTES.length },
        { path: 'assets/site.css', kind: 'css', bytes: Buffer.byteLength(SITE_CSS) },
        { path: 'index.html', kind: 'entry', bytes: Buffer.byteLength(INDEX_HTML) },
      ],
      shareCreatedAt: share.createdAt,
      expiresAt: null,
    });
    // 命中已更新 last_access_at（直接查库）。
    const row = db
      .prepare('SELECT last_access_at FROM design_shares WHERE id = ?')
      .get(share.id) as { last_access_at: number | null };
    expect(row.last_access_at).not.toBeNull();
    expect(row.last_access_at).toBeGreaterThanOrEqual(before);
  });

  // ---------------------------------------------------------------------------
  // 清单内文件
  // ---------------------------------------------------------------------------

  it('serves manifest files byte-for-byte with the exact guard headers', async () => {
    const { share } = await setupShare();

    const css = await request(app)
      .get(fileUrl(share, 'assets/site.css'))
      .buffer(true)
      .parse(parseBinary);
    expect(css.status).toBe(200);
    // express res.set 对 text/* mime 追加 charset=utf-8（标准行为）。
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(css.headers['x-content-type-options']).toBe('nosniff');
    expect(css.headers['cache-control']).toBe('private, no-store');
    expect(css.headers['content-security-policy']).toBe(SHARE_FILE_CSP);
    expect(css.body).toEqual(Buffer.from(SITE_CSS));

    const png = await request(app)
      .get(fileUrl(share, 'assets/bg.png'))
      .buffer(true)
      .parse(parseBinary);
    expect(png.status).toBe(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.headers['content-security-policy']).toBe(SHARE_FILE_CSP);
    expect(png.body).toEqual(BG_BYTES);

    const entry = await request(app)
      .get(fileUrl(share, 'index.html'))
      .buffer(true)
      .parse(parseBinary);
    expect(entry.status).toBe(200);
    expect(entry.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(entry.body).toEqual(Buffer.from(INDEX_HTML));

    // 清单外路径 → 404 SHARE_FILE_NOT_FOUND。
    const outside = await request(app).get(fileUrl(share, 'missing.png'));
    expect(outside.status).toBe(404);
    expect(outside.body).toMatchObject({
      success: false,
      error: { code: 'SHARE_FILE_NOT_FOUND' },
    });
  });

  it('rejects traversal, dot-prefix and backslash manifest paths', async () => {
    const { share } = await setupShare();

    // `..`/`.` 段在 supertest（与浏览器同为 RFC 3986 归一化）客户端就被吃掉，
    // 用原始请求目标直发，断言路由 decode 循环交给 publicFile 后的 403。
    for (const target of ['..%2Fsecret.txt', 'assets%2F..%2F..%2Fsecret.txt', '.%2Findex.html']) {
      const raw = await rawGet(app, `/s/${share.token}/f/${target}`);
      expect(raw.status, target).toBe(403);
      expect(JSON.parse(raw.body).error.code, target).toBe('PATH_FORBIDDEN');
    }

    // 点前缀组件、反斜杠、空组件可完整抵达路由 → publicFile 的 403。
    for (const manifestPath of ['.git/config', 'assets/.hidden.png', 'assets\\bg.png', 'index.html/']) {
      const res = await request(app).get(fileUrl(share, manifestPath));
      expect(res.status, manifestPath).toBe(403);
      expect(res.body.error.code, manifestPath).toBe('PATH_FORBIDDEN');
    }
  });

  it('serves percent-encoded paths with Chinese and space directories', async () => {
    const dir = path.join(rootA, '页面 目录');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'page.html'), NESTED_HTML);
    await writeFile(path.join(dir, 'style.css'), NESTED_CSS);
    const snapshot = await snapshots.capture('sa', '页面 目录/page.html');
    const share = await shares.create('sa', { snapshotId: snapshot.id });

    const css = await request(app)
      .get(fileUrl(share, '页面 目录/style.css'))
      .buffer(true)
      .parse(parseBinary);
    expect(css.status).toBe(200);
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(css.body).toEqual(Buffer.from(NESTED_CSS));

    const entry = await request(app)
      .get(fileUrl(share, '页面 目录/page.html'))
      .buffer(true)
      .parse(parseBinary);
    expect(entry.status).toBe(200);
    expect(entry.body).toEqual(Buffer.from(NESTED_HTML));
  });

  // ---------------------------------------------------------------------------
  // token 状态
  // ---------------------------------------------------------------------------

  it('maps unknown, revoked and expired tokens to 404/404/410 across endpoints', async () => {
    const { snapshotId, share } = await setupShare();

    const unknown = await request(app).get('/s/nope-token');
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ success: false, error: { code: 'SHARE_NOT_FOUND' } });

    await shares.revoke('sa', share.id);
    for (const path of [`/s/${share.token}`, `/s/${share.token}/manifest.json`, `/s/${share.token}/comments`]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(404);
      expect(res.body.error.code, path).toBe('SHARE_NOT_FOUND');
    }
    expect((await request(app).get(fileUrl(share, 'index.html'))).status).toBe(404);

    // 过期（UPDATE expires_at 到过去时刻）→ 410，且作用于全部五类端点。
    const expiring = await shares.create('sa', { snapshotId, expiresInDays: 1 });
    expect((await request(app).get(`/s/${expiring.token}`)).status).toBe(200);
    db.prepare('UPDATE design_shares SET expires_at = ? WHERE id = ?').run(
      Date.now() - 1000,
      expiring.id
    );
    for (const path of [
      `/s/${expiring.token}`,
      `/s/${expiring.token}/manifest.json`,
      `/s/${expiring.token}/comments`,
      fileUrl(expiring, 'index.html'),
    ]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(410);
      expect(res.body.error.code, path).toBe('SHARE_EXPIRED');
    }
    const expiredPost = await request(app)
      .post(`/s/${expiring.token}/comments`)
      .send({ body: 'late' });
    expect(expiredPost.status).toBe(410);
    expect(expiredPost.body.error.code).toBe('SHARE_EXPIRED');
  });

  // ---------------------------------------------------------------------------
  // scope local
  // ---------------------------------------------------------------------------

  it('rejects non-local visitors for local-scope shares with SHARE_LOCAL_ONLY', async () => {
    const { share } = await setupShare({ scope: 'local' });
    mount({ isLocal: () => false });

    for (const path of [`/s/${share.token}`, `/s/${share.token}/manifest.json`, `/s/${share.token}/comments`]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(403);
      expect(res.body.error.code, path).toBe('SHARE_LOCAL_ONLY');
    }
    expect((await request(app).get(fileUrl(share, 'index.html'))).body.error.code).toBe(
      'SHARE_LOCAL_ONLY'
    );
    expect(
      (await request(app).post(`/s/${share.token}/comments`).send({ body: 'x' })).body.error.code
    ).toBe('SHARE_LOCAL_ONLY');
  });

  it('lets loopback requests through with the default local check', async () => {
    const { share } = await setupShare({ scope: 'local' });
    // supertest 走回环连接，remoteAddress 为 127.0.0.1 —— 默认判定应放行。
    const res = await request(app).get(`/s/${share.token}`);
    expect(res.status).toBe(200);
    expect((await request(app).get(`/s/${share.token}/manifest.json`)).status).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // 评论
  // ---------------------------------------------------------------------------

  it('lists and posts comments with author default and target passthrough', async () => {
    const { share } = await setupShare();
    const url = `/s/${share.token}/comments`;

    const empty = await request(app).get(url);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ comments: [] });

    const target = { elementPath: [0, 2], tagName: 'p', text: 'hello share' };
    const posted = await request(app).post(url).send({ body: '  这里有问题  ', target });
    expect(posted.status).toBe(201);
    expect(posted.body.comment).toMatchObject({
      author: 'Anonymous',
      body: '这里有问题',
      target,
      resolvedAt: null,
    });

    const named = await request(app).post(url).send({ author: '小明', body: '不错' });
    expect(named.status).toBe(201);
    expect(named.body.comment.author).toBe('小明');
    expect(named.body.comment.target).toBeNull();

    const listed = await request(app).get(url);
    expect(listed.status).toBe(200);
    expect(listed.body.comments.map((entry: { body: string }) => entry.body)).toEqual([
      '这里有问题',
      '不错',
    ]);
  });

  it('rejects oversized comment bodies with SHARE_COMMENT_INVALID', async () => {
    const { share } = await setupShare();
    const res = await request(app)
      .post(`/s/${share.token}/comments`)
      .send({ body: 'x'.repeat(SHARE_COMMENT_BODY_MAX_LENGTH + 1) });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: { code: 'SHARE_COMMENT_INVALID' } });
  });
});
