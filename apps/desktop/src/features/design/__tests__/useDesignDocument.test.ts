import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDesignDocument } from '../useDesignDocument';
import { sha256HexSync } from '../html/hash';
import type { DesignSelection, DesignSnapshotSummary } from '../types';
import * as api from '../api';

vi.mock('../api', () => {
  class DesignSnapshotError extends Error {
    constructor(
      message: string,
      readonly code: string | undefined,
      readonly files: Array<{ path: string; reason?: string }> = []
    ) {
      super(message);
      this.name = 'DesignSnapshotError';
    }
  }
  return {
    DesignSnapshotError,
    getDesignDocument: vi.fn(),
    putDesignDocument: vi.fn(),
    createDesignSnapshot: vi.fn(),
    restoreDesignSnapshot: vi.fn(),
  };
});

const SOURCE = '<html><body><h1>Hello</h1></body></html>';
const EDITED = '<html><body><h1>Hi</h1></body></html>';
const RESTORED = '<html><body><h1>Restored</h1></body></html>';
const sha = (source: string): string => sha256HexSync(source);

const snapshotSummary = (overrides: Partial<DesignSnapshotSummary> = {}): DesignSnapshotSummary => ({
  id: 'ds-1',
  entryPath: 'design/index.html',
  label: null,
  source: 'save',
  complete: true,
  incompleteReasons: [],
  fileCount: 1,
  totalBytes: SOURCE.length,
  createdAt: 1730000000000,
  ...overrides,
});

function selectionFor(source: string, overrides: Partial<DesignSelection> = {}): DesignSelection {
  return {
    elementPath: [0],
    tagName: 'h1',
    text: 'Hello',
    sourceText: 'Hello',
    color: 'rgb(0, 0, 0)',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    base: sha(source),
    ...overrides,
  };
}

async function renderLoaded() {
  const result = renderHook(() => useDesignDocument({ backendId: 'remote-1', sessionId: 's1' }));
  await act(async () => {
    await result.result.current.load('design/index.html');
  });
  return result.result;
}

async function renderLoadedWithSelection() {
  const result = await renderLoaded();
  act(() => {
    result.current.handleSelectionMessage(selectionFor(SOURCE));
  });
  return result;
}

describe('useDesignDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getDesignDocument).mockResolvedValue({
      path: 'design/index.html',
      source: SOURCE,
      revision: 'revision-1',
    });
    vi.mocked(api.putDesignDocument).mockResolvedValue({
      path: 'design/index.html',
      source: SOURCE,
      revision: 'revision-1',
    });
    vi.mocked(api.createDesignSnapshot).mockResolvedValue(snapshotSummary());
    vi.mocked(api.restoreDesignSnapshot).mockResolvedValue({
      summary: snapshotSummary({ source: 'restore' }),
      restored: ['design/index.html'],
    });
  });

  it('loads a document and derives the draft revision from the source', async () => {
    const result = await renderLoaded();
    expect(api.getDesignDocument).toHaveBeenCalledWith('remote-1', 's1', 'design/index.html');
    expect(result.current.doc).toEqual({
      path: 'design/index.html',
      source: SOURCE,
      revision: 'revision-1',
    });
    expect(result.current.draft).toBe(SOURCE);
    expect(result.current.draftRevision).toBe(sha(SOURCE));
    expect(result.current.dirty).toBe(false);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.error).toBe('');
    expect(result.current.externalChange).toBe(false);
  });

  it('reports load failures through the error state', async () => {
    vi.mocked(api.getDesignDocument).mockRejectedValue(new Error('file not found'));
    const result = await renderLoaded();
    expect(result.current.error).toBe('file not found');
    expect(result.current.doc).toBeNull();
  });

  it('applies a text edit to the draft and supports undo and redo', async () => {
    const result = await renderLoadedWithSelection();
    let applied: DesignSelection | null = null;
    await act(async () => {
      applied = await result.current.apply([{ kind: 'text', value: 'Hi' }], 'edit', '0:text');
    });
    expect(applied).not.toBeNull();
    expect(result.current.draft).toBe(EDITED);
    expect(result.current.draftRevision).toBe(sha(EDITED));
    expect(result.current.dirty).toBe(true);
    expect(result.current.selection).toEqual({
      elementPath: [0],
      tagName: 'h1',
      text: 'Hi',
      sourceText: 'Hi',
      color: 'rgb(0, 0, 0)',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      base: sha(EDITED),
    });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    await act(async () => {
      await result.current.undo();
    });
    expect(result.current.draft).toBe(SOURCE);
    expect(result.current.draftRevision).toBe(sha(SOURCE));
    expect(result.current.selection).toBeNull();
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    await act(async () => {
      await result.current.redo();
    });
    expect(result.current.draft).toBe(EDITED);
    expect(result.current.draftRevision).toBe(sha(EDITED));
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('applies a style operation onto the inline declarations', async () => {
    const result = await renderLoadedWithSelection();
    await act(async () => {
      await result.current.apply(
        [{ kind: 'style', property: 'color', value: '#112233' }],
        'edit',
        '0:style:color'
      );
    });
    expect(result.current.draft).toBe(
      '<html><body><h1 style="color: #112233">Hello</h1></body></html>'
    );
    expect(result.current.selection?.color).toBe('#112233');
  });

  it('keeps the draft undoable after a successful save (markSaved)', async () => {
    vi.mocked(api.putDesignDocument).mockResolvedValue({
      path: 'design/index.html',
      source: EDITED,
      revision: 'revision-2',
    });
    const result = await renderLoadedWithSelection();
    await act(async () => {
      await result.current.apply([{ kind: 'text', value: 'Hi' }], 'edit', '0:text');
    });
    await act(async () => {
      await result.current.save();
    });
    expect(api.putDesignDocument).toHaveBeenCalledWith('remote-1', {
      sessionId: 's1',
      path: 'design/index.html',
      source: EDITED,
      expectedRevision: 'revision-1',
    });
    expect(result.current.doc).toEqual({
      path: 'design/index.html',
      source: EDITED,
      revision: 'revision-2',
    });
    expect(result.current.dirty).toBe(false);
    expect(result.current.externalChange).toBe(false);
    expect(result.current.canUndo).toBe(true);

    await act(async () => {
      await result.current.undo();
    });
    expect(result.current.draft).toBe(SOURCE);
    expect(result.current.dirty).toBe(true);
    expect(result.current.doc?.revision).toBe('revision-2');
  });

  it('keeps the edited draft and flags an external change when saving conflicts', async () => {
    vi.mocked(api.putDesignDocument).mockRejectedValue(new Error('revision conflict: file changed'));
    const result = await renderLoadedWithSelection();
    await act(async () => {
      await result.current.apply([{ kind: 'text', value: 'Hi' }], 'edit', '0:text');
    });
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.error).toBe('revision conflict: file changed');
    expect(result.current.externalChange).toBe(true);
    expect(result.current.draft).toBe(EDITED);
    expect(result.current.dirty).toBe(true);
    expect(result.current.doc?.revision).toBe('revision-1');
  });

  it('ignores a selection message whose base does not match the draft revision', async () => {
    const result = await renderLoaded();
    act(() => {
      result.current.handleSelectionMessage(selectionFor(SOURCE, { base: 'stale-revision' }));
    });
    expect(result.current.selection).toBeNull();

    act(() => {
      result.current.handleSelectionMessage(selectionFor(SOURCE, { base: undefined }));
    });
    expect(result.current.selection).toBeNull();
  });

  it('accepts a selection message bound to the current draft revision', async () => {
    const result = await renderLoaded();
    const next = selectionFor(SOURCE);
    act(() => {
      result.current.handleSelectionMessage(next);
    });
    expect(result.current.selection).toEqual(next);
    expect(result.current.overrideWarning).toBe(false);
  });

  it('maps TEXT_MISMATCH to the reselect hint without changing the draft', async () => {
    const result = await renderLoadedWithSelection();
    act(() => {
      result.current.handleSelectionMessage(
        selectionFor(SOURCE, { text: 'Different', sourceText: 'Different' })
      );
    });
    let applied: DesignSelection | null = null;
    await act(async () => {
      applied = await result.current.apply([{ kind: 'text', value: 'Hi' }], 'edit', '0:text');
    });
    expect(applied).toBeNull();
    expect(result.current.error).toBe('所选元素已变化，请重新选择后再试');
    expect(result.current.draft).toBe(SOURCE);
    expect(result.current.canUndo).toBe(false);
  });

  it('maps INVALID_VALUE to the color hint', async () => {
    const result = await renderLoadedWithSelection();
    await act(async () => {
      await result.current.apply(
        [{ kind: 'style', property: 'color', value: 'bad-color' }],
        'edit',
        '0:style:color'
      );
    });
    expect(result.current.error).toBe('颜色值无效，请输入合法的 CSS 颜色');
    expect(result.current.draft).toBe(SOURCE);
  });

  it('silently adopts a changed disk document when the draft is clean', async () => {
    const result = await renderLoadedWithSelection();
    const nextSource = '<html><body><h1>Changed on disk</h1></body></html>';
    await act(async () => {
      await result.current.checkExternal({
        path: 'design/index.html',
        source: nextSource,
        revision: 'revision-9',
      });
    });
    expect(result.current.doc).toEqual({
      path: 'design/index.html',
      source: nextSource,
      revision: 'revision-9',
    });
    expect(result.current.draft).toBe(nextSource);
    expect(result.current.draftRevision).toBe(sha(nextSource));
    expect(result.current.selection).toBeNull();
    expect(result.current.externalChange).toBe(false);
    expect(result.current.canUndo).toBe(false);
  });

  it('keeps a dirty draft and flags an external change instead of adopting', async () => {
    const result = await renderLoadedWithSelection();
    await act(async () => {
      await result.current.apply([{ kind: 'text', value: 'Hi' }], 'edit', '0:text');
    });
    await act(async () => {
      await result.current.checkExternal({
        path: 'design/index.html',
        source: '<html><body><h1>Changed on disk</h1></body></html>',
        revision: 'revision-9',
      });
    });
    expect(result.current.externalChange).toBe(true);
    expect(result.current.draft).toBe(EDITED);
    expect(result.current.doc?.revision).toBe('revision-1');
    expect(result.current.canUndo).toBe(true);
  });

  it('treats an unchanged disk document as a no-op and keeps the selection', async () => {
    const result = await renderLoadedWithSelection();
    await act(async () => {
      await result.current.checkExternal({
        path: 'design/index.html',
        source: SOURCE,
        revision: 'revision-1',
      });
    });
    expect(result.current.selection).not.toBeNull();
    expect(result.current.externalChange).toBe(false);
    expect(result.current.doc?.revision).toBe('revision-1');
  });

  it('reloads and explains when undo finds a drifted baseline', async () => {
    const result = await renderLoaded();
    await act(async () => {
      await result.current.undo();
    });
    expect(api.getDesignDocument).toHaveBeenCalledTimes(2);
    expect(result.current.draft).toBe(SOURCE);
    expect(result.current.doc).toEqual({
      path: 'design/index.html',
      source: SOURCE,
      revision: 'revision-1',
    });
    expect(result.current.error).toBe('编辑历史已失效，已重新载入');
  });

  it('reloads the current document and discards the draft on reload', async () => {
    const result = await renderLoadedWithSelection();
    await act(async () => {
      await result.current.apply([{ kind: 'text', value: 'Hi' }], 'edit');
    });
    await act(async () => {
      await result.current.reload();
    });
    expect(api.getDesignDocument).toHaveBeenCalledTimes(2);
    expect(result.current.draft).toBe(SOURCE);
    expect(result.current.dirty).toBe(false);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.selection).toBeNull();
  });

  it('captures a save snapshot automatically after a successful save', async () => {
    vi.mocked(api.putDesignDocument).mockResolvedValue({
      path: 'design/index.html',
      source: EDITED,
      revision: 'revision-2',
    });
    const result = await renderLoadedWithSelection();
    await act(async () => {
      await result.current.apply([{ kind: 'text', value: 'Hi' }], 'edit');
    });
    await act(async () => {
      await result.current.save();
    });
    expect(api.createDesignSnapshot).toHaveBeenCalledWith('remote-1', {
      sessionId: 's1',
      path: 'design/index.html',
      source: 'save',
    });
    expect(result.current.dirty).toBe(false);
    expect(result.current.error).toBe('');
    expect(result.current.externalChange).toBe(false);
    expect(result.current.canUndo).toBe(true);
  });

  it('keeps the save successful when the snapshot capture fails', async () => {
    vi.mocked(api.putDesignDocument).mockResolvedValue({
      path: 'design/index.html',
      source: EDITED,
      revision: 'revision-2',
    });
    vi.mocked(api.createDesignSnapshot).mockRejectedValue(new Error('disk full'));
    const result = await renderLoadedWithSelection();
    await act(async () => {
      await result.current.apply([{ kind: 'text', value: 'Hi' }], 'edit');
    });
    await act(async () => {
      await result.current.save();
    });
    // The save itself stays successful: the document is adopted and undoable.
    expect(result.current.doc).toEqual({
      path: 'design/index.html',
      source: EDITED,
      revision: 'revision-2',
    });
    expect(result.current.dirty).toBe(false);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.externalChange).toBe(false);
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toContain('快照未创建');
    expect(result.current.error).toContain('disk full');
  });

  it('restores a snapshot, reloads the document and rebuilds the history', async () => {
    const result = await renderLoadedWithSelection();
    await act(async () => {
      await result.current.apply([{ kind: 'text', value: 'Hi' }], 'edit');
    });
    expect(result.current.canUndo).toBe(true);
    // The disk document the restore reloads differs from what was loaded before.
    vi.mocked(api.getDesignDocument).mockResolvedValue({
      path: 'design/index.html',
      source: RESTORED,
      revision: 'revision-restored',
    });
    let outcome: Awaited<ReturnType<typeof result.current.restoreSnapshot>> | undefined;
    await act(async () => {
      outcome = await result.current.restoreSnapshot('ds-1', {
        'design/index.html': sha(SOURCE),
      });
    });
    expect(api.restoreDesignSnapshot).toHaveBeenCalledWith('remote-1', {
      sessionId: 's1',
      snapshotId: 'ds-1',
      expectedRevisions: { 'design/index.html': sha(SOURCE) },
    });
    expect(outcome).toEqual({ ok: true });
    expect(api.getDesignDocument).toHaveBeenCalledTimes(2);
    expect(result.current.draft).toBe(RESTORED);
    expect(result.current.draftRevision).toBe(sha(RESTORED));
    expect(result.current.selection).toBeNull();
    expect(result.current.canUndo).toBe(false);
    expect(result.current.error).toBe('');
    expect(result.current.busy).toBe(false);
  });

  it('surfaces restore conflict files through the outcome, not the error state', async () => {
    vi.mocked(api.restoreDesignSnapshot).mockRejectedValue(
      new api.DesignSnapshotError('restore conflict', 'RESTORE_CONFLICT', [
        { path: 'design/index.html', reason: 'revision mismatch' },
      ])
    );
    const result = await renderLoadedWithSelection();
    let outcome: Awaited<ReturnType<typeof result.current.restoreSnapshot>> | undefined;
    await act(async () => {
      outcome = await result.current.restoreSnapshot('ds-1', {});
    });
    expect(outcome).toEqual({
      ok: false,
      errorCode: 'RESTORE_CONFLICT',
      conflictFiles: [{ path: 'design/index.html', reason: 'revision mismatch' }],
    });
    expect(result.current.error).toBe('');
    expect(result.current.busy).toBe(false);
    // The disk state wins: nothing was reloaded.
    expect(api.getDesignDocument).toHaveBeenCalledTimes(1);
    expect(result.current.draft).toBe(SOURCE);
  });
});
