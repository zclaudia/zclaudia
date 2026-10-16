import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSidebarActions } from '../useSidebarActions';

const { createProject, selectProject } = vi.hoisted(() => ({
  createProject: vi.fn(),
  selectProject: vi.fn(),
}));

vi.mock('../../../hooks/useSelectionCoordinator', () => ({
  useSelectionCoordinator: () => ({ selectSession: vi.fn(), selectProject }),
}));
vi.mock('../../../services/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../services/api')>()),
  createProject,
}));

function options(overrides: Record<string, unknown> = {}) {
  return {
    isConnected: true,
    addProject: vi.fn(),
    addSession: vi.fn(),
    deleteProject: vi.fn(),
    storeReorderProjects: vi.fn(),
    storeReorderSessions: vi.fn(),
    getFilteredSessionsForProject: () => [],
    setExpandedProjects: vi.fn(),
    setNewProjectName: vi.fn(),
    setNewProjectRootPath: vi.fn(),
    setNewProjectAdditionalPaths: vi.fn(),
    setNewProjectError: vi.fn(),
    setShowNewProjectForm: vi.fn(),
    setNewSessionName: vi.fn(),
    setNewSessionAgentProfileId: vi.fn(),
    setCreatingSessionForProject: vi.fn(),
    setCreatingProject: vi.fn(),
    setContextMenuProject: vi.fn(),
    newProjectName: 'App',
    newProjectRootPath: ' /work/app ',
    newProjectAdditionalPaths: [' /work/lib ', '', '  '],
    newSessionName: '',
    newSessionAgentProfileId: '',
    ...overrides,
  };
}

describe('useSidebarActions.handleCreateProject additional directories', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends trimmed non-blank additional paths and resets the form', async () => {
    createProject.mockResolvedValue({ id: 'p1', name: 'App' });
    const opts = options();
    const { result } = renderHook(() => useSidebarActions(opts as never));
    await act(() => result.current.handleCreateProject('local'));

    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({ rootPath: '/work/app', additionalPaths: ['/work/lib'] }),
      'local'
    );
    expect(opts.setNewProjectAdditionalPaths).toHaveBeenCalledWith([]);
    expect(opts.setNewProjectError).toHaveBeenCalledWith(null);
  });

  it('omits additionalPaths when none are set', async () => {
    createProject.mockResolvedValue({ id: 'p1', name: 'App' });
    const opts = options({ newProjectAdditionalPaths: [] });
    const { result } = renderHook(() => useSidebarActions(opts as never));
    await act(() => result.current.handleCreateProject('local'));
    expect(createProject.mock.calls[0][0]).not.toHaveProperty('additionalPaths');
  });

  it('surfaces a server validation error and keeps the form open', async () => {
    createProject.mockRejectedValue(new Error('Additional directory must exist: /nope'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const opts = options();
    const { result } = renderHook(() => useSidebarActions(opts as never));
    await act(() => result.current.handleCreateProject('local'));

    expect(opts.setNewProjectError).toHaveBeenLastCalledWith(
      'Additional directory must exist: /nope'
    );
    expect(opts.setShowNewProjectForm).not.toHaveBeenCalled();
  });
});
