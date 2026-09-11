import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NewProjectModal } from '../NewProjectModal';
import { listAgentProfilesForBackend } from '../../../services/api/agent-profiles';

vi.mock('../../../services/api/agent-profiles', () => ({ listAgentProfilesForBackend: vi.fn() }));

beforeEach(() => {
  vi.mocked(listAgentProfilesForBackend).mockResolvedValue([
    { id: 'default-agent', name: 'My agent', isDefault: true },
  ] as never);
});

const baseProps = {
  open: true,
  onClose: () => {},
  name: 'My Project',
  onNameChange: () => {},
  rootPath: '',
  onRootPathChange: () => {},
  onCreate: () => {},
  creatingProject: false,
  isConnected: true,
  isMobile: false,
  onSelectedBackendIdChange: () => {},
};

const backends = [
  { backendId: 'local', name: 'Local Server', online: true },
  { backendId: 'remote', name: 'Prod Box', online: true },
];

describe('NewProjectModal', () => {
  it('renders the dialog with name and working directory fields', () => {
    render(<NewProjectModal {...baseProps} backends={[backends[0]]} selectedBackendId="local" />);
    expect(screen.getByRole('dialog', { name: 'New project' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Project name')).toBeInTheDocument();
    expect(screen.getByLabelText('Working directory')).toBeInTheDocument();
  });

  it('does not render the backend picker when only one backend is online', () => {
    render(<NewProjectModal {...baseProps} backends={[backends[0]]} selectedBackendId="local" />);
    expect(screen.queryByLabelText('Create in backend')).toBeNull();
  });

  it('shows the backend picker with an option per backend when several are online', () => {
    render(<NewProjectModal {...baseProps} backends={backends} selectedBackendId="local" />);
    const trigger = screen.getByLabelText('Create in backend');
    expect(trigger).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole('option', { name: /Local Server/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Prod Box/ })).toBeInTheDocument();
  });

  it('reports the chosen backend', () => {
    const onSelectedBackendIdChange = vi.fn();
    render(
      <NewProjectModal
        {...baseProps}
        backends={backends}
        selectedBackendId="local"
        onSelectedBackendIdChange={onSelectedBackendIdChange}
      />
    );
    fireEvent.click(screen.getByLabelText('Create in backend'));
    fireEvent.click(screen.getByRole('option', { name: /Prod Box/ }));
    expect(onSelectedBackendIdChange).toHaveBeenCalledWith('remote');
  });

  it('creates on Create click and blocks it while the name is empty', async () => {
    const onCreate = vi.fn();
    const { rerender } = render(
      <NewProjectModal
        {...baseProps}
        name=""
        backends={[backends[0]]}
        selectedBackendId="local"
        onCreate={onCreate}
      />
    );
    const createBtn = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);

    rerender(
      <NewProjectModal
        {...baseProps}
        name="My Project"
        backends={[backends[0]]}
        selectedBackendId="local"
        onCreate={onCreate}
      />
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith('default-agent');
  });

  it('requires an explicit choice when the backend has no default agent', async () => {
    vi.mocked(listAgentProfilesForBackend).mockResolvedValue([
      { id: 'codex', name: 'Codex Agent', runtimeType: 'codex' },
    ] as never);
    const onCreate = vi.fn();
    render(
      <NewProjectModal
        {...baseProps}
        backends={backends}
        selectedBackendId="remote"
        onCreate={onCreate}
      />
    );
    fireEvent.click(await screen.findByLabelText('Project coding agent'));
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    fireEvent.click(screen.getByRole('option', { name: 'Codex Agent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(listAgentProfilesForBackend).toHaveBeenCalledWith('remote');
    expect(onCreate).toHaveBeenCalledWith('codex');
  });

  it('closes on Cancel', () => {
    const onClose = vi.fn();
    render(
      <NewProjectModal
        {...baseProps}
        backends={[backends[0]]}
        selectedBackendId="local"
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
