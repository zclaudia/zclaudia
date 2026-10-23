import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DesignService } from '../design-service.js';
import { BrandService, MAX_BRAND_FILE_BYTES } from '../brand-service.js';

const DESIGN_MD = '# 品牌与设计系统\n\n> 主色 #4f46e5，正文 PingFang SC。\n';
const TOKENS_CSS = '/* ZClaudia design tokens */\n:root { --color-primary: #4f46e5; }\n';

const sha256 = (source: string | Buffer): string =>
  createHash('sha256').update(source).digest('hex');

describe('BrandService', () => {
  let db: Database.Database;
  let temp: string;
  let rootA: string;
  let brand: BrandService;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'design-brand-'));
    rootA = path.join(temp, 'a');
    await mkdir(rootA);
    db = new Database(':memory:');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, working_directory TEXT);
      INSERT INTO projects VALUES ('pa', '${rootA}');
      INSERT INTO sessions VALUES ('sa', 'pa', NULL);`);
    brand = new BrandService(new DesignService(db));
  });

  afterEach(async () => {
    db.close();
    await rm(temp, { recursive: true, force: true });
  });

  it('reads all-null before the brand files exist, including a missing design/ directory', async () => {
    await expect(brand.read('sa')).resolves.toEqual({
      designMd: null,
      designMdRevision: null,
      tokensCss: null,
      tokensCssRevision: null,
    });
  });

  it('creates both files from empty revisions and reads them back with hash revisions', async () => {
    const written = await brand.write('sa', {
      designMd: DESIGN_MD,
      designMdRevision: '',
      tokensCss: TOKENS_CSS,
      tokensCssRevision: '',
    });
    expect(written).toEqual({
      designMdRevision: sha256(DESIGN_MD),
      tokensCssRevision: sha256(TOKENS_CSS),
    });
    await expect(readFile(path.join(rootA, 'design', 'DESIGN.md'), 'utf8')).resolves.toBe(DESIGN_MD);
    await expect(readFile(path.join(rootA, 'design', 'tokens.css'), 'utf8')).resolves.toBe(
      TOKENS_CSS
    );

    await expect(brand.read('sa')).resolves.toEqual({
      designMd: DESIGN_MD,
      designMdRevision: sha256(DESIGN_MD),
      tokensCss: TOKENS_CSS,
      tokensCssRevision: sha256(TOKENS_CSS),
    });
  });

  it('updates with the current hash revision and rejects stale ones with 409', async () => {
    await brand.write('sa', { designMd: DESIGN_MD, designMdRevision: '' });
    const next = '# 品牌与设计系统 v2\n';
    const updated = await brand.write('sa', {
      designMd: next,
      designMdRevision: sha256(DESIGN_MD),
    });
    expect(updated.designMdRevision).toBe(sha256(next));
    await expect(readFile(path.join(rootA, 'design', 'DESIGN.md'), 'utf8')).resolves.toBe(next);

    await expect(
      brand.write('sa', { designMd: '# 丢失的更新\n', designMdRevision: sha256(DESIGN_MD) })
    ).rejects.toMatchObject({ status: 409, code: 'REVISION_CONFLICT' });
    await expect(readFile(path.join(rootA, 'design', 'DESIGN.md'), 'utf8')).resolves.toBe(next);
  });

  it('commits a single file without touching the other one', async () => {
    await brand.write('sa', { designMd: DESIGN_MD, designMdRevision: '' });
    const written = await brand.write('sa', { tokensCss: TOKENS_CSS, tokensCssRevision: '' });
    expect(written).toEqual({ designMdRevision: null, tokensCssRevision: sha256(TOKENS_CSS) });
    await expect(readFile(path.join(rootA, 'design', 'DESIGN.md'), 'utf8')).resolves.toBe(DESIGN_MD);
  });

  it('keeps the first file when the second write fails and names the failing file', async () => {
    await brand.write('sa', {
      designMd: DESIGN_MD,
      designMdRevision: '',
      tokensCss: TOKENS_CSS,
      tokensCssRevision: '',
    });
    const failure = brand.write('sa', {
      designMd: '# 新版品牌\n',
      designMdRevision: sha256(DESIGN_MD),
      tokensCss: '/* 新版 tokens */\n',
      tokensCssRevision: sha256('stale'),
    });
    await expect(failure).rejects.toMatchObject({ status: 409, code: 'REVISION_CONFLICT' });
    await expect(failure).rejects.toMatchObject({
      message: expect.stringContaining('design/tokens.css'),
    });
    // The first file was already written — no cross-file rollback.
    await expect(readFile(path.join(rootA, 'design', 'DESIGN.md'), 'utf8')).resolves.toBe(
      '# 新版品牌\n'
    );
  });

  it('caps each file at 256 KiB with 413 and validates content and revision types', async () => {
    const oversized = 'x'.repeat(MAX_BRAND_FILE_BYTES + 1);
    await expect(
      brand.write('sa', { designMd: oversized, designMdRevision: '' })
    ).rejects.toMatchObject({ status: 413, code: 'FILE_TOO_LARGE' });

    await expect(brand.write('sa', { designMd: 42 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(
      brand.write('sa', { designMd: 'x', designMdRevision: 'not-a-hash' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(brand.write('sa', {})).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(brand.write('absent', { designMd: 'x' })).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
  });

  it('reads a half-created pair and treats a hash revision on a missing file as not found', async () => {
    await mkdir(path.join(rootA, 'design'));
    await writeFile(path.join(rootA, 'design', 'tokens.css'), TOKENS_CSS);
    await expect(brand.read('sa')).resolves.toEqual({
      designMd: null,
      designMdRevision: null,
      tokensCss: TOKENS_CSS,
      tokensCssRevision: sha256(TOKENS_CSS),
    });

    await expect(
      brand.write('sa', { designMd: 'x', designMdRevision: sha256('x') })
    ).rejects.toMatchObject({ status: 404, code: 'FILE_NOT_FOUND' });
  });
});
