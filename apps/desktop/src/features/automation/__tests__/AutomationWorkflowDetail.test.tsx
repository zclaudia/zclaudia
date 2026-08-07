// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../workflows/components/WorkflowEditor', () => ({
  WorkflowEditor: (props: any) => (
    <div data-testid="wf-editor" data-readonly={String(!!props.readOnly)}>
      <button onClick={props.onBack}>editor-back</button>
    </div>
  ),
}));

import { AutomationWorkflowDetail } from '../AutomationWorkflowDetail';
import { useTopLevelViewStore } from '../../../stores/topLevelViewStore';

function apiReturning(workflow: any, list: any[] = []) {
  return {
    get: vi.fn().mockImplementation((path: string) => {
      if (path.includes('workflow-templates')) return Promise.resolve([]);
      // The unscoped list feeds the panel's own workflow picker; a path with an
      // id resolves the selected workflow.
      if (path === '/api/workflows') return Promise.resolve(list);
      return Promise.resolve(workflow);
    }),
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    del: vi.fn().mockResolvedValue(undefined),
  };
}

const sys = {
  id: 'wf-sys',
  name: 'System Flow',
  isSystem: true,
  projectId: 'p1',
  definition: { nodes: [], edges: [], entryNodeId: '', triggers: [{ type: 'manual' }] },
};

const baseProps = { projects: [{ id: 'p1', name: 'proj-one' }], projectId: 'p1' };

beforeEach(() => {
  useTopLevelViewStore.setState({ selectedAutomationItemId: null, automationListRefreshNonce: 0 });
});

describe('AutomationWorkflowDetail', () => {
  it('prompts to enable a template when the project has no workflows', async () => {
    render(<AutomationWorkflowDetail api={apiReturning(sys) as never} {...baseProps} />);
    expect(await screen.findByText(/no workflows yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('wf-editor')).toBeNull();
  });

  it("lists the project's workflows and opens one on click", async () => {
    // The sidebar tree is the only other route to a workflow, and its drawer
    // closes on a project tap — so this list is the sole mobile path in.
    const api = apiReturning(sys, [
      { id: 'wf-1', name: 'Nightly Test & Fix', projectId: 'p1', status: 'active' },
      { id: 'wf-global', name: 'Global Flow', status: 'active' },
    ]);
    render(<AutomationWorkflowDetail api={api as never} {...baseProps} />);

    const row = await screen.findByRole('button', { name: /Nightly Test & Fix/ });
    // A workflow on another scope must not leak into this project's list.
    expect(screen.queryByText('Global Flow')).toBeNull();

    fireEvent.click(row);
    expect(useTopLevelViewStore.getState().selectedAutomationItemId).toBe('wf-1');
  });

  it('renders a read-only editor for a selected system workflow', async () => {
    useTopLevelViewStore.setState({
      selectedAutomationItemId: 'wf-sys',
      automationListRefreshNonce: 0,
    });
    render(<AutomationWorkflowDetail api={apiReturning(sys) as never} {...baseProps} />);
    const editor = await screen.findByTestId('wf-editor');
    expect(editor).toHaveAttribute('data-readonly', 'true');
  });

  it('clears selection when the editor calls onBack', async () => {
    useTopLevelViewStore.setState({
      selectedAutomationItemId: 'wf-sys',
      automationListRefreshNonce: 0,
    });
    render(<AutomationWorkflowDetail api={apiReturning(sys) as never} {...baseProps} />);
    fireEvent.click(await screen.findByText('editor-back'));
    expect(useTopLevelViewStore.getState().selectedAutomationItemId).toBeNull();
  });
});
