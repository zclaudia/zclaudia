import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NewSessionModal } from '../NewSessionModal';

vi.mock('../DirectoryPickerModal', () => ({
  DirectoryPickerModal: ({ open, onSelect }: any) =>
    open ? (
      <button data-testid="pick-dir" onClick={() => onSelect('/picked/dir')}>
        pick
      </button>
    ) : null,
}));

const project = { id: 'p1', name: 'openclaude', rootPath: '/repo/openclaude' } as any;
const agents = [
  { id: 'a1', name: 'Coding', isDefault: true, model: 'claude-fable-5' },
  { id: 'a2', name: 'Fast', isDefault: false, model: 'claude-haiku-4-5' },
];

function setup(overrides: Record<string, unknown> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    project,
    backendId: 'local',
    agents,
    name: '',
    onNameChange: vi.fn(),
    agentProfileId: '',
    onAgentProfileIdChange: vi.fn(),
    workingDirectory: null,
    onWorkingDirectoryChange: vi.fn(),
    onCreate: vi.fn(),
    isConnected: true,
    ...overrides,
  };
  render(<NewSessionModal {...(props as any)} />);
  return props;
}

describe('NewSessionModal', () => {
  it('renders the three fields', () => {
    setup();
    expect(screen.getByPlaceholderText('Session name (optional)')).toBeTruthy();
    expect(screen.getByText('Agent')).toBeTruthy();
    expect(screen.getByText('Working directory')).toBeTruthy();
  });

  it('shows the selected agent model hint', () => {
    setup({ agentProfileId: 'a2' });
    expect(screen.getByText('claude-haiku-4-5')).toBeTruthy();
  });

  it('defaults the working directory display to the project root', () => {
    setup();
    expect(screen.getByText('/repo/openclaude')).toBeTruthy();
  });

  it('shows the chosen working directory when set', () => {
    setup({ workingDirectory: '/custom/path' });
    expect(screen.getByText('/custom/path')).toBeTruthy();
  });

  it('fires onCreate when Create is clicked', () => {
    const p = setup({ name: 'My session' });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(p.onCreate).toHaveBeenCalledTimes(1);
  });

  it('fires onCreate when Enter is pressed in the name field', () => {
    const p = setup();
    fireEvent.keyDown(screen.getByPlaceholderText('Session name (optional)'), { key: 'Enter' });
    expect(p.onCreate).toHaveBeenCalledTimes(1);
  });

  it('disables Create when disconnected', () => {
    setup({ isConnected: false });
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('closes on Cancel', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('picks a working directory through the directory picker', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.click(screen.getByTestId('pick-dir'));
    expect(p.onWorkingDirectoryChange).toHaveBeenCalledWith('/picked/dir');
  });

  const projects = [project, { id: 'p2', name: 'gateway', rootPath: '/repo/gateway' }] as any[];

  it('hides the project picker by default', () => {
    setup();
    expect(screen.queryByText('Project')).toBeNull();
  });

  it('renders a project picker and disables Create until a project is chosen', () => {
    setup({ project: null, projects, showProjectPicker: true, onProjectChange: vi.fn() });
    expect(screen.getByText('Project')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect((screen.getByRole('button', { name: 'Change' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('keeps Create enabled when the picker has a chosen project', () => {
    setup({ project: projects[1], projects, showProjectPicker: true, onProjectChange: vi.fn() });
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(
      false
    );
    expect(screen.getByText('/repo/gateway')).toBeTruthy();
  });
});
