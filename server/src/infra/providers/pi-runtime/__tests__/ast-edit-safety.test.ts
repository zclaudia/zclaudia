import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type * as textIo from '../text-io.js';

// Simulate a concurrent writer for the stale-content test: the in-lock re-read
// (second read of the target file) reports different content than the first.
vi.mock('../text-io.js', async importOriginal => {
  const actual = await importOriginal<typeof textIo>();
  const reads = new Map<string, number>();
  return {
    ...actual,
    readTextFileWithMetadata: async (filePath: string) => {
      const meta = await actual.readTextFileWithMetadata(filePath);
      if (filePath.endsWith('stale-target.ts')) {
        const count = (reads.get(filePath) ?? 0) + 1;
        reads.set(filePath, count);
        if (count > 1) {
          return { ...meta, content: 'console.log("changed by someone else");\n' };
        }
      }
      return meta;
    },
  };
});

import { createAstEditTool } from '../ast-bridge-tools.js';

describe('AstEdit safety guards', () => {
  it('refuses to write when the file changes between read and write lock', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-ast-stale-'));
    writeFileSync(path.join(dir, 'stale-target.ts'), 'console.log("original");\n');
    const edit = createAstEditTool(dir) as any;

    const result = await edit.execute('e-stale', {
      pattern: 'console.log($ARG)',
      rewrite: 'logger.info($ARG)',
      path: 'stale-target.ts',
    });
    const onDisk = readFileSync(path.join(dir, 'stale-target.ts'), 'utf8');
    rmSync(dir, { recursive: true, force: true });

    expect(result.details.ok).toBe(false);
    expect(result.details.error).toBe('file_changed_during_edit');
    expect(onDisk).toBe('console.log("original");\n');
  });

  it('refuses rewrites that introduce secret-looking content', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-ast-secret-'));
    writeFileSync(path.join(dir, 'a.ts'), 'console.log("x");\n');
    const edit = createAstEditTool(dir) as any;

    const result = await edit.execute('e-secret', {
      pattern: 'console.log($ARG)',
      rewrite: 'console.log($ARG)\nconst key = "-----BEGIN PRIVATE KEY-----"',
      path: 'a.ts',
    });
    const onDisk = readFileSync(path.join(dir, 'a.ts'), 'utf8');
    rmSync(dir, { recursive: true, force: true });

    expect(result.details.ok).toBe(false);
    expect(result.details.error).toBe('secret_detected');
    expect(onDisk).toBe('console.log("x");\n');
  });

  it('truncates huge multi-file diffs and appends a per-file hunk summary', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-ast-bigdiff-'));
    const fileCount = 12;
    for (let i = 0; i < fileCount; i += 1) {
      const lines = Array.from(
        { length: 100 },
        (_, j) => `console.log("value-${j}-padding-padding-padding");`
      );
      writeFileSync(path.join(dir, `f${i}.ts`), `${lines.join('\n')}\n`);
    }
    const edit = createAstEditTool(dir) as any;

    const result = await edit.execute('e-big', {
      pattern: 'console.log($ARG)',
      rewrite: 'logger.info($ARG)',
      dry_run: true,
    });
    rmSync(dir, { recursive: true, force: true });

    expect(result.details.ok).toBe(true);
    expect(result.details.replaced).toBe(fileCount * 100);
    expect(result.details.diffTruncated).toBe(true);
    expect(result.details.diff).toContain('[diff truncated');
    expect(result.details.diff).toContain('f11.ts: 1 hunk(s), +100/-100');
    expect(String(result.details.diff).length).toBeLessThan(90_000);
  });
});
