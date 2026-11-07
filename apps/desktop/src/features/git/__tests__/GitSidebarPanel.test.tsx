import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '../../../services/api';

const apiMocks = vi.hoisted(() => ({
  getProjectWorktrees: vi.fn(),
  getWorktreeStatus: vi.fn(),
}));

vi.mock('../../../services/api', async importOriginal => ({
  ...(await importOriginal<typeof ApiModule>()),
  ...apiMocks,
}));

import { GitSidebarPanel } from '../components/GitSidebarPanel';
import { useGitStore } from '../store';

const mainWorktree = { path: '/repo', branch: 'main', isMain: true, commit: 'abc1234' };
const linkedWorktree = { path: '/repo-wt', branch: 'feature/x', isMain: false };

const cleanStatus = {
  clean: true,
  staged: [],
  unstaged: [],
  untracked: [],
  currentBranch: 'main',
  ahead: 0,
  behind: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  useGitStore.setState({
    worktrees: {},
    selectedWorktree: {},
    statusByPath: {},
    branchesByPath: {},
    logByPath: {},
    stashByPath: {},
  });
  apiMocks.getProjectWorktrees.mockResolvedValue([mainWorktree]);
  apiMocks.getWorktreeStatus.mockResolvedValue(cleanStatus);
});

describe('GitSidebarPanel worktree resolution', () => {
  it('falls back to the backend main worktree when no session/project path is known', async () => {
    render(<GitSidebarPanel projectId="p1" />);

    expect(await screen.findByText('main')).toBeInTheDocument();
    expect(screen.queryByText('No git worktree available.')).not.toBeInTheDocument();
    await waitFor(() => expect(apiMocks.getWorktreeStatus).toHaveBeenCalledWith('p1', '/repo'));
  });

  it('prefers the session worktree over the main worktree', async () => {
    apiMocks.getProjectWorktrees.mockResolvedValue([mainWorktree, linkedWorktree]);

    render(<GitSidebarPanel projectId="p1" workingDirectory="/repo-wt" />);

    await waitFor(() => expect(apiMocks.getWorktreeStatus).toHaveBeenCalledWith('p1', '/repo-wt'));
    expect(screen.queryByText('No git worktree available.')).not.toBeInTheDocument();
  });

  it('reports an empty backend worktree list instead of the local-path hint', async () => {
    apiMocks.getProjectWorktrees.mockResolvedValue([]);

    render(<GitSidebarPanel projectId="p1" />);

    expect(await screen.findByText('No git worktree available.')).toBeInTheDocument();
    expect(
      screen.getByText("The backend didn't report a worktree for this project.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Open a session in a project with a local path to use git.')
    ).not.toBeInTheDocument();
  });

  it('asks for a project when none is provided', () => {
    render(<GitSidebarPanel />);

    expect(screen.getByText('No project selected.')).toBeInTheDocument();
  });
});
