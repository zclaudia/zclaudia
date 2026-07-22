import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import {
  createGlobTool,
  createGrepBridgeTool,
  createLsBridgeTool,
  createLspTool,
} from '../search-tools.js';

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

  it('Grep treats option-like patterns as search text', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-grep-options-'));
    await writeFile(path.join(root, 'a.ts'), 'plain beta only\n');
    const grep = createGrepBridgeTool(root) as any;

    const result = await grep.execute('grep-option-pattern', {
      pattern: '--regexp=beta',
      max_results: 10,
    });

    const payload = JSON.parse(result.content[0].text);
    expect(result.details).toMatchObject({ ok: true, pattern: '--regexp=beta', total: 0 });
    expect(payload.results).toEqual([]);
  });

  it('Grep returns file paths for content and count searches scoped to one file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-grep-single-file-'));
    await writeFile(path.join(root, 'single.ts'), 'target line\nother\n');
    const grep = createGrepBridgeTool(root) as any;

    const contentResult = await grep.execute('grep-single-content', {
      pattern: 'target',
      path: 'single.ts',
    });
    const countResult = await grep.execute('grep-single-count', {
      pattern: 'target',
      path: 'single.ts',
      output_mode: 'count',
    });

    const contentPayload = JSON.parse(contentResult.content[0].text);
    const countPayload = JSON.parse(countResult.content[0].text);
    expect(contentPayload.results).toEqual([
      expect.objectContaining({
        file: 'single.ts',
        line: 1,
        preview: 'target line',
        isMatch: true,
      }),
    ]);
    expect(countPayload.counts).toEqual([{ file: 'single.ts', count: 1 }]);
  });

  it('Grep keeps the matching line when context output is capped', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-grep-context-cap-'));
    await writeFile(path.join(root, 'a.ts'), 'before\ntarget\nafter\n');
    const grep = createGrepBridgeTool(root) as any;

    const result = await grep.execute('grep-context-cap', {
      pattern: 'target',
      context: 1,
      max_results: 1,
    });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.results.some((entry: any) => entry.preview === 'target' && entry.isMatch)).toBe(
      true
    );
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

  it('LS reports the full entry count when output is truncated', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-ls-truncated-'));
    await writeFile(path.join(root, 'a.txt'), 'a');
    await writeFile(path.join(root, 'b.txt'), 'b');
    await writeFile(path.join(root, 'c.txt'), 'c');
    const ls = createLsBridgeTool(root) as any;

    const result = await ls.execute('ls-truncated', { limit: 2 });

    expect(result.content[0].text.split('\n')).toEqual(['a.txt', 'b.txt']);
    expect(result.details).toMatchObject({
      ok: true,
      path: '.',
      total: 3,
      returned: 2,
      truncated: true,
    });
  });

  it('Glob reports full match count and truncation in the payload', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-glob-truncated-'));
    await writeFile(path.join(root, 'a.ts'), 'a');
    await writeFile(path.join(root, 'b.ts'), 'b');
    const glob = createGlobTool(root) as any;

    const result = await glob.execute('glob-truncated', {
      pattern: '*.ts',
      max_results: 1,
    });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.results).toHaveLength(1);
    expect(payload).toMatchObject({ total: 2, returned: 1, truncated: true });
    expect(result.details).toMatchObject({ ok: true, total: 2, returned: 1, truncated: true });
  });

  it('LSPTool returns structured ripgrep fallback results', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-lsp-module-'));
    await writeFile(path.join(root, 'symbols.ts'), 'export function targetSymbol() {}\n');
    const lsp = createLspTool(root) as any;

    const result = await lsp.execute('lsp-1', {
      action: 'symbols',
      query: 'targetSymbol',
      include: '*.ts',
    });

    const payload = JSON.parse(result.content[0].text);
    expect(result.details).toMatchObject({
      ok: true,
      action: 'symbols',
      query: 'targetSymbol',
      fallback: 'ripgrep',
      total: 1,
    });
    expect(payload.results[0]).toMatchObject({ file: 'symbols.ts', line: 1 });
  });

  it('Grep parses dashed-numeric filenames correctly in context mode', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-grep-dashed-'));
    await writeFile(path.join(root, 'report-2024-01.ts'), 'before ctx\ntarget line\nafter ctx\n');
    const grep = createGrepBridgeTool(root) as any;

    const result = await grep.execute('grep-dashed', {
      pattern: 'target',
      context: 1,
      max_results: 10,
    });

    const payload = JSON.parse(result.content[0].text);
    expect(result.details).toMatchObject({ ok: true, total: 3 });
    expect(payload.results).toEqual([
      { file: 'report-2024-01.ts', line: 1, preview: 'before ctx', isMatch: false },
      { file: 'report-2024-01.ts', line: 2, preview: 'target line', isMatch: true },
      { file: 'report-2024-01.ts', line: 3, preview: 'after ctx', isMatch: false },
    ]);
  });

  it('Grep preserves significant leading whitespace in the pattern', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-grep-ws-'));
    await writeFile(path.join(root, 'a.py'), 'def foo\ndef foo\n    def foo\n');
    const grep = createGrepBridgeTool(root) as any;

    const result = await grep.execute('grep-ws', { pattern: '    def foo' });

    const payload = JSON.parse(result.content[0].text);
    expect(result.details).toMatchObject({ ok: true, pattern: '    def foo', total: 1 });
    expect(payload.results).toEqual([
      expect.objectContaining({ file: 'a.py', line: 3, isMatch: true }),
    ]);
  });

  it('Grep returns a structured grep_failed error for an invalid regex', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-grep-bad-'));
    await writeFile(path.join(root, 'a.ts'), 'x\n');
    const grep = createGrepBridgeTool(root) as any;

    const result = await grep.execute('grep-bad', { pattern: '(unclosed' });

    expect(result.details).toMatchObject({ ok: false, error: 'grep_failed' });
  });

  it('LSPTool matches regex metacharacters literally instead of rejecting', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-lsp-literal-'));
    await writeFile(
      path.join(root, 'symbols.ts'),
      'export function target(name) { return target(1); }\n'
    );
    const lsp = createLspTool(root) as any;

    const result = await lsp.execute('lsp-literal', { action: 'definition', query: 'target(' });

    const payload = JSON.parse(result.content[0].text);
    expect(result.details).toMatchObject({ ok: true, total: 1 });
    expect(payload.results).toEqual([
      expect.objectContaining({ file: 'symbols.ts', line: 1 }),
    ]);
  });

  it('LSPTool reports a missing query with ok:false', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-lsp-missing-'));
    const lsp = createLspTool(root) as any;

    const result = await lsp.execute('lsp-missing', { action: 'symbols' });

    expect(result.details).toMatchObject({ ok: false, error: 'missing_query' });
  });

  it('LSPTool returns a structured error when ripgrep fails', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-lsp-fail-'));
    const lsp = createLspTool(root) as any;

    const result = await lsp.execute('lsp-fail', { query: 'q', path: 'does-not-exist' });

    expect(result.details).toMatchObject({ ok: false, error: 'lsp_search_failed' });
  });
});
