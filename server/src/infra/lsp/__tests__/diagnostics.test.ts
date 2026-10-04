import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'url';
import { DiagnosticsStore, introducedDiagnostics, mapDiagnostics } from '../diagnostics.js';
import type { LspDiagnostic } from '../types.js';

const root = '/work/proj';
const file = '/work/proj/src/a.ts';
const uri = pathToFileURL(file).href;

function publish(store: DiagnosticsStore, messages: string[]) {
  store.handlePublish({
    uri,
    diagnostics: messages.map((message, line) => ({
      range: { start: { line, character: 0 } },
      severity: 1,
      message,
    })),
  });
}

function diag(message: string, overrides: Partial<LspDiagnostic> = {}): LspDiagnostic {
  return { file: 'a.ts', line: 1, character: 1, severity: 'error', message, ...overrides };
}

describe('mapDiagnostics', () => {
  it('converts to 1-based, workspace-relative diagnostics', () => {
    const [mapped] = mapDiagnostics(root, file, [
      {
        range: { start: { line: 4, character: 2 } },
        severity: 2,
        message: 'm',
        source: 'ts',
        code: { value: 'X1' },
      },
    ]);
    expect(mapped).toEqual({
      file: 'src/a.ts',
      line: 5,
      character: 3,
      severity: 'warning',
      message: 'm',
      source: 'ts',
      code: 'X1',
    });
  });

  it('never escalates a missing severity to error', () => {
    expect(mapDiagnostics(root, file, [{ message: 'm' }])[0].severity).toBe('information');
  });
});

describe('DiagnosticsStore.waitForPublishAfter', () => {
  it('waits for the publishes to settle and serves the last one', async () => {
    const store = new DiagnosticsStore(root);
    const mark = store.mark(file);
    const waiting = store.waitForPublishAfter(file, mark, { budgetMs: 500, settleMs: 30 });
    publish(store, ['syntax only']);
    setTimeout(() => publish(store, ['syntax', 'semantic']), 10);
    const result = await waiting;
    expect(result?.map(d => d.message)).toEqual(['syntax', 'semantic']);
  });

  it('returns null, not an empty list, when nothing arrives in budget', async () => {
    const store = new DiagnosticsStore(root);
    expect(await store.waitForPublishAfter(file, 0, { budgetMs: 20, settleMs: 5 })).toBeNull();
  });

  it('ignores publishes from before the mark', async () => {
    const store = new DiagnosticsStore(root);
    publish(store, ['stale']);
    const mark = store.mark(file);
    expect(await store.waitForPublishAfter(file, mark, { budgetMs: 20, settleMs: 5 })).toBeNull();
  });

  it('serves a fresh publish when the budget ends mid-settle', async () => {
    const store = new DiagnosticsStore(root);
    const waiting = store.waitForPublishAfter(file, 0, { budgetMs: 20, settleMs: 1000 });
    publish(store, ['fresh']);
    expect((await waiting)?.map(d => d.message)).toEqual(['fresh']);
  });

  it('resolves null when aborted', async () => {
    const store = new DiagnosticsStore(root);
    const controller = new AbortController();
    const waiting = store.waitForPublishAfter(file, 0, {
      budgetMs: 1000,
      signal: controller.signal,
    });
    controller.abort();
    expect(await waiting).toBeNull();
  });
});

describe('introducedDiagnostics', () => {
  it('reports only what the change added, ignoring line shifts', () => {
    const before = [diag('old', { line: 3 }), diag('dup'), diag('dup')];
    const after = [diag('old', { line: 9 }), diag('dup'), diag('dup'), diag('dup'), diag('new')];
    expect(introducedDiagnostics(before, after).map(d => d.message)).toEqual(['dup', 'new']);
  });

  it('treats a different code or severity as a different diagnostic', () => {
    const before = [diag('m', { code: 1 })];
    const after = [diag('m', { code: 2 }), diag('m', { code: 1, severity: 'warning' })];
    expect(introducedDiagnostics(before, after)).toHaveLength(2);
  });
});
