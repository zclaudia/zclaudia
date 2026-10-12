import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBottomPanelStore } from '../bottomPanelStore';
import { useDraftEditorStore } from '../draftEditorStore';
import { usePluginStore } from '../pluginStore';
import * as api from '../../services/api';

vi.mock('../../services/api', () => ({
  lockSessionDraft: vi.fn(),
  getSessionDraft: vi.fn(),
  upsertSessionDraft: vi.fn(),
  deleteSessionDraft: vi.fn(),
  unlockSessionDraft: vi.fn(),
  archiveSessionDraft: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('draftEditorStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.unlockSessionDraft).mockResolvedValue(undefined as never);
    vi.mocked(api.deleteSessionDraft).mockResolvedValue(undefined as never);
    vi.mocked(api.archiveSessionDraft).mockResolvedValue(undefined as never);

    useDraftEditorStore.setState({
      draftExists: {},
      activeSessionId: null,
      localContent: '',
      isSaving: false,
      lastSavedAt: null,
      isReadOnly: false,
      isLocked: false,
      lockedByDevice: null,
      showLockPrompt: false,
      poppedOut: false,
      poppedOutWindowLabel: null,
      sendCallback: null,
      sessionArchived: false,
    });

    usePluginStore.setState({
      plugins: [],
      isLoading: false,
      error: null,
      panels: [],
      settingsTabs: [],
      toolbarItems: [],
      settings: {},
      disabledBuiltinPanels: [],
    } as any);

    useBottomPanelStore.setState({ activeTab: '' });
  });
  afterEach(() => vi.useRealTimers());

  it('ignores the old lock response after binding a different draft', async () => {
    const stale = deferred<any>();
    vi.mocked(api.lockSessionDraft)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({
        locked: true,
        draft: { content: 'B content', updatedAt: 20 },
      } as any);
    const openA = useDraftEditorStore.getState().openEditor('A');
    await useDraftEditorStore.getState().openEditor('B');
    stale.resolve({ locked: false, draft: { content: 'A content', editingBy: 'other-device' } });
    await openA;
    expect(useDraftEditorStore.getState()).toMatchObject({
      activeSessionId: 'B',
      localContent: 'B content',
      showLockPrompt: false,
      lastSavedAt: 20,
    });
  });

  it('keeps the editor read-only until its lock and initial content arrive', async () => {
    const pending = deferred<any>();
    vi.mocked(api.lockSessionDraft).mockReturnValueOnce(pending.promise);
    const open = useDraftEditorStore.getState().openEditor('A');
    useDraftEditorStore.getState().setLocalContent('Typed before lock');
    expect(useDraftEditorStore.getState()).toMatchObject({ isReadOnly: true, localContent: '' });
    pending.resolve({ locked: true, draft: { content: 'Stored A content' } });
    await open;
    expect(useDraftEditorStore.getState()).toMatchObject({
      isReadOnly: false,
      localContent: 'Stored A content',
    });
  });

  it('cancels a pending autosave when the draft becomes read-only', async () => {
    vi.useFakeTimers();
    useDraftEditorStore.setState({
      activeSessionId: 'A',
      localContent: 'Stored',
      isReadOnly: false,
    });
    useDraftEditorStore.getState().setLocalContent('Pending edit');
    useDraftEditorStore.getState().openReadOnly('A');
    await vi.advanceTimersByTimeAsync(1600);
    expect(api.upsertSessionDraft).not.toHaveBeenCalled();
    expect(useDraftEditorStore.getState().isSaving).toBe(false);
  });

  it('does not reset unsaved content when an already open session initializes again', async () => {
    useDraftEditorStore.setState({
      activeSessionId: 'A',
      localContent: 'Unsaved edit',
      isReadOnly: false,
    });
    await useDraftEditorStore.getState().openEditor('A');
    expect(api.lockSessionDraft).not.toHaveBeenCalled();
    expect(useDraftEditorStore.getState().localContent).toBe('Unsaved edit');
  });

  it('releases a stale acquired lock after close without resurrecting the editor', async () => {
    const stale = deferred<any>();
    vi.mocked(api.lockSessionDraft).mockReturnValueOnce(stale.promise);
    const open = useDraftEditorStore.getState().openEditor('A');
    await useDraftEditorStore.getState().closeEditor();
    stale.resolve({ locked: true, draft: { content: 'A content' } });
    await open;
    expect(useDraftEditorStore.getState()).toMatchObject({
      activeSessionId: null,
      localContent: '',
      showLockPrompt: false,
    });
    expect(api.unlockSessionDraft).toHaveBeenLastCalledWith('A', expect.any(String));
  });

  it('ignores an old force-open response after switching session', async () => {
    useDraftEditorStore.setState({ activeSessionId: 'A', isReadOnly: true });
    const stale = deferred<any>();
    vi.mocked(api.lockSessionDraft)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({ locked: true, draft: { content: 'B content' } } as any);
    const force = useDraftEditorStore.getState().forceOpen('A');
    await useDraftEditorStore.getState().openEditor('B');
    stale.resolve({ locked: true, draft: { content: 'A content' } });
    await force;
    expect(useDraftEditorStore.getState()).toMatchObject({
      activeSessionId: 'B',
      localContent: 'B content',
    });
  });

  it.each(['finish', 'discard'])(
    'keeps the new editor open when old %s completes',
    async action => {
      useDraftEditorStore.setState({
        activeSessionId: 'A',
        localContent: 'A content',
        isReadOnly: true,
      });
      const stale = deferred<any>();
      if (action === 'finish')
        vi.mocked(api.archiveSessionDraft).mockReturnValueOnce(stale.promise);
      else vi.mocked(api.deleteSessionDraft).mockReturnValueOnce(stale.promise);
      const operation =
        action === 'finish'
          ? useDraftEditorStore.getState().finishDraft(vi.fn())
          : useDraftEditorStore.getState().discardDraft();
      vi.mocked(api.lockSessionDraft).mockResolvedValueOnce({
        locked: true,
        draft: { content: 'B content' },
      } as any);
      await useDraftEditorStore.getState().openEditor('B');
      useBottomPanelStore.setState({ activeTab: 'draft' });
      stale.resolve(undefined);
      await operation;
      expect(useDraftEditorStore.getState()).toMatchObject({
        activeSessionId: 'B',
        localContent: 'B content',
      });
      expect(useBottomPanelStore.getState().activeTab).toBe('draft');
    }
  );

  it('does not mark an empty server draft as existing when opening the editor', async () => {
    vi.mocked(api.lockSessionDraft).mockResolvedValue({ locked: true, draft: null } as any);

    await useDraftEditorStore.getState().openEditor('session-1');

    expect(useDraftEditorStore.getState().draftExists['session-1']).toBe(false);
  });

  it('treats whitespace-only drafts as non-existent', async () => {
    vi.mocked(api.getSessionDraft).mockResolvedValue({ content: '   ' } as any);

    const exists = await useDraftEditorStore.getState().checkDraftExists('session-1');

    expect(exists).toBe(false);
    expect(useDraftEditorStore.getState().draftExists['session-1']).toBe(false);
  });

  it('deletes empty drafts instead of keeping the blue dot on close', async () => {
    vi.mocked(api.deleteSessionDraft).mockResolvedValue(undefined as any);
    vi.mocked(api.unlockSessionDraft).mockResolvedValue(undefined as any);

    useDraftEditorStore.setState({
      activeSessionId: 'session-1',
      localContent: '   ',
      isReadOnly: false,
      draftExists: { 'session-1': true },
    });

    await useDraftEditorStore.getState().closeEditor();

    expect(api.deleteSessionDraft).toHaveBeenCalledWith('session-1');
    expect(useDraftEditorStore.getState().draftExists['session-1']).toBe(false);
  });
});
