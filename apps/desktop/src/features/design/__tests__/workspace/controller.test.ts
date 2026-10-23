import { describe, expect, it, vi } from 'vitest';
import {
  DesignWorkspaceController,
  MAX_OPEN_PAGES,
  acquireWorkspaceController,
  workspaceIdentityKey,
} from '../../workspace/controller';
import { workspaceUiStorageKey } from '../../workspace/storage';
import { sha256HexSync } from '../../html/hash';
import type { DesignDepsResult, DesignDependencyStat, DesignDocument, DesignSelection } from '../../types';
import type { DesignWorkspacePorts } from '../../workspace/ports';

const sha = (source: string): string => sha256HexSync(source);

const pageSource = (text: string): string => `<html><body><h1>${text}</h1></body></html>`;
const editSource = (text: string): string => `<html><body><h1>${text}</h1></body></html>`;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface PutRecord {
  sessionId: string;
  path: string;
  source: string;
  expectedRevision: string;
  allowCreate?: boolean;
}

/**
 * Fake ports bound to an in-memory disk map. `gate`/`gatePut` defer exactly
 * one getDocument/putDocument call so tests can hold requests in flight.
 */
function createHarness() {
  const docs = new Map<string, { source: string; revision: string }>();
  const gets: string[] = [];
  const puts: PutRecord[] = [];
  const snapshotCalls: Array<{ sessionId: string; path: string; source: string }> = [];
  const getSessions: string[] = [];
  const getGates = new Map<string, Array<Deferred<DesignDocument>>>();
  const putGates = new Map<string, Array<Deferred<void>>>();
  let depsResult: DesignDepsResult = {
    entry: { path: '', size: 0, mtimeMs: 0 },
    files: [],
    skipped: [],
  };
  let revisionCounter = 0;
  let sessionLabel = 's1';

  const backend: DesignWorkspacePorts = {
    getDocument: async path => {
      gets.push(path);
      const gate = getGates.get(path)?.shift();
      if (gate) return gate.promise;
      const doc = docs.get(path);
      if (!doc) throw new Error(`FILE_NOT_FOUND: ${path}`);
      return { path, source: doc.source, revision: doc.revision };
    },
    putDocument: async req => {
      const gate = putGates.get(req.path)?.shift();
      if (gate) await gate.promise;
      puts.push({ sessionId: sessionLabel, ...req });
      const current = docs.get(req.path);
      if (!current) {
        if (!req.allowCreate || req.expectedRevision !== '') {
          throw new Error(`FILE_NOT_FOUND: ${req.path}`);
        }
      } else if (req.expectedRevision !== current.revision) {
        throw new Error(
          `revision conflict: expected ${req.expectedRevision} but disk has ${current.revision}`
        );
      }
      const saved = { path: req.path, source: req.source, revision: `saved-${++revisionCounter}` };
      docs.set(req.path, saved);
      return { ...saved };
    },
    listDeps: async () => depsResult,
    createSnapshot: async (path, source) => {
      snapshotCalls.push({ sessionId: sessionLabel, path, source });
      return { captured: true };
    },
    sha256: async source => sha(source),
  };

  return {
    docs,
    gets,
    puts,
    snapshotCalls,
    getSessions,
    getPorts: vi.fn((sessionId: string): DesignWorkspacePorts => {
      getSessions.push(sessionId);
      sessionLabel = sessionId;
      return backend;
    }),
    gate: (path: string): Deferred<DesignDocument> => {
      const pending = deferred<DesignDocument>();
      const queue = getGates.get(path) ?? [];
      queue.push(pending);
      getGates.set(path, queue);
      return pending;
    },
    gatePut: (path: string): Deferred<void> => {
      const pending = deferred<void>();
      const queue = putGates.get(path) ?? [];
      queue.push(pending);
      putGates.set(path, queue);
      return pending;
    },
    setDeps: (result: DesignDepsResult): void => {
      depsResult = result;
    },
  };
}

type Harness = ReturnType<typeof createHarness>;

const pageOf = (controller: DesignWorkspaceController, path: string) => {
  const page = controller.getSnapshot().pages.find(entry => entry.path === path);
  if (!page) throw new Error(`page not open: ${path}`);
  return page;
};

async function open(controller: DesignWorkspaceController, path: string): Promise<void> {
  const result = await controller.open(path);
  expect(result).toEqual({ ok: true });
}

/** Activate the page, set a fresh selection for its current <h1> text and apply one text edit. */
async function editActivePage(
  controller: DesignWorkspaceController,
  path: string,
  to: string,
  mergeKey?: string
): Promise<void> {
  controller.activate(path);
  const page = pageOf(controller, path);
  const from = /<h1>(.*?)<\/h1>/.exec(page.source)?.[1] ?? '';
  controller.handleSelectionMessage({
    elementPath: [0],
    tagName: 'h1',
    text: from,
    sourceText: from,
    base: page.draftRevision,
  });
  const applied = await controller.apply([{ kind: 'text', value: to }], 'edit', mergeKey);
  expect(applied).not.toBeNull();
}

function h1Selection(source: string, text: string): DesignSelection {
  return {
    elementPath: [0],
    tagName: 'h1',
    text,
    sourceText: text,
    base: sha(source),
  };
}

const stat = (path: string, mtimeMs: number, size = 10): DesignDependencyStat => ({
  path,
  kind: 'css',
  size,
  mtimeMs,
  missing: false,
});

const depsResultFor = (entryPath: string, files: DesignDependencyStat[]): DesignDepsResult => ({
  entry: { path: entryPath, size: 100, mtimeMs: 1 },
  files,
  skipped: [],
});

describe('workspaceIdentityKey', () => {
  it('derives a stable 8-hex FNV-1a key that separates identities', () => {
    const key = workspaceIdentityKey({ backendId: 'b1', workingDirectory: '/w' });
    expect(key).toMatch(/^[0-9a-f]{8}$/);
    expect(key).toBe(workspaceIdentityKey({ backendId: 'b1', workingDirectory: '/w' }));
    expect(key).not.toBe(workspaceIdentityKey({ backendId: 'b2', workingDirectory: '/w' }));
    expect(key).not.toBe(workspaceIdentityKey({ backendId: 'b1', workingDirectory: '/other' }));
    // Distinguishes a missing field from an empty-string field.
    expect(workspaceIdentityKey({ backendId: 'b' })).not.toBe(
      workspaceIdentityKey({ backendId: 'b', projectId: '' })
    );
  });
});

describe('DesignWorkspaceController', () => {
  it('opens, edits and saves three pages without cross-talk, per-page expectedRevision', async () => {
    const h = createHarness();
    h.docs.set('p1.html', { source: pageSource('A'), revision: 'rev-a' });
    h.docs.set('p2.html', { source: pageSource('B'), revision: 'rev-b' });
    h.docs.set('p3.html', { source: pageSource('C'), revision: 'rev-c' });
    const c = new DesignWorkspaceController('k', h.getPorts);
    c.rebind('s1');

    await open(c, 'p1.html');
    await open(c, 'p2.html');
    await open(c, 'p3.html');
    expect(c.getSnapshot().pages).toHaveLength(3);
    expect(c.getSnapshot().activePath).toBe('p3.html');

    // Re-opening an existing page only activates it.
    await open(c, 'p2.html');
    expect(c.getSnapshot().pages).toHaveLength(3);
    expect(c.getSnapshot().activePath).toBe('p2.html');

    await editActivePage(c, 'p1.html', 'A!');
    await editActivePage(c, 'p2.html', 'B!');
    await editActivePage(c, 'p3.html', 'C!');

    expect(pageOf(c, 'p1.html').source).toBe(editSource('A!'));
    expect(pageOf(c, 'p2.html').source).toBe(editSource('B!'));
    expect(pageOf(c, 'p3.html').source).toBe(editSource('C!'));
    for (const path of ['p1.html', 'p2.html', 'p3.html']) {
      expect(pageOf(c, path).status).toBe('dirty');
    }

    c.activate('p1.html');
    expect(await c.save()).toBe(true);
    c.activate('p2.html');
    expect(await c.save()).toBe(true);
    c.activate('p3.html');
    expect(await c.save()).toBe(true);

    expect(h.puts).toEqual([
      {
        sessionId: 's1',
        path: 'p1.html',
        source: editSource('A!'),
        expectedRevision: 'rev-a',
      },
      {
        sessionId: 's1',
        path: 'p2.html',
        source: editSource('B!'),
        expectedRevision: 'rev-b',
      },
      {
        sessionId: 's1',
        path: 'p3.html',
        source: editSource('C!'),
        expectedRevision: 'rev-c',
      },
    ]);
    expect(h.snapshotCalls.map(call => [call.path, call.source])).toEqual([
      ['p1.html', 'save'],
      ['p2.html', 'save'],
      ['p3.html', 'save'],
    ]);
    expect(h.docs.get('p1.html')?.source).toBe(editSource('A!'));
    expect(pageOf(c, 'p1.html')).toMatchObject({ status: 'clean', docRevision: 'saved-1' });
    // P1 invariant: the draft stays undoable after a successful save.
    expect(pageOf(c, 'p1.html').canUndo).toBe(true);
  });

  it('keeps undo/redo per page, merges by mergeKey, clears redo and reloads on invalid history', async () => {
    const h = createHarness();
    h.docs.set('p1.html', { source: pageSource('A'), revision: 'rev-1' });
    h.docs.set('p2.html', { source: pageSource('B'), revision: 'rev-1' });
    const c = new DesignWorkspaceController('k', h.getPorts);
    c.rebind('s1');
    await open(c, 'p1.html');
    await open(c, 'p2.html');

    // Two quick edits with the same mergeKey collapse into one undo entry.
    c.activate('p1.html');
    const p1 = pageOf(c, 'p1.html');
    c.handleSelectionMessage(h1Selection(p1.source, 'A'));
    await c.apply([{ kind: 'text', value: 'A1' }], 'edit', 'p1:text');
    await c.apply([{ kind: 'text', value: 'A2' }], 'edit', 'p1:text');
    expect(pageOf(c, 'p1.html')).toMatchObject({ source: editSource('A2'), canUndo: true, canRedo: false });

    await editActivePage(c, 'p2.html', 'B1');
    expect(pageOf(c, 'p2.html').canUndo).toBe(true);

    // Undo acts on the active page only.
    await c.undo();
    expect(pageOf(c, 'p2.html').source).toBe(pageSource('B'));
    expect(pageOf(c, 'p2.html').canRedo).toBe(true);
    expect(pageOf(c, 'p1.html').source).toBe(editSource('A2'));

    // One undo reverts the merged pair back to the original source.
    c.activate('p1.html');
    await c.undo();
    expect(pageOf(c, 'p1.html').source).toBe(pageSource('A'));
    expect(pageOf(c, 'p1.html').canUndo).toBe(false);
    expect(pageOf(c, 'p1.html').canRedo).toBe(true);

    await c.redo();
    expect(pageOf(c, 'p1.html').source).toBe(editSource('A2'));

    // A fresh edit clears the redo stack.
    c.handleSelectionMessage({
      elementPath: [0],
      tagName: 'h1',
      text: 'A2',
      sourceText: 'A2',
      base: pageOf(c, 'p1.html').draftRevision,
    });
    await c.apply([{ kind: 'text', value: 'A3' }], 'edit');
    expect(pageOf(c, 'p1.html').canRedo).toBe(false);

    await c.undo();
    expect(pageOf(c, 'p1.html').source).toBe(editSource('A2'));
    expect(pageOf(c, 'p1.html').canUndo).toBe(true);

    await c.undo();
    expect(pageOf(c, 'p1.html').source).toBe(pageSource('A'));
    expect(pageOf(c, 'p1.html').canUndo).toBe(false);

    // Undo with nothing left forces a reload and surfaces the P1 hint.
    const getsBefore = h.gets.length;
    await c.undo();
    expect(h.gets.length).toBe(getsBefore + 1);
    expect(pageOf(c, 'p1.html')).toMatchObject({
      error: '编辑历史已失效，已重新载入',
      source: pageSource('A'),
      status: 'clean',
      canUndo: false,
      canRedo: false,
    });
  });

  it('flags an external change and keeps the draft when saving conflicts', async () => {
    const h = createHarness();
    h.docs.set('p1.html', { source: pageSource('A'), revision: 'rev-1' });
    const c = new DesignWorkspaceController('k', h.getPorts);
    c.rebind('s1');
    await open(c, 'p1.html');
    await editActivePage(c, 'p1.html', 'A!');

    // The file changes on disk behind the controller's back.
    h.docs.set('p1.html', { source: pageSource('External'), revision: 'rev-external' });

    expect(await c.save()).toBe(false);
    expect(pageOf(c, 'p1.html')).toMatchObject({
      externalChange: true,
      source: editSource('A!'),
      status: 'dirty',
      docRevision: 'rev-1',
    });
    expect(pageOf(c, 'p1.html').error).toContain('revision conflict');
    expect(h.docs.get('p1.html')?.source).toBe(pageSource('External'));
  });

  it('tracks missing files, gates dirty closes and rebuilds via allowCreate', async () => {
    const h = createHarness();
    h.docs.set('p1.html', { source: pageSource('A'), revision: 'rev-1' });
    const c = new DesignWorkspaceController('k', h.getPorts);
    c.rebind('s1');
    await open(c, 'p1.html');

    c.refreshFiles(['other.html']);
    expect(pageOf(c, 'p1.html').missing).toBe(true);
    c.refreshFiles(['p1.html', 'other.html']);
    expect(pageOf(c, 'p1.html').missing).toBe(false);
    c.refreshFiles([]);
    expect(pageOf(c, 'p1.html').missing).toBe(true);

    // A dirty page refuses to close until the draft is discarded.
    await editActivePage(c, 'p1.html', 'A!');
    expect(c.close('p1.html')).toBe('dirty');
    expect(c.getSnapshot().pages.map(page => page.path)).toEqual(['p1.html']);
    expect(c.close('p1.html', { discardDraft: true })).toBe('closed');
    expect(c.getSnapshot().pages).toEqual([]);
    expect(c.close('p1.html')).toBe('not-open');

    // Saving a missing page recreates the file: allowCreate + empty revision.
    await open(c, 'p1.html');
    c.refreshFiles([]);
    h.docs.delete('p1.html');
    await editActivePage(c, 'p1.html', 'Rebuilt');
    expect(await c.save()).toBe(true);
    expect(h.puts[0]).toMatchObject({
      path: 'p1.html',
      source: editSource('Rebuilt'),
      expectedRevision: '',
      allowCreate: true,
    });
    expect(pageOf(c, 'p1.html')).toMatchObject({
      status: 'clean',
      missing: false,
      docRevision: 'saved-1',
    });
    expect(h.docs.get('p1.html')?.source).toBe(editSource('Rebuilt'));
  });

  it('adopts external docs on clean pages and flags dirty ones', async () => {
    const h = createHarness();
    h.docs.set('p1.html', { source: pageSource('A'), revision: 'rev-1' });
    const c = new DesignWorkspaceController('k', h.getPorts);
    c.rebind('s1');
    await open(c, 'p1.html');

    // Clean page: a changed disk doc is adopted outright.
    c.handleSelectionMessage(h1Selection(pageSource('A'), 'A'));
    await c.handleExternalDoc({ path: 'p1.html', source: pageSource('Changed'), revision: 'rev-x1' });
    expect(pageOf(c, 'p1.html')).toMatchObject({
      source: pageSource('Changed'),
      draftRevision: sha(pageSource('Changed')),
      docRevision: 'rev-x1',
      externalChange: false,
      canUndo: false,
      status: 'clean',
    });
    expect(pageOf(c, 'p1.html').selection).toBeNull();

    await editActivePage(c, 'p1.html', 'Changed!');

    // Dirty page with an unchanged disk doc: no flag, draft and doc stay put.
    await c.handleExternalDoc({ path: 'p1.html', source: pageSource('Changed'), revision: 'rev-x1' });
    expect(pageOf(c, 'p1.html')).toMatchObject({
      externalChange: false,
      source: editSource('Changed!'),
      docRevision: 'rev-x1',
    });

    // Dirty page: the draft is kept and only flagged.
    await c.handleExternalDoc({ path: 'p1.html', source: pageSource('Again'), revision: 'rev-x2' });
    expect(pageOf(c, 'p1.html')).toMatchObject({
      externalChange: true,
      source: editSource('Changed!'),
      docRevision: 'rev-x1',
      status: 'dirty',
    });
  });

  it('treats an unchanged disk doc as a no-op and keeps the selection', async () => {
    const h = createHarness();
    h.docs.set('p1.html', { source: pageSource('A'), revision: 'rev-1' });
    const c = new DesignWorkspaceController('k', h.getPorts);
    c.rebind('s1');
    await open(c, 'p1.html');
    c.handleSelectionMessage(h1Selection(pageSource('A'), 'A'));

    await c.handleExternalDoc({ path: 'p1.html', source: pageSource('A'), revision: 'rev-1' });
    const page = pageOf(c, 'p1.html');
    expect(page).toMatchObject({
      source: pageSource('A'),
      docRevision: 'rev-1',
      externalChange: false,
      status: 'clean',
    });
    expect(page.selection).toEqual(h1Selection(pageSource('A'), 'A'));
  });

  it('ignores external docs for non-active paths', async () => {
    const h = createHarness();
    h.docs.set('p1.html', { source: pageSource('A'), revision: 'rev-1' });
    h.docs.set('p2.html', { source: pageSource('B'), revision: 'rev-2' });
    const c = new DesignWorkspaceController('k', h.getPorts);
    c.rebind('s1');
    await open(c, 'p1.html');
    await open(c, 'p2.html');
    expect(c.getSnapshot().activePath).toBe('p2.html');

    await c.handleExternalDoc({ path: 'p1.html', source: pageSource('Changed'), revision: 'rev-x' });
    expect(pageOf(c, 'p1.html')).toMatchObject({
      source: pageSource('A'),
      docRevision: 'rev-1',
      externalChange: false,
    });
  });

  it('ignores external docs while the page is busy', async () => {
    const h = createHarness();
    h.docs.set('p1.html', { source: pageSource('A'), revision: 'rev-1' });
    const c = new DesignWorkspaceController('k', h.getPorts);
    c.rebind('s1');
    await open(c, 'p1.html');
    await editActivePage(c, 'p1.html', 'A!');

    const gate = h.gatePut('p1.html');
    const savePromise = c.save();
    expect(pageOf(c, 'p1.html').busy).toBe(true);

    await c.handleExternalDoc({ path: 'p1.html', source: pageSource('Changed'), revision: 'rev-x' });
    expect(pageOf(c, 'p1.html')).toMatchObject({
      busy: true,
      externalChange: false,
      source: editSource('A!'),
      docRevision: 'rev-1',
    });

    gate.resolve(undefined);
    expect(await savePromise).toBe(true);
    expect(pageOf(c, 'p1.html').busy).toBe(false);
  });

  it('bumps assetEpoch exactly once per real stat change', async () => {
    const h = createHarness();
    h.docs.set('p1.html', { source: pageSource('A'), revision: 'rev-1' });
    const c = new DesignWorkspaceController('k', h.getPorts);
    c.rebind('s1');
    await open(c, 'p1.html');

    h.setDeps(depsResultFor('p1.html', [stat('assets/a.css', 100)]));
    c.applyDepsStats(depsResultFor('p1.html', [stat('assets/a.css', 100)]));
    // First sample only establishes the baseline.
    expect(c.getSnapshot().assetEpoch).toBe(0);

    c.applyDepsStats(depsResultFor('p1.html', [stat('assets/a.css', 100)]));
    expect(c.getSnapshot().assetEpoch).toBe(0);

    h.setDeps(depsResultFor('p1.html', [stat('assets/a.css', 200)]));
    c.applyDepsStats(depsResultFor('p1.html', [stat('assets/a.css', 200)]));
    expect(c.getSnapshot().assetEpoch).toBe(1);

    c.applyDepsStats(depsResultFor('p1.html', [stat('assets/a.css', 200)]));
    expect(c.getSnapshot().assetEpoch).toBe(1);

    // A changed path set counts as a change too.
    h.setDeps(depsResultFor('p1.html', [stat('assets/a.css', 200), stat('assets/b.png', 5, 99)]));
    c.applyDepsStats(depsResultFor('p1.html', [stat('assets/a.css', 200), stat('assets/b.png', 5, 99)]));
    expect(c.getSnapshot().assetEpoch).toBe(2);

    // Missing flags are compared as well.
    h.setDeps(
      depsResultFor('p1.html', [
        stat('assets/a.css', 200),
        { ...stat('assets/b.png', 5, 99), missing: true, size: null, mtimeMs: null },
      ])
    );
    c.applyDepsStats(
      depsResultFor('p1.html', [
        stat('assets/a.css', 200),
        { ...stat('assets/b.png', 5, 99), missing: true, size: null, mtimeMs: null },
      ])
    );
    expect(c.getSnapshot().assetEpoch).toBe(3);

    // Stats for a path that is not open are ignored.
    c.applyDepsStats(depsResultFor('unknown.html', [stat('x.css', 1)]));
    expect(c.getSnapshot().assetEpoch).toBe(3);
  });

  it('evicts the LRU clean inactive page at the limit and refuses when all pages are dirty', async () => {
    const h = createHarness();
    for (let index = 1; index <= 9; index += 1) {
      h.docs.set(`p${index}.html`, { source: pageSource(`T${index}`), revision: `rev-${index}` });
    }
    const c = new DesignWorkspaceController('k', h.getPorts);
    c.rebind('s1');
    for (let index = 1; index <= 8; index += 1) {
      await open(c, `p${index}.html`);
    }
    expect(c.getSnapshot().pages).toHaveLength(MAX_OPEN_PAGES);

    // Touch p1 so p2 becomes the least recently accessed clean inactive page.
    c.activate('p1.html');
    await open(c, 'p9.html');
    expect(c.getSnapshot().pages).toHaveLength(MAX_OPEN_PAGES);
    expect(c.getSnapshot().pages.map(page => page.path)).not.toContain('p2.html');
    expect(pageOf(c, 'p9.html').status).toBe('clean');

    // Dirty every remaining page; then there is nothing left to evict.
    for (const path of ['p1.html', 'p3.html', 'p4.html', 'p5.html', 'p6.html', 'p7.html', 'p8.html', 'p9.html']) {
      await editActivePage(c, path, 'X');
    }
    const pagesBefore = c.getSnapshot().pages.map(page => page.path);
    const getsBefore = h.gets.length;
    const refused = await c.open('p10.html');
    expect(refused).toEqual({ ok: false, reason: 'limit' });
    expect(h.gets.length).toBe(getsBefore); // rejected before any fetch
    expect(c.getSnapshot().pages.map(page => page.path)).toEqual(pagesBefore);
    expect(pageOf(c, 'p3.html').status).toBe('dirty');
  });

  it('reports load failures and does not add a page', async () => {
    const h = createHarness();
    const c = new DesignWorkspaceController('k', h.getPorts);
    c.rebind('s1');

    const result = await c.open('nope.html');
    expect(result).toEqual({
      ok: false,
      reason: 'load-failed',
      message: expect.stringContaining('FILE_NOT_FOUND'),
    });
    expect(c.getSnapshot().pages).toEqual([]);
    expect(c.getSnapshot().activePath).toBeNull();
  });

  it('isolates controllers per identity and drops in-flight results after dispose', async () => {
    const hA = createHarness();
    hA.docs.set('p1.html', { source: pageSource('A'), revision: 'rev-a' });
    hA.docs.set('p2.html', { source: pageSource('B'), revision: 'rev-b' });
    const hB = createHarness();
    hB.docs.set('p1.html', { source: pageSource('Other'), revision: 'rev-other' });

    const leaseA = acquireWorkspaceController({ backendId: 'backend-a' }, 'sA', hA.getPorts);
    const leaseB = acquireWorkspaceController({ backendId: 'backend-b' }, 'sB', hB.getPorts);
    expect(leaseA.controller).not.toBe(leaseB.controller);

    // A slow response for A arrives only after B fully loaded.
    const gate = hA.gate('p1.html');
    const openPromise = leaseA.controller.open('p1.html');
    await open(leaseB.controller, 'p1.html');
    const snapshotB = leaseB.controller.getSnapshot();
    gate.resolve({ path: 'p1.html', source: pageSource('A'), revision: 'rev-a' });
    expect(await openPromise).toEqual({ ok: true });
    expect(pageOf(leaseA.controller, 'p1.html').source).toBe(pageSource('A'));
    // The late response never touched the other identity's controller.
    expect(leaseB.controller.getSnapshot()).toBe(snapshotB);

    // Disposing drops the in-flight result and stops all notifications.
    const lateGate = hA.gate('p2.html');
    const disposedOpen = leaseA.controller.open('p2.html');
    leaseA.controller.dispose();
    const listener = vi.fn();
    leaseA.controller.subscribe(listener);
    lateGate.resolve({ path: 'p2.html', source: pageSource('B'), revision: 'rev-b' });
    expect(await disposedOpen).toMatchObject({ ok: false, reason: 'load-failed' });
    expect(listener).not.toHaveBeenCalled();
    expect(pageOf(leaseA.controller, 'p2.html').status).toBe('loading');

    // Releasing to zero does not destroy the instance: re-acquire reuses it.
    leaseA.release();
    leaseB.release();
    const leaseA2 = acquireWorkspaceController({ backendId: 'backend-a' }, 'sA2', hA.getPorts);
    expect(leaseA2.controller).toBe(leaseA.controller);
    // Drafts survive the release/re-acquire cycle.
    expect(pageOf(leaseA2.controller, 'p1.html').source).toBe(pageSource('A'));
  });

  it('routes actions through getPorts with the rebound session id', async () => {
    const h = createHarness();
    h.docs.set('p1.html', { source: pageSource('A'), revision: 'rev-1' });
    const c = new DesignWorkspaceController('k', h.getPorts);
    c.rebind('s1');
    await open(c, 'p1.html');
    expect(h.getSessions.at(-1)).toBe('s1');

    c.rebind('s2');
    await editActivePage(c, 'p1.html', 'A!');
    c.activate('p1.html');
    expect(await c.save()).toBe(true);
    expect(h.getSessions.at(-1)).toBe('s2');
    expect(h.puts.at(-1)?.sessionId).toBe('s2');
    expect(h.snapshotCalls.at(-1)?.sessionId).toBe('s2');
  });

  it('activates the most recent still-open page after closing the active one', async () => {
    const h = createHarness();
    for (const text of ['A', 'B', 'C']) {
      h.docs.set(`p${text}.html`, { source: pageSource(text), revision: 'rev-1' });
    }
    const c = new DesignWorkspaceController('k', h.getPorts);
    c.rebind('s1');
    await open(c, 'pA.html');
    await open(c, 'pB.html');
    await open(c, 'pC.html');
    expect(c.getSnapshot().activePath).toBe('pC.html');

    expect(c.close('pC.html')).toBe('closed');
    expect(c.getSnapshot().activePath).toBe('pB.html');

    c.activate('pA.html');
    c.activate('pB.html');
    expect(c.close('pB.html')).toBe('closed');
    expect(c.getSnapshot().activePath).toBe('pA.html');

    expect(c.close('pA.html')).toBe('closed');
    expect(c.getSnapshot().activePath).toBeNull();
    expect(c.getSnapshot().pages).toEqual([]);
  });

  it('dedupes recents and caps them at 12', async () => {
    const h = createHarness();
    for (let index = 1; index <= 13; index += 1) {
      h.docs.set(`p${index}.html`, { source: pageSource('A'), revision: 'rev-1' });
    }
    const c = new DesignWorkspaceController('k', h.getPorts);
    c.rebind('s1');
    for (let index = 1; index <= 13; index += 1) {
      await open(c, `p${index}.html`);
      expect(c.close(`p${index}.html`)).toBe('closed');
    }
    // Re-opening p1 moves it to the head without duplicating it.
    await open(c, 'p1.html');
    const recents = c.getSnapshot().ui.recents;
    expect(recents[0]).toBe('p1.html');
    expect(recents).toHaveLength(12);
    expect(new Set(recents).size).toBe(recents.length);
    expect(recents).not.toContain('p2.html');
    expect(recents).toContain('p13.html');
  });

  it('keeps the snapshot object stable and only replaces changed pages', async () => {
    const h = createHarness();
    h.docs.set('p1.html', { source: pageSource('A'), revision: 'rev-1' });
    h.docs.set('p2.html', { source: pageSource('B'), revision: 'rev-2' });
    const c = new DesignWorkspaceController('k', h.getPorts);
    c.rebind('s1');
    await open(c, 'p1.html');
    await open(c, 'p2.html');

    expect(c.getSnapshot()).toBe(c.getSnapshot());
    // A no-op viewport write neither notifies nor replaces the snapshot.
    const stable = c.getSnapshot();
    c.setViewport({ preset: 'fill', width: null });
    expect(c.getSnapshot()).toBe(stable);

    const p1Before = pageOf(c, 'p1.html');
    c.setViewport({ preset: 'custom', width: 800 });
    const next = c.getSnapshot();
    expect(next).not.toBe(stable);
    expect(next.pages.find(page => page.path === 'p1.html')).toBe(p1Before);

    const p2Before = pageOf(c, 'p2.html');
    await editActivePage(c, 'p2.html', 'B!');
    const afterEdit = c.getSnapshot();
    expect(pageOf(c, 'p2.html')).not.toBe(p2Before);
    expect(afterEdit.pages.find(page => page.path === 'p1.html')).toBe(p1Before);
  });

  it('notifies subscribers on changes and stops after unsubscribe or dispose', async () => {
    const h = createHarness();
    h.docs.set('p1.html', { source: pageSource('A'), revision: 'rev-1' });
    const c = new DesignWorkspaceController('k', h.getPorts);
    c.rebind('s1');

    const listener = vi.fn();
    const unsubscribe = c.subscribe(listener);
    await open(c, 'p1.html');
    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    unsubscribe();
    c.setZoom({ mode: 'manual', value: 1.5 });
    expect(listener).not.toHaveBeenCalled();

    const second = vi.fn();
    c.subscribe(second);
    c.dispose();
    c.setZoom({ mode: 'manual', value: 2 });
    expect(second).not.toHaveBeenCalled();
  });

  it('persists ui metadata after open/activate/setViewport/setZoom and restores it', async () => {
    const h = createHarness();
    h.docs.set('p1.html', { source: pageSource('A'), revision: 'rev-1' });
    h.docs.set('p2.html', { source: pageSource('B'), revision: 'rev-2' });
    const key = workspaceUiStorageKey('persist-key');
    const c = new DesignWorkspaceController('persist-key', h.getPorts);
    c.rebind('s1');

    await open(c, 'p1.html');
    expect(JSON.parse(localStorage.getItem(key) ?? '{}')).toMatchObject({
      version: 1,
      activePath: 'p1.html',
      recents: ['p1.html'],
    });

    c.setViewport({ preset: 'custom', width: 800 });
    c.setZoom({ mode: 'manual', value: 0.5 });
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}');
    expect(stored.viewport).toEqual({ preset: 'custom', width: 800 });
    expect(stored.zoom).toEqual({ mode: 'manual', value: 0.5 });

    // A fresh controller restores the persisted preferences.
    const revived = new DesignWorkspaceController('persist-key', h.getPorts);
    expect(revived.getSnapshot().activePath).toBe('p1.html');
    expect(revived.getSnapshot().ui.viewport).toEqual({ preset: 'custom', width: 800 });
    expect(revived.getSnapshot().ui.zoom).toEqual({ mode: 'manual', value: 0.5 });
    expect(revived.getSnapshot().pages).toEqual([]);
  });
});
