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

function apiReturning(workflow: any) {
  return {
    get: vi
      .fn()
      .mockImplementation((path: string) =>
        path.includes('workflow-templates') ? Promise.resolve([]) : Promise.resolve(workflow)
      ),
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
  it('shows the empty state with templates when nothing is selected', async () => {
    render(<AutomationWorkflowDetail api={apiReturning(sys) as never} {...baseProps} />);
    expect(await screen.findByText(/select a workflow/i)).toBeInTheDocument();
    expect(screen.queryByTestId('wf-editor')).toBeNull();
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
