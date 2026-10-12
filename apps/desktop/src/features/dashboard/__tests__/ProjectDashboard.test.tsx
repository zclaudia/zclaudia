import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { ProjectDashboard } from '../ProjectDashboard';
import { useSupervisionStore } from '../../../features/supervision/store';
import { useProjectStore } from '../../../stores/projectStore';
import { useSelectionStore } from '../../../stores/selectionStore';

vi.mock('../../../services/api', () => ({
  getSupervisionAgent: vi.fn().mockResolvedValue(null),
  getSupervisionTasks: vi.fn().mockResolvedValue([]),
  getActiveProjectChange: vi.fn().mockResolvedValue(null),
  getChangeExecutionPlan: vi.fn().mockResolvedValue(null),
}));

vi.mock('../DashboardHome', () => ({
  DashboardHome: (props: any) => (
    <div data-testid="dashboard-home">
      <button onClick={() => props.onNavigate('tasks')}>go-tasks</button>
      <button onClick={() => props.onNavigate('supervisor')}>go-supervisor</button>
      <button onClick={() => props.onNavigate('local-prs')}>go-local-prs</button>
      <button onClick={() => props.onNavigate('issues')}>go-issues</button>
    </div>
  ),
}));

vi.mock('../../../features/supervision/components/TaskBoard', () => ({
  TaskBoard: () => <div data-testid="task-board" />,
}));

vi.mock('../../../features/supervision/components/ContextBrowser', () => ({
  ContextBrowser: () => <div data-testid="context-browser" />,
}));

vi.mock('../../../features/supervision/components/CheckpointFeed', () => ({
  CheckpointFeed: () => <div data-testid="checkpoint-feed" />,
}));

vi.mock('../../chat/ChatInterface', () => ({
  ChatInterface: (props: any) => <div data-testid="chat-interface">{props.sessionId}</div>,
}));
vi.mock('../../chat/SessionWorkspaceView', () => ({
  SessionWorkspaceView: (props: {
    sessionId: string;
    onReturnToDashboard?: (projectId: string) => void;
  }) => (
    <div data-testid="dashboard-unified-workspace" data-session-id={props.sessionId}>
      <button onClick={() => props.onReturnToDashboard?.('p1')}>Return from unified chat</button>
    </div>
  ),
}));

vi.mock('../../../features/supervision/components/SupervisorWorkspacePanel', () => ({
  SupervisorWorkspacePanel: () => <div data-testid="supervisor-workspace" />,
}));

vi.mock('../../../features/local-pr/components/LocalPRsPanel', () => ({
  LocalPRsPanel: () => <div data-testid="local-prs-panel" />,
}));

vi.mock('../../../features/local-issues/components/LocalIssuesPanel', () => ({
  LocalIssuesPanel: () => <div data-testid="local-issues-panel" />,
}));

describe('ProjectDashboard', () => {
  const projectId = 'p1';

  beforeEach(() => {
    useSupervisionStore.setState({
      tasks: {},
      agents: {},
      activeChanges: {},
      executionPlans: {},
      lastCheckpoint: {},
    });
    useProjectStore.setState({
      projects: [{ id: projectId, name: 'Test', rootPath: '/tmp' }],
      dashboardViews: {},
      setDashboardView: vi.fn(),
    } as any);
    useSelectionStore.setState({
      selectedProjectId: null,
      selectedSessionId: null,
      dashboardViews: {},
      setSelectedProjectId: vi.fn(),
      setSelectedSessionId: vi.fn(),
      setDashboardView: vi.fn(),
    } as any);
  });

  async function renderDashboard() {
    let utils!: ReturnType<typeof render>;
    await act(async () => {
      utils = render(<ProjectDashboard projectId={projectId} />);
    });
    return utils;
  }

  it('renders dashboard home by default', async () => {
    const { container } = await renderDashboard();
    expect(container.querySelector('[data-testid="dashboard-home"]')).toBeTruthy();
  });

  it('navigates to tasks view', async () => {
    const { container, getByText } = await renderDashboard();
    await act(async () => {
      fireEvent.click(getByText('go-tasks'));
    });
    expect(container.querySelector('[data-testid="task-board"]')).toBeTruthy();
    // Back breadcrumb should show
    expect(container.textContent).toContain('Dashboard');
    expect(container.textContent).toContain('Tasks');
  });

  it('navigates to local-prs view', async () => {
    const { container, getByText } = await renderDashboard();
    await act(async () => {
      fireEvent.click(getByText('go-local-prs'));
    });
    expect(container.querySelector('[data-testid="local-prs-panel"]')).toBeTruthy();
  });

  it('navigates to issues view', async () => {
    const { container, getByText } = await renderDashboard();
    await act(async () => {
      fireEvent.click(getByText('go-issues'));
    });
    expect(container.querySelector('[data-testid="local-issues-panel"]')).toBeTruthy();
  });

  it('navigates back to home from tasks view', async () => {
    const { container, getByText } = await renderDashboard();
    await act(async () => {
      fireEvent.click(getByText('go-tasks'));
    });
    expect(container.querySelector('[data-testid="task-board"]')).toBeTruthy();
    // Click back button
    const backBtn = Array.from(container.querySelectorAll('button')).find(
      b => b.textContent?.includes('Dashboard') && b.querySelector('svg')
    );
    if (backBtn) {
      await act(async () => {
        fireEvent.click(backBtn);
      });
      expect(container.querySelector('[data-testid="dashboard-home"]')).toBeTruthy();
    }
  });

  it('shows the supervisor workspace by default', async () => {
    useSupervisionStore.setState({
      tasks: {},
      agents: { [projectId]: { phase: 'active', mainSessionId: 'sess-123' } },
      activeChanges: {},
      executionPlans: {},
      lastCheckpoint: {},
    } as any);
    const { container, getByText } = await renderDashboard();
    await act(async () => {
      fireEvent.click(getByText('go-supervisor'));
    });
    expect(container.querySelector('[data-testid="supervisor-workspace"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="chat-interface"]')).toBeFalsy();
  });

  it('hosts supervisor chat through the unified layout and preserves dashboard navigation', async () => {
    useSupervisionStore.setState({
      agents: { [projectId]: { phase: 'active', mainSessionId: 'supervisor-session' } },
    } as any);
    useProjectStore.setState({
      sessions: [{ id: 'supervisor-session', projectId, type: 'background' }] as any,
    });
    const { container, getByText } = await renderDashboard();
    await act(async () => {
      fireEvent.click(getByText('go-supervisor'));
    });
    await act(async () => {
      fireEvent.click(getByText('Chat'));
    });
    expect(container.querySelector('[data-testid="dashboard-unified-workspace"]')).toHaveAttribute(
      'data-session-id',
      'supervisor-session'
    );
    expect(container.querySelector('[data-testid="chat-interface"]')).toBeNull();
    const back = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.includes('Dashboard') && button.querySelector('svg')
    );
    expect(back).toBeTruthy();
    if (back)
      await act(async () => {
        fireEvent.click(back);
      });
    expect(container.querySelector('[data-testid="dashboard-home"]')).toBeTruthy();
  });

  it('shows no supervisor message in chat view when no agent session', async () => {
    const { container, getByText } = await renderDashboard();
    await act(async () => {
      fireEvent.click(getByText('go-supervisor'));
    });
    expect(container.querySelector('[data-testid="supervisor-workspace"]')).toBeTruthy();

    await act(async () => {
      fireEvent.click(getByText('Chat'));
    });
    expect(container.textContent).toContain('No supervisor agent configured');
  });
});
