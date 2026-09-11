import { describe, expect, it } from 'vitest';
import { boundedToolInput, truncateUtf8 } from '../text-budget.js';
import { cleanEffectPath, makeFileChangeEffect, makeShellEffect } from '../tool-effects.js';

describe('shared event normalization helpers', () => {
  it('truncates on UTF-8 boundaries and keeps both ends', () => {
    const result = truncateUtf8(`start-${'你'.repeat(100)}-end`, 64);
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(64);
    expect(result).toContain('[truncated]');
    expect(result.endsWith('-end')).toBe(true);
  });

  it('bounds oversized tool inputs', () => {
    expect(boundedToolInput({ text: 'x'.repeat(100) }, 32)).toMatchObject({
      _truncated: true,
    });
  });

  it('normalizes shell and file effects consistently', () => {
    expect(makeShellEffect('  pnpm test  ')).toEqual({ kind: 'shell', command: 'pnpm test' });
    expect(cleanEffectPath('"b/src/main.ts"\tmetadata')).toBe('src/main.ts');
    expect(
      makeFileChangeEffect([
        { path: '/dev/null', changeKind: 'delete' },
        { path: 'a/src/main.ts', changeKind: 'modify' },
      ])
    ).toEqual({
      kind: 'file_change',
      files: [{ path: 'src/main.ts', changeKind: 'modify' }],
    });
  });
});
