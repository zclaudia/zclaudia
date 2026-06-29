// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AutomationScopeDropdown } from '../AutomationScopeDropdown';

const scopeProps = {
  backends: [{ backendId: 'b1', name: 'local', online: true }],
  getProjectsForBackend: () => [{ id: 'p1', name: 'proj-one' }],
  expandedBackendIds: ['b1'],
  onToggleBackend: () => {},
  activeBackendId: 'b1',
  selectedProjectId: undefined,
  onSelectBackend: vi.fn(),
  onSelectProject: vi.fn(),
};

describe('AutomationScopeDropdown', () => {
  it('shows the current scope label and opens the list on click', () => {
    render(<AutomationScopeDropdown label="All projects" {...scopeProps} />);
    const trigger = screen.getByRole('button', { name: /scope/i });
    expect(trigger).toHaveTextContent('All projects');
    expect(screen.queryByRole('button', { name: 'proj-one' })).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'proj-one' })).toBeInTheDocument();
  });

  it('closes the popover after selecting a project', () => {
    render(<AutomationScopeDropdown label="All projects" {...scopeProps} />);
    fireEvent.click(screen.getByRole('button', { name: /scope/i }));
    fireEvent.click(screen.getByRole('button', { name: 'proj-one' }));
    expect(scopeProps.onSelectProject).toHaveBeenCalledWith('b1', 'p1');
    expect(screen.queryByRole('button', { name: 'proj-one' })).toBeNull();
  });
});
