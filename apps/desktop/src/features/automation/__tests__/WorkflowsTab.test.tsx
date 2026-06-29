// @vitest-environment jsdom

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../workflows/components/WorkflowEditor', () => ({
  WorkflowEditor: (props: any) => (
    <div data-testid="wf-editor" data-readonly={String(!!props.readOnly)}>
      <button onClick={props.onBack}>editor-back</button>
      <button onClick={props.onSaved}>editor-save</button>
    </div>
  ),
}));

import { WorkflowsTab } from '../WorkflowsTab';

function makeApi() {
  return {
    get: vi.fn().mockResolvedValue([]),
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    del: vi.fn().mockResolvedValue(undefined),
  };
}

function makeApiWith(workflows: any[]) {
  return {
    get: vi.fn().mockImplementation((path: string) =>
      path.includes('workflow-templates') ? Promise.resolve([]) : Promise.resolve(workflows),
    ),
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    del: vi.fn().mockResolvedValue(undefined),
  };
}

const baseProps = {
  projects: [{ id: 'p1', name: 'proj-one' }],
  globalPermissionWorkflowOverrideId: null,
  projectName: (id?: string) => id ?? 'Global',
};

const systemWorkflow = {
  id: 'wf-sys',
  name: 'System Flow',
  isSystem: true,
  status: 'active',
  projectId: 'p1',
  authoringMode: 'advanced',
  definition: { nodes: [{ id: 'n1' }], edges: [], entryNodeId: 'n1', triggers: [{ type: 'manual' }] },
};

const userWorkflow = {
  id: 'wf-user',
  name: 'My Flow',
  isSystem: false,
  status: 'inactive',
  projectId: 'p1',
  authoringMode: 'advanced',
  definition: { nodes: [], edges: [], entryNodeId: '', triggers: [{ type: 'manual' }] },
};

describe('WorkflowsTab "+ New"', () => {
  it('is disabled when no project is scoped (global)', async () => {
    render(<WorkflowsTab api={makeApi() as never} {...baseProps} projectId={undefined} />);
    const btn = await screen.findByRole('button', { name: 'New' });
    expect(btn).toBeDisabled();
  });

  it('is enabled when a project is scoped', async () => {
    render(<WorkflowsTab api={makeApi() as never} {...baseProps} projectId="p1" />);
    const btn = await screen.findByRole('button', { name: 'New' });
    expect(btn).not.toBeDisabled();
  });
});

describe('WorkflowsTab inline editor', () => {
  it('renders the editor inline (read-only) when viewing a system workflow', async () => {
    render(<WorkflowsTab api={makeApiWith([systemWorkflow]) as never} {...baseProps} projectId="p1" />);
    fireEvent.click(await screen.findByTitle('View'));
    const editor = await screen.findByTestId('wf-editor');
    expect(editor).toHaveAttribute('data-readonly', 'true');
    expect(screen.queryByTitle('View')).toBeNull();
  });

  it('renders the editor inline (editable) when editing a workflow', async () => {
    render(<WorkflowsTab api={makeApiWith([userWorkflow]) as never} {...baseProps} projectId="p1" />);
    fireEvent.click(await screen.findByTitle('Edit'));
    const editor = await screen.findByTestId('wf-editor');
    expect(editor).toHaveAttribute('data-readonly', 'false');
  });

  it('returns to the list when the editor calls onBack', async () => {
    render(<WorkflowsTab api={makeApiWith([userWorkflow]) as never} {...baseProps} projectId="p1" />);
    fireEvent.click(await screen.findByTitle('Edit'));
    await screen.findByTestId('wf-editor');
    fireEvent.click(screen.getByText('editor-back'));
    expect(await screen.findByTitle('Edit')).toBeInTheDocument();
    expect(screen.queryByTestId('wf-editor')).toBeNull();
  });

  it('returns to the list and refreshes after onSaved', async () => {
    const api = makeApiWith([userWorkflow]);
    render(<WorkflowsTab api={api as never} {...baseProps} projectId="p1" />);
    fireEvent.click(await screen.findByTitle('Edit'));
    await screen.findByTestId('wf-editor');
    const callsBefore = api.get.mock.calls.length;
    fireEvent.click(screen.getByText('editor-save'));
    expect(await screen.findByTitle('Edit')).toBeInTheDocument();
    expect(screen.queryByTestId('wf-editor')).toBeNull();
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});
