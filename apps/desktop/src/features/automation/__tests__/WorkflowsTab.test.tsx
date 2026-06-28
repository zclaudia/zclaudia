// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WorkflowsTab } from '../WorkflowsTab';

function makeApi() {
  return {
    get: vi.fn().mockResolvedValue([]),
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    del: vi.fn().mockResolvedValue(undefined),
  };
}

const baseProps = {
  projects: [{ id: 'p1', name: 'proj-one' }],
  globalPermissionWorkflowOverrideId: null,
  projectName: (id?: string) => id ?? 'Global',
  serverUrl: 'http://localhost:3100',
  selectedBackendId: 'b1',
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
