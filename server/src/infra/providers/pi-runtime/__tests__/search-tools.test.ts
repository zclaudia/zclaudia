import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { createGlobTool, createGrepBridgeTool, createLsBridgeTool } from '../search-tools.js';

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
    // total counts match lines only (1); returned counts all rows incl. context (3).
    expect(result.details).toMatchObject({
      ok: true,
      pattern: 'target',
      total: 1,
      returned: 3,
      context: 1,
    });
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

  it('Grep multiline matches patterns that span line boundaries', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-grep-multiline-'));
    await writeFile(path.join(root, 'a.ts'), 'start\nmiddle end\n');
    const grep = createGrepBridgeTool(root) as any;

    const withoutMultiline = await grep.execute('grep-ml-off', {
      pattern: 'start.middle',
      multiline: false,
    });
    const withMultiline = await grep.execute('grep-ml-on', {
      pattern: 'start.middle',
      multiline: true,
    });

    expect(JSON.parse(withoutMultiline.content[0].text).total).toBe(0);
    // In multiline mode rg emits one numbered row per physical line of the
    // matched region, so a two-line region reports two match rows.
    const payload = JSON.parse(withMultiline.content[0].text);
    expect(withMultiline.details).toMatchObject({ ok: true, total: 2 });
    expect(payload.results).toEqual([
      expect.objectContaining({ file: 'a.ts', line: 1, preview: 'start', isMatch: true }),
      expect.objectContaining({ file: 'a.ts', line: 2, preview: 'middle end', isMatch: true }),
    ]);
  });

  it('Grep type filters files by ripgrep file type', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-grep-type-'));
    await writeFile(path.join(root, 'code.js'), 'target in js\n');
    await writeFile(path.join(root, 'note.md'), 'target in md\n');
    const grep = createGrepBridgeTool(root) as any;

    const result = await grep.execute('grep-type-js', { pattern: 'target', type: 'js' });

    const payload = JSON.parse(result.content[0].text);
    expect(result.details).toMatchObject({ ok: true, total: 1 });
    expect(payload.results.map((entry: any) => entry.file)).toEqual(['code.js']);
  });

  it('Grep surfaces an unknown type name as a structured grep_failed error', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-grep-bad-type-'));
    await writeFile(path.join(root, 'a.ts'), 'x\n');
    const grep = createGrepBridgeTool(root) as any;

    const result = await grep.execute('grep-bad-type', { pattern: 'x', type: 'nosuchtype' });

    expect(result.details).toMatchObject({ ok: false, error: 'grep_failed' });
    expect(result.content[0].text).toContain('unrecognized file type');
  });

  it('Grep offset skips the first N match lines before applying max_results', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-grep-offset-'));
    await writeFile(path.join(root, 'a.ts'), 'm1\nm2\nm3\nm4\n');
    const grep = createGrepBridgeTool(root) as any;

    const all = await grep.execute('grep-offset-all', { pattern: 'm\\d', max_results: 10 });
    const paged = await grep.execute('grep-offset-page', {
      pattern: 'm\\d',
      max_results: 2,
      offset: 2,
    });

    expect(JSON.parse(all.content[0].text).results.map((r: any) => r.preview)).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
    ]);
    const payload = JSON.parse(paged.content[0].text);
    expect(paged.details).toMatchObject({ ok: true, offset: 2 });
    expect(payload.results.map((r: any) => r.preview)).toEqual(['m3', 'm4']);
    expect(payload.offset).toBe(2);
    expect(payload.nextOffset).toBe(4);
  });

  it('Grep offset skips whole match groups in context mode', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-grep-offset-ctx-'));
    await writeFile(path.join(root, 'a.ts'), 'c1\nm1\nc2\nm2\nc3\n');
    const grep = createGrepBridgeTool(root) as any;

    const result = await grep.execute('grep-offset-ctx', {
      pattern: 'm\\d',
      context: 1,
      offset: 1,
      max_results: 10,
    });

    const payload = JSON.parse(result.content[0].text);
    // The first match group (c1/m1/c2) is skipped whole; the second group starts at m2.
    expect(payload.results[0]).toEqual(
      expect.objectContaining({ file: 'a.ts', line: 4, preview: 'm2', isMatch: true })
    );
    expect(result.details).toMatchObject({ ok: true, offset: 1 });
  });

  it('Grep multiline and type combine with files_with_matches and count modes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-grep-modes-'));
    await writeFile(path.join(root, 'a.js'), 'alpha\nbeta\n');
    await writeFile(path.join(root, 'b.md'), 'alpha\nbeta\n');
    const grep = createGrepBridgeTool(root) as any;

    const filesResult = await grep.execute('grep-mode-files', {
      pattern: 'alpha.beta',
      multiline: true,
      type: 'js',
      output_mode: 'files_with_matches',
    });
    const countResult = await grep.execute('grep-mode-count', {
      pattern: 'alpha.beta',
      multiline: true,
      type: 'js',
      output_mode: 'count',
    });

    expect(JSON.parse(filesResult.content[0].text).files).toEqual(['a.js']);
    expect(JSON.parse(countResult.content[0].text).counts).toEqual([
      expect.objectContaining({ file: 'a.js', count: 1 }),
    ]);
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
    expect(result.details).toMatchObject({ ok: true, total: 1, returned: 3 });
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

  it('Grep content mode reports match-line count as total and all rows as returned', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-grep-total-'));
    await writeFile(path.join(root, 'a.ts'), 'one\ntarget\ntwo\ntarget\nthree\n');
    const grep = createGrepBridgeTool(root) as any;

    const result = await grep.execute('grep-total', { pattern: 'target', context: 1 });

    const payload = JSON.parse(result.content[0].text);
    // 2 match lines; 5 emitted rows (context of the two matches overlaps).
    expect(payload.total).toBe(2);
    expect(payload.returned).toBe(5);
    expect(result.details).toMatchObject({ total: 2, returned: 5 });
    expect(payload.results.filter((entry: any) => entry.isMatch)).toHaveLength(2);
  });

  it('LS marks symlinked directories with a slash and dangling symlinks without', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-ls-links-'));
    await mkdir(path.join(root, 'real-dir'));
    await writeFile(path.join(root, 'plain.txt'), 'x');
    await symlink(path.join(root, 'real-dir'), path.join(root, 'dir-link'));
    await symlink(path.join(root, 'no-such-target'), path.join(root, 'broken-link'));
    const ls = createLsBridgeTool(root) as any;

    const result = await ls.execute('ls-links', {});

    expect(result.content[0].text.split('\n')).toEqual([
      'broken-link',
      'dir-link/',
      'plain.txt',
      'real-dir/',
    ]);
    expect(result.details).toMatchObject({ ok: true, total: 4, returned: 4, truncated: false });
  });
});
