// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AutomationTree } from '../AutomationTree';
import { useTopLevelViewStore } from '../../../stores/topLevelViewStore';

const api = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
} as any;

const baseProps = {
  api,
  activeBackendId: 'b1',
  selectedProjectId: undefined as string | undefined,
  backends: [{ backendId: 'b1', name: 'Local Server', online: true }],
  getProjectsForBackend: () => [{ id: 'p1', name: 'gen-token' }],
  expandedBackendIds: ['b1'],
  onToggleBackend: vi.fn(),
  onSelectScope: vi.fn(),
};

beforeEach(() => {
  api.get.mockReset();
  useTopLevelViewStore.setState({ selectedAutomationItemId: null, automationListRefreshNonce: 0 });
});

describe('AutomationTree', () => {
  it('workflows tab: expanding a project reveals workflow leaves', async () => {
    api.get.mockResolvedValue([
      { id: 'w1', name: 'Daily backup', status: 'active', projectId: 'p1' },
    ]);
    render(<AutomationTree {...baseProps} tab="workflows" />);
    // 服务器已展开 -> 看到项目行
    const projectRow = await screen.findByRole('button', { name: 'gen-token' });
    fireEvent.click(projectRow);
    expect(await screen.findByText('Daily backup')).toBeInTheDocument();
  });

  it('runs tab: shows All projects row and no leaves', async () => {
    render(<AutomationTree {...baseProps} tab="runs" />);
    expect(await screen.findByRole('button', { name: 'All projects' })).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled(); // runs 不拉条目
  });

  it('runs tab: clicking a project sets scope', async () => {
    const onSelectScope = vi.fn();
    render(<AutomationTree {...baseProps} tab="runs" onSelectScope={onSelectScope} />);
    fireEvent.click(await screen.findByRole('button', { name: 'gen-token' }));
    expect(onSelectScope).toHaveBeenCalledWith('b1', 'p1');
  });

  it('system tab: renders backend only, no project rows', async () => {
    render(<AutomationTree {...baseProps} tab="system" />);
    expect(screen.getByText('Local Server')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'gen-token' })).toBeNull();
  });

  it('workflows tab: clicking a leaf selects it in the store', async () => {
    api.get.mockResolvedValue([
      { id: 'w1', name: 'Daily backup', status: 'active', projectId: 'p1' },
    ]);
    const { useTopLevelViewStore } = await import('../../../stores/topLevelViewStore');
    render(<AutomationTree {...baseProps} tab="workflows" />);
    fireEvent.click(await screen.findByRole('button', { name: 'gen-token' }));
    fireEvent.click(await screen.findByText('Daily backup'));
    expect(useTopLevelViewStore.getState().selectedAutomationItemId).toBe('w1');
  });
});
