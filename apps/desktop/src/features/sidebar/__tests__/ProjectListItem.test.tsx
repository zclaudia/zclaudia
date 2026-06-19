import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectListItem } from '../ProjectListItem';
import type { ProjectListItemProps } from '../types';

const mockProject = {
  id: 'proj-1',
  name: 'Test Project',
  rootPath: '/home/user/code/test',
  backendId: 'local',
  createdAt: Date.now(),
  updatedAt: Date.now(),
} as any;

const mockSession = {
  id: 'sess-1',
  name: 'Existing Session',
  projectId: 'proj-1',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  type: 'interactive' as const,
  lastRunStatus: undefined,
  planStatus: undefined,
} as any;

function makeProps(overrides: Partial<ProjectListItemProps> = {}): ProjectListItemProps {
  return {
    project: mockProject,
    isExpanded: true,
    onToggle: vi.fn(),
    sessions: [mockSession],
    selectedSessionId: null,
    onSelectSession: vi.fn(),
    onOpenDashboard: vi.fn(),
    hasPendingForSession: vi.fn(() => false),
    activeRunSessionIds: new Set(),
    getProviderName: vi.fn(() => undefined),
    getWorktreeBranch: vi.fn(() => undefined),
    supervisorAgent: undefined,
    worktrees: [],
    expandedWorktrees: new Set(),
    onToggleWorktree: vi.fn(),
    onDeleteWorktree: vi.fn(),
    regularSessionsCollapsed: false,
    onToggleRegularSessions: vi.fn(),
    onReorderSessions: vi.fn(),
    isMobile: false,
    contextMenuProject: null,
    contextMenuPos: null,
    onOpenContextMenu: vi.fn(),
    onCloseContextMenu: vi.fn(),
    onSettingsProject: vi.fn(),
    onDeleteProject: vi.fn(),
    isCreatingSession: false,
    newSessionName: '',
    onNewSessionNameChange: vi.fn(),
    newSessionAgentProfileId: '',
    onNewSessionAgentProfileIdChange: vi.fn(),
    onStartCreatingSession: vi.fn(),
    onCreateSession: vi.fn(),
    onCancelCreateSession: vi.fn(),
    isConnected: true,
    agents: [],
    ...overrides,
  };
}

describe('ProjectListItem', () => {
  it('shows a New session quick action that calls onStartCreatingSession', () => {
    const onStartCreatingSession = vi.fn();
    render(<ProjectListItem {...makeProps({ onStartCreatingSession })} />);
    fireEvent.click(screen.getByLabelText('New session'));
    expect(onStartCreatingSession).toHaveBeenCalledTimes(1);
  });

  it('disables the New session quick action when disconnected', () => {
    render(<ProjectListItem {...makeProps({ isConnected: false })} />);
    expect((screen.getByLabelText('New session') as HTMLButtonElement).disabled).toBe(true);
  });

  it('no longer renders a Chinese inline "新建 session" entry', () => {
    render(<ProjectListItem {...makeProps()} />);
    expect(screen.queryByText('新建 session')).toBeNull();
  });

  describe('worktree flattening', () => {
    const rootSession = {
      ...mockSession,
      id: 'root-sess',
      name: 'Root Session',
      workingDirectory: '/home/user/code/test',
    } as any;
    const wtSessionA = {
      ...mockSession,
      id: 'wt-a-1',
      name: 'Worktree A Session',
      workingDirectory: '/home/user/code/test/.worktrees/feat-a',
    } as any;
    const wtSessionA2 = {
      ...mockSession,
      id: 'wt-a-2',
      name: 'Worktree A Session 2',
      workingDirectory: '/home/user/code/test/.worktrees/feat-a',
    } as any;
    const worktrees = [
      { path: '/home/user/code/test', branch: 'main', isMain: true },
      { path: '/home/user/code/test/.worktrees/feat-a', branch: 'feat/a', isMain: false },
    ] as any;

    it('flattens a single-session worktree into a plain row with no group toggle', () => {
      render(
        <ProjectListItem
          {...makeProps({ sessions: [rootSession, wtSessionA], worktrees })}
        />
      );
      // The session shows directly...
      expect(screen.getByText('Worktree A Session')).toBeDefined();
      // ...with its git branch label (not the dir basename "feat-a")...
      expect(screen.getByText('feat/a')).toBeDefined();
      // ...and a remove-worktree affordance is reachable on the flat row.
      expect(screen.getByRole('button', { name: 'Remove worktree' })).toBeDefined();
    });

    it('keeps a collapsible group (with count) for worktrees with 2+ sessions', () => {
      render(
        <ProjectListItem
          {...makeProps({
            sessions: [rootSession, wtSessionA, wtSessionA2],
            worktrees,
            expandedWorktrees: new Set(['proj-1:/home/user/code/test/.worktrees/feat-a']),
          })}
        />
      );
      // Group header label is present...
      expect(screen.getByText('feat/a')).toBeDefined();
      // ...children render when expanded, and they do NOT repeat the branch tag
      // (only the group header carries it).
      expect(screen.getByText('Worktree A Session')).toBeDefined();
      // Single header-level "feat/a" only — no duplicate branch tags on children.
      expect(screen.getAllByText('feat/a')).toHaveLength(1);
    });
  });
});
