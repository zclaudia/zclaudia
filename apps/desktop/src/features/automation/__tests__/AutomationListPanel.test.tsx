// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../AutomationWorkflowList', () => ({
  AutomationWorkflowList: () => <div data-testid="wf-list" />,
}));

import { AutomationListPanel } from '../AutomationListPanel';

function makeApi() {
  return { get: vi.fn().mockResolvedValue([]), post: vi.fn(), patch: vi.fn(), del: vi.fn() };
}
const props = { api: makeApi() as never, projects: [], projectId: 'p1' };

describe('AutomationListPanel', () => {
  it('renders the workflow list for the workflows tab', () => {
    render(<AutomationListPanel tab="workflows" {...props} />);
    expect(screen.getByTestId('wf-list')).toBeInTheDocument();
  });

  it('renders nothing for not-yet-migrated tabs', () => {
    const { container } = render(<AutomationListPanel tab="runs" {...props} />);
    expect(screen.queryByTestId('wf-list')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});
