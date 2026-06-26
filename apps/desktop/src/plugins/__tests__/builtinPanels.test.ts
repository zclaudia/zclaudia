import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePluginStore } from '../../stores/pluginStore';
import { initBuiltinPanels } from '../builtinPanels';

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
}));
vi.mock('../../stores/terminalStore', () => ({
  useTerminalStore: { getState: () => ({ drawerOpen: {}, setDrawerOpen: vi.fn() }) },
}));
vi.mock('../../stores/fileViewerStore', () => ({
  useFileViewerStore: { getState: () => ({ close: vi.fn() }) },
}));
vi.mock('../../stores/draftEditorStore', () => ({
  useDraftEditorStore: { getState: () => ({ closeEditor: vi.fn() }) },
}));

describe('initBuiltinPanels', () => {
  beforeEach(() => {
    usePluginStore.setState({
      panels: [],
    } as any);
  });

  it('registers terminal, file-viewer, draft, session-changes, memory, and notifications panels', async () => {
    const registerSpy = vi.fn();
    usePluginStore.setState({ registerPanel: registerSpy } as any);

    // Re-import to get fresh module
    const { initBuiltinPanels } = await import('../builtinPanels');
    initBuiltinPanels();

    expect(registerSpy).toHaveBeenCalledTimes(7);
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
  });

  it('places terminal, file-viewer, draft, and session-changes in the right sidebar by default', async () => {
    const registerSpy = vi.fn();
    usePluginStore.setState({ registerPanel: registerSpy } as any);

    const { initBuiltinPanels } = await import('../builtinPanels');
    initBuiltinPanels();

    for (const id of ['terminal', 'file-viewer', 'draft', 'session-changes']) {
      expect(registerSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id, defaultPlacement: 'right' }),
      );
    }
  });

  it('registers the lineage panel for desktop', async () => {
    const registerSpy = vi.fn();
    usePluginStore.setState({ registerPanel: registerSpy } as any);

    const { initBuiltinPanels } = await import('../builtinPanels');
    initBuiltinPanels();

    expect(registerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'lineage',
        pluginId: 'com.claudia.lineage',
        platforms: ['desktop'],
        component: expect.any(Function),
      }),
    );
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

  it('marks terminal / notifications / lineage as dedicated', () => {
    const panels = usePluginStore.getState().panels;
    const byId = (id: string) => panels.find((p) => p.id === id);
    expect(byId('terminal')?.openMode).toBe('dedicated');
    expect(byId('notifications')?.openMode).toBe('dedicated');
    expect(byId('lineage')?.openMode).toBe('dedicated');
  });

  it('marks file-viewer / draft / session-changes / memory as shared', () => {
    const panels = usePluginStore.getState().panels;
    const byId = (id: string) => panels.find((p) => p.id === id);
    expect(byId('file-viewer')?.openMode).toBe('shared');
    expect(byId('draft')?.openMode).toBe('shared');
    expect(byId('session-changes')?.openMode).toBe('shared');
    expect(byId('memory')?.openMode).toBe('shared');
  });
});
