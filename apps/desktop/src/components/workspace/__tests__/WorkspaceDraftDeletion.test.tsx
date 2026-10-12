import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FlatWorkspaceView } from '../FlatWorkspaceView';
import { DraftPanel } from '../../draft/DraftPanel';
import { DraftActions } from '../../draft/DraftActions';
import { useDraftEditorStore } from '../../../stores/draftEditorStore';
import { useRightWorkspaceStore, flattenPanes } from '../../../stores/rightWorkspaceStore';
import { useProjectWorkspaceStore } from '../../../stores/projectWorkspaceStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionsStore } from '../../../stores/sessionsStore';
import { useSelectionStore } from '../../../stores/selectionStore';
import { usePluginStore } from '../../../stores/pluginStore';
import { resolveProjectWorkspace } from '../../../actions/projectWorkspaceActions';
import * as api from '../../../services/api';

vi.mock('../../../services/api', () => ({
  lockSessionDraft: vi
    .fn()
    .mockResolvedValue({ locked: true, draft: { content: 'deleted draft' } }),
  upsertSessionDraft: vi.fn().mockResolvedValue({ updatedAt: 1 }),
  deleteSessionDraft: vi.fn().mockResolvedValue(undefined),
  unlockSessionDraft: vi.fn().mockResolvedValue(undefined),
}));

describe('real draft tool after final chat deletion', () => {
  it('clears the deleted singleton and never reopens it after persistence hydration', async () => {
    vi.clearAllMocks();
    useSelectionStore.setState({ selectedSessionId: 'A' });
    const session = {
      id: 'A',
      projectId: 'project',
      type: 'regular' as const,
      createdAt: 1,
      updatedAt: 1,
    };
    useProjectStore.setState({
      sessions: [session],
      projects: [{ id: 'project', rootPath: '/repo' }] as any,
    });
    useSessionsStore.setState({ remoteSessions: new Map(), activeSessionIdsByBackend: new Map() });
    useProjectWorkspaceStore.setState({ byProject: {} });
    useRightWorkspaceStore.setState({ bySession: {}, order: [] });
    usePluginStore.setState({
      panels: [
        {
          id: 'draft',
          label: 'Draft',
          visible: true,
          component: DraftPanel,
          actions: DraftActions,
        },
      ] as any,
      disabledBuiltinPanels: [],
      panelPlacements: {},
    });
    useDraftEditorStore.setState({
      activeSessionId: 'A',
      localContent: 'deleted draft',
      isReadOnly: false,
      isSaving: false,
      sessionArchived: false,
      sendCallback: vi.fn(),
    });
    resolveProjectWorkspace('project', ['A'], 'A');
    useRightWorkspaceStore.getState().openTool('A', 'draft');
    const draftRef = flattenPanes(useRightWorkspaceStore.getState().bySession.A.root)
      .flatMap(pane => pane.tools)
      .find(ref => ref.toolId === 'draft');
    const view = render(
      <FlatWorkspaceView
        sessionId="A"
        projectId="project"
        projectRoot="/repo"
        collapsed={false}
        chatComponent={() => <div>Chat</div>}
      />
    );
    expect(screen.getByLabelText('Draft message')).toHaveValue('deleted draft');
    act(() =>
      useSessionsStore
        .getState()
        .handleSessionEvent('be', 'deleted', { ...session, isActive: false })
    );
    expect(useDraftEditorStore.getState().activeSessionId).toBeNull();
    expect(screen.queryByLabelText('Draft message')).toBeNull();
    expect(screen.queryByLabelText('Send to chat')).toBeNull();
    expect(screen.getByText('No chat selected')).toBeTruthy();
    expect(api.lockSessionDraft).not.toHaveBeenCalled();
    expect(
      flattenPanes(useRightWorkspaceStore.getState().bySession.A.root).flatMap(pane => pane.tools)
    ).toEqual([draftRef]);
    expect(useProjectWorkspaceStore.getState().byProject.project.focusedChatSessionId).toBe('');
    view.unmount();
    const layoutKey = useRightWorkspaceStore.persist.getOptions().name;
    const projectKey = useProjectWorkspaceStore.persist.getOptions().name;
    const layoutSaved = localStorage.getItem(layoutKey)!;
    const projectSaved = localStorage.getItem(projectKey)!;
    useRightWorkspaceStore.setState({ bySession: {}, order: [] });
    useProjectWorkspaceStore.setState({ byProject: {} });
    localStorage.setItem(layoutKey, layoutSaved);
    localStorage.setItem(projectKey, projectSaved);
    await act(async () => {
      await useRightWorkspaceStore.persist.rehydrate();
      await useProjectWorkspaceStore.persist.rehydrate();
    });

    expect(useProjectWorkspaceStore.getState().byProject.project.focusedChatSessionId).toBe('');
    render(
      <FlatWorkspaceView
        sessionId="A"
        projectId="project"
        projectRoot="/repo"
        collapsed={false}
        chatComponent={() => <div>Chat</div>}
      />
    );
    expect(screen.getByText('No chat selected')).toBeTruthy();
    expect(screen.queryByLabelText('Draft message')).toBeNull();
    expect(useDraftEditorStore.getState().activeSessionId).toBeNull();
    expect(api.lockSessionDraft).not.toHaveBeenCalled();
  });
});
