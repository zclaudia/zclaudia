// @vitest-environment jsdom

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AutomationScopeList } from '../AutomationScopeList';

const backends = [{ backendId: 'b1', name: 'Local Server', online: true }];
const projectsByBackend: Record<string, { id: string; name: string }[]> = {
  b1: [
    { id: 'p1', name: 'openclaw' },
    { id: 'p2', name: 'hermes-agent' },
  ],
};

function setup(overrides: Partial<React.ComponentProps<typeof AutomationScopeList>> = {}) {
  const props: React.ComponentProps<typeof AutomationScopeList> = {
    backends,
    getProjectsForBackend: (id) => projectsByBackend[id] ?? [],
    expandedBackendIds: ['b1'],
    onToggleBackend: vi.fn(),
    activeBackendId: 'b1',
    selectedProjectId: undefined,
    onSelectBackend: vi.fn(),
    onSelectProject: vi.fn(),
    ...overrides,
  };
  render(<AutomationScopeList {...props} />);
  return props;
}

describe('AutomationScopeList', () => {
  it('renders the backend and its projects', () => {
    setup();
    expect(screen.getByText('Local Server')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'openclaw' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'hermes-agent' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All projects' })).toBeTruthy();
  });

  it('scopes to a project on click', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'openclaw' }));
    expect(props.onSelectProject).toHaveBeenCalledWith('b1', 'p1');
  });

  it('scopes to the backend (global) via All projects', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'All projects' }));
    expect(props.onSelectBackend).toHaveBeenCalledWith('b1');
  });

  it('marks the selected project active', () => {
    setup({ selectedProjectId: 'p1' });
    expect(screen.getByRole('button', { name: 'openclaw' }).className).not.toContain('text-muted-foreground');
    expect(screen.getByRole('button', { name: 'hermes-agent' }).className).toContain('text-muted-foreground');
  });

  it('marks All projects active when no project is selected', () => {
    setup({ selectedProjectId: undefined });
    expect(screen.getByRole('button', { name: 'All projects' }).className).not.toContain('text-muted-foreground');
  });

  it('hides project rows when the backend is collapsed', () => {
    setup({ expandedBackendIds: [] });
    expect(screen.queryByRole('button', { name: 'openclaw' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'All projects' })).toBeNull();
    expect(screen.getByText('Local Server')).toBeTruthy();
  });

  it('shows an empty state when there are no backends', () => {
    setup({ backends: [] });
    expect(screen.getByText('No backends online')).toBeTruthy();
  });
});
