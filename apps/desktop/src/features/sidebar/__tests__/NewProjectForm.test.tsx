import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NewProjectForm } from '../NewProjectForm';

const baseProps = {
  showForm: true,
  onShowForm: () => {},
  newProjectName: 'My Project',
  onProjectNameChange: () => {},
  newProjectRootPath: '',
  onProjectRootPathChange: () => {},
  onCreateProject: () => {},
  creatingProject: false,
  isConnected: true,
  isMobile: false,
};

const backends = [
  { backendId: 'local', name: 'Local Server', online: true } as any,
  { backendId: 'remote', name: 'Prod Box', online: true } as any,
];

describe('NewProjectForm backend picker', () => {
  it('shows a backend select with an option per backend when multiple are online', () => {
    render(
      <NewProjectForm
        {...baseProps}
        backends={backends}
        selectedBackendId="local"
        onSelectedBackendIdChange={() => {}}
      />,
    );
    const select = screen.getByLabelText('Create in backend') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Local Server' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Prod Box' })).toBeInTheDocument();
  });

  it('does not show the select when only one backend is online', () => {
    render(
      <NewProjectForm
        {...baseProps}
        backends={[backends[0]]}
        selectedBackendId="local"
        onSelectedBackendIdChange={() => {}}
      />,
    );
    expect(screen.queryByLabelText('Create in backend')).toBeNull();
  });

  it('reports the chosen backend', () => {
    const onSelectedBackendIdChange = vi.fn();
    render(
      <NewProjectForm
        {...baseProps}
        backends={backends}
        selectedBackendId="local"
        onSelectedBackendIdChange={onSelectedBackendIdChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('Create in backend'), { target: { value: 'remote' } });
    expect(onSelectedBackendIdChange).toHaveBeenCalledWith('remote');
  });
});
