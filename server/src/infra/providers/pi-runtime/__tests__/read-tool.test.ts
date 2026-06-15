import { describe, expect, it } from 'vitest';
import { mkdtemp, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { createReadBridgeTool } from '../read-tool.js';

describe('Read bridge tool module', () => {
  it('supports line offset and limit with structured details', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-module-'));
    await writeFile(path.join(root, 'sample.ts'), ['one', 'two', 'three', 'four'].join('\n'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'sample.ts', offset: 2, limit: 2 });

    expect(result.details).toMatchObject({
      ok: true,
      path: 'sample.ts',
      offset: 2,
      limit: 2,
      totalLines: 4,
      returnedLines: 2,
    });
    expect(result.content[0].text).toContain('2|two');
    expect(result.content[0].text).toContain('3|three');
    expect(result.content[0].text).not.toContain('1|one');
  });

  it('appends an end-of-file footer when the whole file is returned', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-footer-full-'));
    await writeFile(path.join(root, 'sample.ts'), ['one', 'two', 'three'].join('\n'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'sample.ts' });

    expect(result.details).toMatchObject({ totalLines: 3, returnedLines: 3 });
    expect(result.content[0].text).toContain('[End of file — all 3 lines shown.]');
  });

  it('tells the model how many lines remain and where to continue', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-footer-partial-'));
    const lines = Array.from({ length: 50 }, (_, i) => `line${i + 1}`);
    await writeFile(path.join(root, 'big.ts'), lines.join('\n'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'big.ts', offset: 1, limit: 10 });

    expect(result.details).toMatchObject({ totalLines: 50, returnedLines: 10 });
    expect(result.content[0].text).toContain('Showing lines 1-10 of 50. 40 more lines below — call Read again with offset=11 to continue.');
  });

  it('defaults to reading up to 2000 lines in one call', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-default-limit-'));
    const lines = Array.from({ length: 300 }, (_, i) => `line${i + 1}`);
    await writeFile(path.join(root, 'medium.ts'), lines.join('\n'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'medium.ts' });

    expect(result.details).toMatchObject({ totalLines: 300, returnedLines: 300 });
    expect(result.content[0].text).toContain('300|line300');
  });

  it('can return hashline anchors for content-addressed edits', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-hash-module-'));
    await writeFile(path.join(root, 'sample.ts'), 'const a = 1;\nconst b = 2;\n');
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-hashline', { path: 'sample.ts', hashline: true });

    expect(result.details.hashline).toMatchObject({ path: 'sample.ts' });
    expect(result.details.hashline.snapshotId).toEqual(expect.any(String));
    expect(result.details.hashline.lines[0]).toMatchObject({ line: 1, text: 'const a = 1;' });
    expect(result.content[0].text).toContain('[sample.ts#');
    expect(result.content[0].text).toMatch(/[a-f0-9]{12}\|const a = 1;/);
  });

  it('rejects binary non-image files with a structured error', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-bin-module-'));
    await writeFile(path.join(root, 'blob.bin'), Buffer.from([0, 1, 2, 3]));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'blob.bin' });

    expect(result.details).toMatchObject({ ok: false, error: 'binary_file' });
    expect(result.content[0].text).toContain('Refusing to read binary file');
  });

  it('rejects symlinks that resolve outside the workspace', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-symlink-root-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-symlink-outside-'));
    await writeFile(path.join(outside, 'secret.txt'), 'outside\n');
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-symlink', { path: 'link.txt' });

    expect(result.details).toMatchObject({ ok: false, error: 'path_outside_workspace' });
  });

  it('returns a text notice for images when the model lacks vision', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-img-module-'));
    await writeFile(path.join(root, 'tiny.png'), Buffer.from('not-real-image'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'tiny.png' });

    expect(result.details).toMatchObject({ ok: false, path: 'tiny.png', mimeType: 'image/png' });
    expect(result.content[0].text).toContain('current model does not support vision');
  });
});
