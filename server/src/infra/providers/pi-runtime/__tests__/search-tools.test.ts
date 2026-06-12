import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { createGlobTool, createGrepBridgeTool, createLsBridgeTool, createLspTool } from '../search-tools.js';

describe('search and listing tools', () => {
  it('Glob returns structured relative file matches under the requested path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-glob-module-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 1;');
    await writeFile(path.join(root, 'src', 'b.md'), '# b');
    const glob = createGlobTool(root) as any;

    const result = await glob.execute('glob-1', { pattern: '**/*.ts', path: 'src' });

    const payload = JSON.parse(result.content[0].text);
    expect(result.details).toMatchObject({ ok: true, pattern: '**/*.ts', path: 'src', total: 1 });
    expect(payload.results).toEqual(['src/a.ts']);
  });

  it('Grep returns structured matches with context and glob filtering', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-grep-module-'));
    await writeFile(path.join(root, 'a.ts'), 'alpha\nbeta target\ngamma\n');
    await writeFile(path.join(root, 'b.md'), 'target in markdown\n');
    const grep = createGrepBridgeTool(root) as any;

    const result = await grep.execute('grep-1', {
      pattern: 'target',
      include: '*.ts',
      context: 1,
      max_results: 10,
    });

    const payload = JSON.parse(result.content[0].text);
    expect(result.details).toMatchObject({ ok: true, pattern: 'target', total: 3, context: 1 });
    expect(payload.results.map((entry: any) => entry.file)).toEqual(['a.ts', 'a.ts', 'a.ts']);
    expect(payload.results.some((entry: any) => entry.isMatch)).toBe(true);
  });

  it('LS lists entries alphabetically with a trailing slash on directories', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-ls-module-'));
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'b.txt'), 'b');
    await writeFile(path.join(root, 'a.txt'), 'a');
    const ls = createLsBridgeTool(root) as any;

    const result = await ls.execute('ls-1', {});

    expect(result.content[0].text.split('\n')).toEqual(['a.txt', 'b.txt', 'src/']);
    expect(result.details).toMatchObject({ ok: true, path: '.', total: 3, truncated: false });
  });

  it('LSPTool returns structured ripgrep fallback results', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-lsp-module-'));
    await writeFile(path.join(root, 'symbols.ts'), 'export function targetSymbol() {}\n');
    const lsp = createLspTool(root) as any;

    const result = await lsp.execute('lsp-1', { action: 'symbols', query: 'targetSymbol', include: '*.ts' });

    const payload = JSON.parse(result.content[0].text);
    expect(result.details).toMatchObject({ ok: true, action: 'symbols', query: 'targetSymbol', fallback: 'ripgrep', total: 1 });
    expect(payload.results[0]).toMatchObject({ file: 'symbols.ts', line: 1 });
  });
});
