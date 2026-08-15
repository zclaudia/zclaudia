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
  it('does not fetch item leaves while its offscreen drawer is disabled', () => {
    render(<AutomationTree {...baseProps} tab="workflows" enabled={false} />);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('workflows tab: expanding a project reveals workflow leaves', async () => {
    api.get.mockResolvedValue([
      { id: 'w1', name: 'Daily backup', status: 'active', projectId: 'p1' },
    ]);
    render(<AutomationTree {...baseProps} tab="workflows" />);
    // backend is already expanded -> the project row is visible
    const projectRow = await screen.findByRole('button', { name: 'gen-token' });
    fireEvent.click(projectRow);
    expect(await screen.findByText('Daily backup')).toBeInTheDocument();
  });

  it('workflows tab: a non-active backend project expands in a single click after activation', async () => {
    api.get.mockResolvedValue([
      { id: 'w2', name: 'Nightly sync', status: 'active', projectId: 'p2' },
    ]);
    const onSelectScope = vi.fn();
    const multiProps = {
      ...baseProps,
      onSelectScope,
      backends: [
        { backendId: 'b1', name: 'Local Server', online: true },
        { backendId: 'b2', name: 'Remote Server', online: true },
      ],
      expandedBackendIds: ['b1', 'b2'],
      getProjectsForBackend: (id: string) =>
        id === 'b2' ? [{ id: 'p2', name: 'remote-proj' }] : [{ id: 'p1', name: 'gen-token' }],
    };
    const { rerender } = render(
      <AutomationTree {...multiProps} tab="workflows" activeBackendId="b1" />
    );
    // b2 is not active yet — a single click on its project both selects scope and opens it.
    fireEvent.click(await screen.findByRole('button', { name: 'remote-proj' }));
    expect(onSelectScope).toHaveBeenCalledWith('b2', 'p2');
    // Parent reacts by activating b2; the leaf appears without a second click.
    rerender(<AutomationTree {...multiProps} tab="workflows" activeBackendId="b2" />);
    expect(await screen.findByText('Nightly sync')).toBeInTheDocument();
  });

  it('runs tab: shows All projects row and no leaves', async () => {
    render(<AutomationTree {...baseProps} tab="runs" />);
    expect(await screen.findByRole('button', { name: 'All projects' })).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled(); // runs does not fetch item leaves
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
