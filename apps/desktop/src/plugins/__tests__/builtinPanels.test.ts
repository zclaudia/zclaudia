import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePluginStore } from '../../stores/pluginStore';
import { initBuiltinPanels } from '../builtinPanels';
import type { UIExtension } from '../../stores/pluginStore';

const { terminal } = vi.hoisted(() => ({
  terminal: {
    drawerOpen: {} as Record<string, boolean>,
    setDrawerOpen: vi.fn(),
  },
}));

// Mock heavy component imports to prevent hangs in test environment
vi.mock('../../components/terminal/TerminalPanel', () => ({
  TerminalPanel: () => null,
  TerminalActions: () => null,
}));
vi.mock('../../components/fileviewer/FileViewerPanel', () => ({
  FileViewerPanel: () => null,
  FileViewerActions: () => null,
}));
vi.mock('../../components/draft/DraftPanel', () => ({
  DraftPanel: () => null,
}));
vi.mock('../../components/draft/DraftActions', () => ({
  DraftActions: () => null,
}));
vi.mock('../../components/notifications/NotificationsPanel', () => ({
  NotificationsPanel: () => null,
}));
vi.mock('../../features/changes/ChangesPanel', () => ({
  ChangesPanel: () => null,
}));
vi.mock('../../features/memory/MemoryPanel', () => ({
  MemoryPanel: () => null,
}));
vi.mock('../../features/lineage/LineagePanel', () => ({
  LineagePanel: () => null,
  LineageActions: () => null,
}));
vi.mock('../../features/git/components/GitSidebarPanel', () => ({
  GitSidebarPanel: () => null,
}));
vi.mock('../../features/browser/BrowserPanel', () => ({
  BrowserPanel: () => null,
}));
vi.mock('../../stores/terminalStore', () => ({
  useTerminalStore: { getState: () => terminal },
}));
vi.mock('../../stores/fileViewerStore', () => ({
  useFileViewerStore: { getState: () => ({ close: vi.fn() }) },
}));
vi.mock('../../stores/draftEditorStore', () => ({
  useDraftEditorStore: { getState: () => ({ closeEditor: vi.fn() }) },
}));

describe('initBuiltinPanels', () => {
  beforeEach(() => {
    terminal.drawerOpen = {};
    terminal.setDrawerOpen.mockReset();
    usePluginStore.setState({
      panels: [],
    } as any);
  });

  it('closes only the supplied terminal scope while retaining legacy close-all', () => {
    const panels: UIExtension[] = [];
    usePluginStore.setState({
      registerPanel: panel => {
        panels.push(panel);
      },
    });
    initBuiltinPanels();
    terminal.drawerOpen = {
      'backend-A::project': true,
      'backend-B::project': true,
      'no-backend::offline-project': true,
    };
    const onClose = panels.find(panel => panel.id === 'terminal')!.onClose!;
    onClose({
      sessionId: 'chat-A',
      projectId: 'project',
      backendId: 'backend-A',
      instanceKey: 'backend-A::project',
    });
    expect(terminal.setDrawerOpen).toHaveBeenCalledExactlyOnceWith('project', false, 'backend-A');
    terminal.setDrawerOpen.mockClear();
    onClose({
      sessionId: 'offline-chat',
      projectId: 'offline-project',
      backendId: null,
      instanceKey: 'no-backend::offline-project',
    });
    expect(terminal.setDrawerOpen).toHaveBeenCalledExactlyOnceWith(
      'offline-project',
      false,
      'no-backend'
    );
    terminal.setDrawerOpen.mockClear();
    onClose({ sessionId: 'unknown-chat' });
    expect(terminal.setDrawerOpen).not.toHaveBeenCalled();
    onClose();
    expect(terminal.setDrawerOpen).toHaveBeenCalledTimes(3);
    expect(terminal.setDrawerOpen).toHaveBeenCalledWith('project', false, 'backend-B');
  });

  it('registers terminal, file-viewer, draft, session-changes, memory, notifications, lineage, git, and browser panels', async () => {
    const registerSpy = vi.fn();
    usePluginStore.setState({ registerPanel: registerSpy } as any);

    // Re-import to get fresh module
    const { initBuiltinPanels } = await import('../builtinPanels');
    initBuiltinPanels();

    expect(registerSpy).toHaveBeenCalledTimes(9);
    expect(registerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'terminal', pluginId: 'com.claudia.terminal' })
    );
    expect(registerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'file-viewer', pluginId: 'com.claudia.file-viewer' })
    );
    expect(registerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'draft', pluginId: 'com.claudia.draft' })
    );
    expect(registerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'session-changes', pluginId: 'com.claudia.changes' })
    );
    expect(registerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'memory', pluginId: 'com.claudia.memory' })
    );
    expect(registerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'notifications', pluginId: 'com.claudia.notifications' })
    );
    expect(registerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'git', pluginId: 'com.zclaudia.git' })
    );
    expect(registerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'browser', pluginId: 'com.zclaudia.browser' })
    );
  });

  it('flags every registered panel as builtin so it appears in the management list', async () => {
    // The Settings "Built-in" list derives from panels.filter(p => p.builtin). Every
    // panel registered here is first-party, so all must carry the flag — this catches a
    // new tool being added without `builtin: true` (which would silently drop it from
    // management), the drift that hid Memory/Lineage/Git before.
    const registerSpy = vi.fn();
    usePluginStore.setState({ registerPanel: registerSpy } as any);

    const { initBuiltinPanels } = await import('../builtinPanels');
    initBuiltinPanels();

    const unflagged = registerSpy.mock.calls
      .map(([panel]) => panel)
      .filter(panel => panel.builtin !== true)
      .map(panel => panel.pluginId);
    expect(unflagged).toEqual([]);
  });

  it('places terminal, file-viewer, draft, and session-changes in the right sidebar by default', async () => {
    const registerSpy = vi.fn();
    usePluginStore.setState({ registerPanel: registerSpy } as any);

    const { initBuiltinPanels } = await import('../builtinPanels');
    initBuiltinPanels();

    for (const id of ['terminal', 'file-viewer', 'draft', 'session-changes']) {
      expect(registerSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id, defaultPlacement: 'right' })
      );
    }
  });

  it('registers the lineage panel for desktop and mobile', async () => {
    const registerSpy = vi.fn();
    usePluginStore.setState({ registerPanel: registerSpy } as any);

    const { initBuiltinPanels } = await import('../builtinPanels');
    initBuiltinPanels();

    expect(registerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'lineage',
        pluginId: 'com.claudia.lineage',
        platforms: ['desktop', 'mobile'],
        component: expect.any(Function),
        actions: expect.any(Function),
      })
    );
  });

  it('keeps git and browser desktop-only', async () => {
    const registerSpy = vi.fn();
    usePluginStore.setState({ registerPanel: registerSpy } as any);

    const { initBuiltinPanels } = await import('../builtinPanels');
    initBuiltinPanels();

    for (const id of ['git', 'browser']) {
      expect(registerSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id, platforms: ['desktop'] })
      );
    }
  });

  it('declares the terminal remoteTerminal capability requirement on the registration', async () => {
    const registerSpy = vi.fn();
    usePluginStore.setState({ registerPanel: registerSpy } as any);

    const { initBuiltinPanels } = await import('../builtinPanels');
    initBuiltinPanels();

    expect(registerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'terminal', requiresFeature: 'remoteTerminal' })
    );
    // Only the terminal is feature-gated today; others must not accidentally gain a gate.
    const gated = registerSpy.mock.calls
      .map(([panel]) => panel)
      .filter(panel => panel.requiresFeature !== undefined)
      .map(panel => panel.id);
    expect(gated).toEqual(['terminal']);
  });
});

// Capture the real registerPanel before it can be replaced by spies in the
// initBuiltinPanels describe block above — used to restore store integrity.
const realRegisterPanel = usePluginStore.getState().registerPanel;

describe('builtinPanels openMode', () => {
  beforeEach(() => {
    usePluginStore.setState({ panels: [], registerPanel: realRegisterPanel });
    initBuiltinPanels();
  });

  it('retains registered panel identity and open state on repeated bootstrap', () => {
    usePluginStore.getState().updatePanelVisibility('memory', true);
    const original = usePluginStore.getState().panels;
    initBuiltinPanels();
    expect(usePluginStore.getState().panels).toBe(original);
    expect(original.find(panel => panel.id === 'memory')?.visible).toBe(true);
  });

  it('restores a missing builtin without replacing other registered panels', () => {
    const terminal = usePluginStore.getState().panels.find(panel => panel.id === 'terminal');
    usePluginStore.getState().unregisterPanel('draft');
    initBuiltinPanels();
    const restored = usePluginStore.getState().panels;
    expect(restored).toHaveLength(9);
    expect(restored.find(panel => panel.id === 'terminal')).toBe(terminal);
    expect(restored.find(panel => panel.id === 'draft')?.builtin).toBe(true);
  });

  it('marks terminal / notifications / lineage / browser as dedicated', () => {
    const panels = usePluginStore.getState().panels;
    const byId = (id: string) => panels.find(p => p.id === id);
    expect(byId('terminal')?.openMode).toBe('dedicated');
    expect(byId('notifications')?.openMode).toBe('dedicated');
    expect(byId('lineage')?.openMode).toBe('dedicated');
    expect(byId('browser')?.openMode).toBe('dedicated');
  });

  it('marks file-viewer / draft / session-changes / memory / git as shared', () => {
    const panels = usePluginStore.getState().panels;
    const byId = (id: string) => panels.find(p => p.id === id);
    expect(byId('file-viewer')?.openMode).toBe('shared');
    expect(byId('draft')?.openMode).toBe('shared');
    expect(byId('session-changes')?.openMode).toBe('shared');
    expect(byId('memory')?.openMode).toBe('shared');
    expect(byId('git')?.openMode).toBe('shared');
  });
});
