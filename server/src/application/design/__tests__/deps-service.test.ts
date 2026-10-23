import Database from 'better-sqlite3';
import { mkdtemp, mkdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DepsService } from '../deps-service.js';

const INDEX_HTML = [
  '<html><head>',
  '<link rel="stylesheet" href="assets/site.css">',
  '<style>body { background: url("inline.png"); }</style>',
  '</head><body>',
  '<img src="hero.png" srcset="hero@2x.png 2x, hero@3x.png 3x">',
  '</body></html>',
].join('\n');

const SITE_CSS = [
  '@import "extra.css";',
  '@font-face { font-family: X; src: url("fonts/f.woff2"); }',
  '.icon { background: url(icon.svg); }',
].join('\n');

async function writeSite(root: string): Promise<void> {
  await mkdir(path.join(root, 'assets', 'fonts'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), INDEX_HTML);
  await writeFile(path.join(root, 'assets', 'site.css'), SITE_CSS);
  await writeFile(path.join(root, 'assets', 'extra.css'), '.extra {}');
  await writeFile(path.join(root, 'hero.png'), Buffer.from([1, 2, 3]));
  await writeFile(path.join(root, 'hero@2x.png'), Buffer.from([4]));
  await writeFile(path.join(root, 'hero@3x.png'), Buffer.from([5, 6]));
  await writeFile(path.join(root, 'inline.png'), Buffer.from([7]));
  await writeFile(path.join(root, 'assets', 'icon.svg'), Buffer.from([8]));
  await writeFile(path.join(root, 'assets', 'fonts', 'f.woff2'), Buffer.from([9, 9, 9]));
}

describe('DepsService', () => {
  let db: Database.Database;
  let temp: string;
  let rootA: string;
  let deps: DepsService;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'design-deps-'));
    rootA = path.join(temp, 'a');
    await mkdir(rootA);
    db = new Database(':memory:');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, working_directory TEXT);
      INSERT INTO projects VALUES ('pa', '${rootA}');
      INSERT INTO sessions VALUES ('sa', 'pa', NULL);`);
    deps = new DepsService(db);
  });

  afterEach(async () => {
    db.close();
    await rm(temp, { recursive: true, force: true });
  });

  it('walks html → css → images/fonts including srcset and reports size/mtime per reference', async () => {
    await writeSite(rootA);
    const fixedTime = new Date(1600000000000);
    await utimes(path.join(rootA, 'hero.png'), fixedTime, fixedTime);

    const result = await deps.stat('sa', 'index.html');
    expect(result.entry.path).toBe('index.html');
    expect(result.entry.size).toBe(Buffer.byteLength(INDEX_HTML));
    expect(typeof result.entry.mtimeMs).toBe('number');

    const byPath = new Map(result.files.map(file => [file.path, file]));
    expect([...byPath.keys()].sort()).toEqual([
      'assets/extra.css',
      'assets/fonts/f.woff2',
      'assets/icon.svg',
      'assets/site.css',
      'hero.png',
      'hero@2x.png',
      'hero@3x.png',
      'inline.png',
    ]);
    expect(byPath.get('assets/site.css')).toMatchObject({ kind: 'css', missing: false });
    expect(byPath.get('assets/extra.css')).toMatchObject({ kind: 'css', missing: false });
    expect(byPath.get('assets/fonts/f.woff2')).toMatchObject({
      kind: 'font',
      size: 3,
      missing: false,
    });
    expect(byPath.get('assets/icon.svg')).toMatchObject({ kind: 'image', size: 1 });
    expect(byPath.get('hero.png')).toMatchObject({ kind: 'image', size: 3, missing: false });
    expect(byPath.get('hero.png')?.mtimeMs).toBe(1600000000000);
    expect(byPath.get('hero@2x.png')).toMatchObject({ kind: 'image', size: 1 });
    expect(byPath.get('inline.png')).toMatchObject({ kind: 'image', size: 1 });
    expect(result.skipped).toEqual([]);
  });

  it('records external urls, absolute paths and workspace escapes as skipped references', async () => {
    await writeFile(
      path.join(rootA, 'index.html'),
      [
        '<html><head>',
        '<link rel="stylesheet" href="https://cdn.example.com/site.css">',
        '</head><body>',
        '<img src="data:image/png;base64,AAA">',
        '<img src="//cdn.example.com/pixel.png">',
        '<img src="/absolute.png">',
        '<img src="../escape.png">',
        '</body></html>',
      ].join('\n')
    );

    const result = await deps.stat('sa', 'index.html');
    expect(result.files).toEqual([]);
    const reasons = new Map(result.skipped.map(skip => [skip.raw, skip.reason]));
    expect(reasons.get('https://cdn.example.com/site.css')).toBe('external-url');
    expect(reasons.get('data:image/png;base64,AAA')).toBe('external-url');
    expect(reasons.get('//cdn.example.com/pixel.png')).toBe('external-url');
    expect(reasons.get('/absolute.png')).toBe('absolute-path');
    expect(reasons.get('../escape.png')).toBe('escapes-workspace');
  });

  it('marks missing referenced files instead of failing', async () => {
    await writeFile(path.join(rootA, 'here.png'), Buffer.from([1]));
    await writeFile(path.join(rootA, 'index.html'), '<img src="here.png"><img src="missing.png">');

    const result = await deps.stat('sa', 'index.html');
    const byPath = new Map(result.files.map(file => [file.path, file]));
    expect(byPath.get('here.png')).toMatchObject({ kind: 'image', size: 1, missing: false });
    expect(byPath.get('missing.png')).toEqual({
      path: 'missing.png',
      kind: 'image',
      size: null,
      mtimeMs: null,
      missing: true,
    });
  });

  it('skips symlinks that resolve outside the workspace', async () => {
    const outside = path.join(temp, 'outside.png');
    await writeFile(outside, Buffer.from([1, 2]));
    await symlink(outside, path.join(rootA, 'escape.png'));
    await writeFile(path.join(rootA, 'index.html'), '<img src="escape.png"><img src="gone.png">');

    const result = await deps.stat('sa', 'index.html');
    expect(result.skipped).toEqual([{ raw: 'escape.png', reason: 'outside-workspace' }]);
    expect(result.files.map(file => file.path)).toEqual(['gone.png']);
    expect(result.files[0]?.missing).toBe(true);
  });

  it('skips references into private dot-components', async () => {
    await mkdir(path.join(rootA, '.private'));
    await writeFile(path.join(rootA, '.private', 'x.png'), Buffer.from([1]));
    await writeFile(path.join(rootA, 'index.html'), '<img src=".private/x.png">');

    const result = await deps.stat('sa', 'index.html');
    expect(result.files).toEqual([]);
    expect(result.skipped).toEqual([{ raw: '.private/x.png', reason: 'private-path' }]);
  });

  it('truncates at the 200-reference limit and records the dropped paths', async () => {
    const images = Array.from({ length: 205 }, (_, i) => `<img src="r${i}.png">`).join('\n');
    await writeFile(path.join(rootA, 'index.html'), images);

    const result = await deps.stat('sa', 'index.html');
    expect(result.files).toHaveLength(200);
    expect(result.skipped).toEqual(
      Array.from({ length: 5 }, (_, i) => ({ raw: `r${200 + i}.png`, reason: 'resource-limit' }))
    );
  });

  it('stops expanding css imports beyond depth 4 and records the truncation', async () => {
    await writeFile(path.join(rootA, 'index.html'), '<link rel="stylesheet" href="css0.css">');
    for (let i = 0; i < 6; i += 1) {
      await writeFile(path.join(rootA, `css${i}.css`), `@import "css${i + 1}.css";`);
    }

    const result = await deps.stat('sa', 'index.html');
    expect(result.files.map(file => file.path).sort()).toEqual([
      'css0.css',
      'css1.css',
      'css2.css',
      'css3.css',
    ]);
    expect(result.skipped).toEqual([{ raw: 'css4.css', reason: 'resource-limit' }]);
  });

  it('rejects non-html entries, unknown sessions and missing entries', async () => {
    await writeSite(rootA);
    await expect(deps.stat('sa', 'assets/site.css')).rejects.toMatchObject({
      code: 'UNSUPPORTED_FILE',
    });
    await expect(deps.stat('absent', 'index.html')).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
    await expect(deps.stat('sa', 'nope.html')).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
  });
});
