// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutomationWorkflowList } from '../AutomationWorkflowList';
import { useTopLevelViewStore } from '../../../stores/topLevelViewStore';

function makeApiWith(workflows: any[]) {
  return {
    get: vi.fn().mockImplementation((path: string) =>
      path.includes('workflow-templates') ? Promise.resolve([]) : Promise.resolve(workflows)),
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    del: vi.fn().mockResolvedValue(undefined),
  };
}

const userWorkflow = { id: 'wf-user', name: 'My Flow', isSystem: false, status: 'inactive', projectId: 'p1', authoringMode: 'advanced', definition: { nodes: [], edges: [], entryNodeId: '', triggers: [{ type: 'manual' }] } };

const baseProps = {
  projects: [{ id: 'p1', name: 'proj-one' }],
  projectName: (id?: string) => id ?? 'Global',
  projectId: 'p1',
};

beforeEach(() => {
  useTopLevelViewStore.setState({ selectedAutomationItemId: null, automationListRefreshNonce: 0 });
});

describe('AutomationWorkflowList', () => {
  it('renders fetched workflows and selects on click', async () => {
    render(<AutomationWorkflowList api={makeApiWith([userWorkflow]) as never} {...baseProps} />);
    fireEvent.click(await screen.findByText('My Flow'));
    expect(useTopLevelViewStore.getState().selectedAutomationItemId).toBe('wf-user');
  });

  it('disables + New when scoped globally', async () => {
    render(<AutomationWorkflowList api={makeApiWith([]) as never} {...baseProps} projectId={undefined} />);
    expect(await screen.findByRole('button', { name: 'New' })).toBeDisabled();
  });

  it('re-fetches when the refresh nonce bumps', async () => {
    const api = makeApiWith([userWorkflow]);
    render(<AutomationWorkflowList api={api as never} {...baseProps} />);
    await screen.findByText('My Flow');
    const before = api.get.mock.calls.length;
    useTopLevelViewStore.getState().bumpAutomationListRefresh();
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(before));
  });
});
