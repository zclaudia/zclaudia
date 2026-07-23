import { describe, expect, it } from 'vitest';

import { extractTouchedPaths, extractToolPathParam } from '../tool-execution-observer.js';
import { ToolCallTelemetry } from '../tool-telemetry.js';

describe('extractTouchedPaths', () => {
  it('extracts the file path from read/mutate/search tool args', () => {
    expect(extractTouchedPaths('Read', { path: 'src/a.ts' })).toEqual(['src/a.ts']);
    expect(extractTouchedPaths('Edit', { file_path: 'src/b.ts' })).toEqual(['src/b.ts']);
    expect(extractTouchedPaths('MultiEdit', { file_path: 'src/c.ts' })).toEqual(['src/c.ts']);
    expect(extractTouchedPaths('Write', { path: 'src/d.ts' })).toEqual(['src/d.ts']);
    expect(extractTouchedPaths('Grep', { path: 'src' })).toEqual(['src']);
    expect(extractTouchedPaths('Glob', { path: 'src' })).toEqual(['src']);
    expect(extractTouchedPaths('LS', { path: 'src' })).toEqual(['src']);
  });

  it('extracts the AstEdit mutation path (P2-6: skill activation was under-firing)', () => {
    expect(extractTouchedPaths('AstEdit', { pattern: 'foo($A)', path: 'src/x.ts' })).toEqual([
      'src/x.ts',
    ]);
  });

  it('extracts the AstGrep search root', () => {
    expect(extractTouchedPaths('AstGrep', { pattern: 'foo($A)', path: 'src' })).toEqual(['src']);
  });

  it('derives the session worktree path from the EnterWorktree name', () => {
    expect(extractTouchedPaths('EnterWorktree', { name: 'Refactor Auth' })).toEqual([
      '.worktrees/sessions/refactor-auth',
    ]);
  });

  it('returns no path for ExitWorktree (its target is session state, not args)', () => {
    expect(extractTouchedPaths('ExitWorktree', { action: 'remove' })).toEqual([]);
  });

  it('returns no path for tools without one and for blank values', () => {
    expect(extractTouchedPaths('Bash', { command: 'ls' })).toEqual([]);
    expect(extractTouchedPaths('Read', { path: '   ' })).toEqual([]);
    expect(extractTouchedPaths('Read', {})).toEqual([]);
  });
});

describe('extractToolPathParam', () => {
  it('prefers `path` and falls back through file_path / filePath', () => {
    expect(extractToolPathParam('Edit', { path: 'p', file_path: 'fp', filePath: 'fP' })).toBe('p');
    expect(extractToolPathParam('Edit', { file_path: 'fp', filePath: 'fP' })).toBe('fp');
    expect(extractToolPathParam('Edit', { filePath: 'fP' })).toBe('fP');
  });

  it('trims surrounding whitespace', () => {
    expect(extractToolPathParam('Read', { path: '  src/a.ts  ' })).toBe('src/a.ts');
  });
});

describe('telemetry path consistency (P2-6)', () => {
  it('telemetry keys repeated reads/mutations by the same path the observer reports', () => {
    const telemetry = new ToolCallTelemetry();
    telemetry.record('Read', { path: 'src/app.ts' }, { content: [], details: { ok: true } });
    telemetry.record('Read', { path: 'src/app.ts' }, { content: [], details: { ok: true } });
    telemetry.record('Edit', { file_path: 'src/app.ts' }, { content: [], details: { ok: true } });
    telemetry.record('Edit', { file_path: 'src/app.ts' }, { content: [], details: { ok: true } });

    expect(extractTouchedPaths('Read', { path: 'src/app.ts' })).toEqual(['src/app.ts']);
    expect(extractTouchedPaths('Edit', { file_path: 'src/app.ts' })).toEqual(['src/app.ts']);
    expect(telemetry.snapshot()).toMatchObject({
      repeatedReads: { 'src/app.ts': 2 },
      repeatedMutations: { 'src/app.ts': 2 },
    });
  });
});
