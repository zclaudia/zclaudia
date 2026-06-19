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

  it('shows a Settings quick action that calls onSettingsProject', () => {
    const onSettingsProject = vi.fn();
    render(<ProjectListItem {...makeProps({ onSettingsProject })} />);
    fireEvent.click(screen.getByLabelText('Project settings'));
    expect(onSettingsProject).toHaveBeenCalledWith('proj-1');
  });

  it('disables the New session quick action when disconnected', () => {
    render(<ProjectListItem {...makeProps({ isConnected: false })} />);
    expect((screen.getByLabelText('New session') as HTMLButtonElement).disabled).toBe(true);
  });

  it('no longer renders a Chinese inline "新建 session" entry', () => {
    render(<ProjectListItem {...makeProps()} />);
    expect(screen.queryByText('新建 session')).toBeNull();
  });
});
