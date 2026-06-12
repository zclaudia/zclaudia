import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'fs/promises';
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

  it('returns a text notice for images when the model lacks vision', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-read-img-module-'));
    await writeFile(path.join(root, 'tiny.png'), Buffer.from('not-real-image'));
    const read = createReadBridgeTool(root) as any;

    const result = await read.execute('read-1', { path: 'tiny.png' });

    expect(result.details).toMatchObject({ ok: false, path: 'tiny.png', mimeType: 'image/png' });
    expect(result.content[0].text).toContain('current model does not support vision');
  });
});
