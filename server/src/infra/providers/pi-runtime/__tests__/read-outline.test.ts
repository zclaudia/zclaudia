import { describe, expect, it } from 'vitest';
import { getOutlineProvider } from '../read-outline.js';

describe('read-outline AST provider (JS/TS)', () => {
  it('folds a function body whose interior is >= 4 lines, keeping signature and braces', async () => {
    const provider = getOutlineProvider('.ts')!;
    expect(provider.kind).toBe('ast');
    const code = [
      'export function handle(x: number): number {',
      '  const a = x + 1;',
      '  const b = a * 2;',
      '  const c = b - 3;',
      '  return c;',
      '}',
    ].join('\n');
    const folds = await provider.findFolds(code, 'f.ts');
    expect(folds).toEqual([{ startLine: 2, endLine: 5 }]);
  });

  it('does not fold a body whose interior is < 4 lines', async () => {
    const provider = getOutlineProvider('.ts')!;
    const code = 'function f() {\n  return 1;\n}\n';
    expect(await provider.findFolds(code, 'f.ts')).toEqual([]);
  });

  it('folds only the outermost body (no nested folds)', async () => {
    const provider = getOutlineProvider('.ts')!;
    const code = [
      'function outer() {',
      '  if (true) {',
      '    const a = 1;',
      '    const b = 2;',
      '    const c = 3;',
      '  }',
      '  return 0;',
      '}',
    ].join('\n');
    const folds = await provider.findFolds(code, 'f.ts');
    expect(folds).toEqual([{ startLine: 2, endLine: 7 }]);
  });

  it('returns ast for .tsx and undefined for unknown extensions', () => {
    expect(getOutlineProvider('.tsx')?.kind).toBe('ast');
    expect(getOutlineProvider('.txt')).toBeUndefined();
    expect(getOutlineProvider('.json')).toBeUndefined();
  });
});

describe('read-outline heuristic providers', () => {
  it('folds a brace-family body (Go) by brace depth', async () => {
    const provider = getOutlineProvider('.go')!;
    expect(provider.kind).toBe('heuristic');
    const code = [
      'func handle(x int) int {',
      '\ta := x + 1',
      '\tb := a * 2',
      '\tc := b - 3',
      '\treturn c',
      '}',
    ].join('\n');
    expect(await provider.findFolds(code, 'h.go')).toEqual([{ startLine: 2, endLine: 5 }]);
  });

  it('folds an indent-family body (Python) by indentation', async () => {
    const provider = getOutlineProvider('.py')!;
    expect(provider.kind).toBe('heuristic');
    const code = [
      'def handle(x):',
      '    a = x + 1',
      '    b = a * 2',
      '    c = b - 3',
      '    return c',
      '',
      'y = 1',
    ].join('\n');
    expect(await provider.findFolds(code, 'h.py')).toEqual([{ startLine: 2, endLine: 5 }]);
  });

  it('does not fold short heuristic bodies', async () => {
    const provider = getOutlineProvider('.go')!;
    const code = 'func f() {\n\treturn 1\n}\n';
    expect(await provider.findFolds(code, 'f.go')).toEqual([]);
  });
});
