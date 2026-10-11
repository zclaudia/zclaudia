import { resolveProjectWorkspace } from '../../../actions/projectWorkspaceActions';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSidebarActions } from '../useSidebarActions';
import { useAppearanceStore } from '../../../stores/appearanceStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useRightWorkspaceStore, flattenPanes } from '../../../stores/rightWorkspaceStore';
import { useProjectWorkspaceStore } from '../../../stores/projectWorkspaceStore';

const { selectSession } = vi.hoisted(() => ({ selectSession: vi.fn() }));
vi.mock('../../../hooks/useSelectionCoordinator', () => ({
  useSelectionCoordinator: () => ({ selectSession, selectProject: vi.fn() }),
}));

function options(isMobile = false) {
  return {
    isConnected: true, isMobile, onClose: vi.fn(), addProject: vi.fn(), addSession: vi.fn(),
    deleteProject: vi.fn(), storeReorderProjects: vi.fn(), storeReorderSessions: vi.fn(),
    getFilteredSessionsForProject: () => [], setExpandedProjects: vi.fn(),
    setNewProjectName: vi.fn(), setNewProjectRootPath: vi.fn(), setShowNewProjectForm: vi.fn(),
    setNewSessionName: vi.fn(), setNewSessionAgentProfileId: vi.fn(), setCreatingSessionForProject: vi.fn(),
    setCreatingProject: vi.fn(), setContextMenuProject: vi.fn(), newProjectName: '', newProjectRootPath: '',
    newSessionName: '', newSessionAgentProfileId: '',
  };
}

describe('useSidebarActions workspace selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppearanceStore.setState({ unifiedWorkspace: true });
    useProjectWorkspaceStore.setState({ byProject: {} });
    useRightWorkspaceStore.setState({ bySession: {}, order: [] });
    useProjectStore.setState({ sessions: [
      { id: 'old-chat', projectId: 'project' },
      { id: 'new-chat', projectId: 'project' },
    ] as any });
  });

  it('adopts the existing project layout before replacing its focused chat', () => {
    useRightWorkspaceStore.getState().ensureChatSession('old-chat');
    const { result } = renderHook(() => useSidebarActions(options()));
    result.current.handleSessionSelect('new-chat');
    const project = useProjectWorkspaceStore.getState().byProject.project;
    expect(project.workspaceId).toBe('old-chat');
    expect(project.focusedChatSessionId).toBe('new-chat');
    expect(flattenPanes(useRightWorkspaceStore.getState().bySession['old-chat'].root)[0].tools)
      .toEqual([{ toolId: 'chat', instanceKey: 'new-chat' }]);
    expect(selectSession).toHaveBeenCalledWith('new-chat');
  });

  it('keeps mobile selection in the legacy flow and closes its drawer', () => {
    resolveProjectWorkspace('project', ['old-chat', 'new-chat'], 'old-chat');
    const props = options(true);
    const { result } = renderHook(() => useSidebarActions(props));
    result.current.handleSessionSelect('new-chat');
    expect(useProjectWorkspaceStore.getState().byProject.project.focusedChatSessionId).toBe('old-chat');
    expect(selectSession).toHaveBeenCalledWith('new-chat');
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
