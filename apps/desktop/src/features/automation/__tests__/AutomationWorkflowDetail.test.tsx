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

const apis = vi.hoisted(() => new Map<string, any>());
vi.mock('../useAutomationApi', () => ({
  createAutomationApi: (id: string) => apis.get(id) ?? { get: async () => [] },
}));

import { AutomationWorkflowDetail } from '../AutomationWorkflowDetail';
import { useTopLevelViewStore } from '../../../stores/topLevelViewStore';
import { makeBackend, makeScope } from './scopeTestUtils';

function installApi(backendId: string, workflow: any, list: any[] = []) {
  const api = {
    get: vi.fn().mockImplementation((path: string) => {
      if (path.includes('workflow-templates')) return Promise.resolve([]);
      // The unscoped list feeds the overview; a path with an id resolves the
      // selected workflow.
      if (path === '/api/workflows') return Promise.resolve(list);
      return Promise.resolve(workflow);
    }),
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    del: vi.fn().mockResolvedValue(undefined),
  };
  apis.set(backendId, api);
  return api;
}

const sys = {
  id: 'wf-sys',
  name: 'System Flow',
  isSystem: true,
  projectId: 'p1',
  definition: { nodes: [], edges: [], entryNodeId: '', triggers: [{ type: 'manual' }] },
};

const projectScope = () => makeScope([makeBackend('b1')], { projectId: 'p1' });

beforeEach(() => {
  apis.clear();
  useTopLevelViewStore.setState({
    selectedAutomationItemId: null,
    selectedAutomationItemBackendId: null,
    automationListRefreshNonce: 0,
  });
});

describe('AutomationWorkflowDetail', () => {
  it('prompts to enable a template when the project has no workflows', async () => {
    installApi('b1', sys);
    render(<AutomationWorkflowDetail scope={projectScope()} />);
    expect(await screen.findByText(/no workflows yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('wf-editor')).toBeNull();
  });

  it("lists the project's workflows plus bindable global ones and opens one on click", async () => {
    installApi('b1', sys, [
      { id: 'wf-1', name: 'Nightly Test & Fix', projectId: 'p1', status: 'active' },
      { id: 'wf-global', name: 'Global Flow', status: 'active' },
      { id: 'wf-other', name: 'Other Project Flow', projectId: 'p2', status: 'active' },
    ]);
    render(<AutomationWorkflowDetail scope={projectScope()} />);

    const row = await screen.findByRole('button', { name: /Nightly Test & Fix/ });
    expect(screen.getByText('Global Flow')).toBeInTheDocument();
    // Another project's workflow must not leak into this project's list.
    expect(screen.queryByText('Other Project Flow')).toBeNull();

    fireEvent.click(row);
    expect(useTopLevelViewStore.getState().selectedAutomationItemId).toBe('wf-1');
    expect(useTopLevelViewStore.getState().selectedAutomationItemBackendId).toBe('b1');
  });

  it('shows every backend as a group under "All"', async () => {
    installApi('b1', sys, [{ id: 'wf-1', name: 'Local Flow', status: 'active' }]);
    installApi('b2', sys, [{ id: 'wf-2', name: 'Remote Flow', status: 'draft' }]);
    render(
      <AutomationWorkflowDetail
        scope={makeScope([makeBackend('b1', 'Local'), makeBackend('b2', 'Remote')])}
      />
    );
    expect(await screen.findByText('Local Flow')).toBeInTheDocument();
    expect(screen.getByText('Remote Flow')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Local' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Remote' })).toBeInTheDocument();
  });

  it('renders a read-only editor for a selected system workflow on its backend', async () => {
    const api = installApi('b1', sys);
    useTopLevelViewStore.setState({
      selectedAutomationItemId: 'wf-sys',
      selectedAutomationItemBackendId: 'b1',
    });
    render(<AutomationWorkflowDetail scope={projectScope()} />);
    const editor = await screen.findByTestId('wf-editor');
    expect(editor).toHaveAttribute('data-readonly', 'true');
    expect(api.get).toHaveBeenCalledWith('/api/workflows/wf-sys');
  });

  it('clears selection when the editor calls onBack', async () => {
    installApi('b1', sys);
    useTopLevelViewStore.setState({
      selectedAutomationItemId: 'wf-sys',
      selectedAutomationItemBackendId: 'b1',
    });
    render(<AutomationWorkflowDetail scope={projectScope()} />);
    fireEvent.click(await screen.findByText('editor-back'));
    expect(useTopLevelViewStore.getState().selectedAutomationItemId).toBeNull();
  });
});
