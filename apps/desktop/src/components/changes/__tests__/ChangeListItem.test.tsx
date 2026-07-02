import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChangeListItem } from '../ChangeListItem';
import { usePluginStore } from '../../../stores/pluginStore';
import { useRightSidebarStore } from '../../../stores/rightSidebarStore';
import { useBottomPanelStore } from '../../../stores/bottomPanelStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSelectionStore } from '../../../stores/selectionStore';
import { useServerStore } from '../../../stores/serverStore';
import { useRightWorkspaceStore, findPaneWithTool } from '../../../stores/rightWorkspaceStore';
import type { ModifiedEntry } from '../useSessionChanges';

const mockOpenFile = vi.fn();
vi.mock('../../../stores/fileViewerStore', () => ({
  useFileViewerStore: (selector: any) => selector({ openFile: mockOpenFile }),
}));

const entry: ModifiedEntry = {
  path: 'src/index.ts',
  absolutePath: '/repo/src/index.ts',
  toolCounts: { Edit: 1 },
  groups: [
    {
      sinceUserMessageId: 'u1',
      sinceUserMessagePreview: 'change file',
      sinceUserMessageTimestamp: 100,
      fragments: [],
    },
  ],
  lastTimestamp: 110,
};

const SESSION_ID = 'sess-test-1';

describe('ChangeListItem', () => {
  beforeEach(() => {
    mockOpenFile.mockClear();
    usePluginStore.setState({
      panels: [
        {
          id: 'file-viewer',
          pluginId: 'com.claudia.file-viewer',
          type: 'panel',
          label: 'File',
          component: () => null,
          visible: true,
        },
      ],
      panelPlacements: { 'file-viewer': 'right' },
    });
    useRightSidebarStore.setState({ activeTab: 'session-changes', collapsed: false });
    useBottomPanelStore.setState({ activeTab: '' });
    // Set up project/server context so activatePanel can resolve the session
    useProjectStore.setState({
      selectedSessionId: SESSION_ID,
      sessions: [{ id: SESSION_ID, projectId: 'proj-1' } as any],
    });
    useSelectionStore.setState({ selectedSessionId: SESSION_ID });
    useServerStore.setState({ activeServerId: 'server-1' } as any);
    // Reset workspace so each test starts clean
    useRightWorkspaceStore.setState({ bySession: {}, order: [] });
  });

  it('opens the file and activates the file viewer panel', () => {
    render(
      <ChangeListItem entry={entry} projectRoot="/repo" expanded={false} onToggle={vi.fn()} />
    );

    fireEvent.click(screen.getByTitle('Open in File Viewer'));

    expect(mockOpenFile).toHaveBeenCalledWith('/repo', 'src/index.ts');
    // activatePanel now routes into the workspace (not rightSidebarStore.setActiveTab)
    const ws = useRightWorkspaceStore.getState();
    const root = ws.bySession[SESSION_ID]?.root ?? null;
    expect(findPaneWithTool(root, 'file-viewer', undefined, true)).not.toBeNull();
  });
});
