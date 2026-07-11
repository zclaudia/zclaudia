import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NewSessionModal } from '../NewSessionModal';

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
    agents,
    name: '',
    onNameChange: vi.fn(),
    agentProfileId: '',
    onAgentProfileIdChange: vi.fn(),
    onCreate: vi.fn(),
    isConnected: true,
    ...overrides,
  };
  render(<NewSessionModal {...(props as any)} />);
  return props;
}

describe('NewSessionModal', () => {
  it('renders the name and agent fields', () => {
    setup();
    expect(screen.getByPlaceholderText('Session name (optional)')).toBeTruthy();
    expect(screen.getByText('Agent')).toBeTruthy();
  });

  it('shows the selected agent model hint', () => {
    setup({ agentProfileId: 'a2' });
    expect(screen.getByText('claude-haiku-4-5')).toBeTruthy();
  });

  it('shows the project directory as read-only (no way to change it)', () => {
    setup();
    expect(screen.getByText('Working directory')).toBeTruthy();
    expect(screen.getByText('/repo/openclaude')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
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
  });

  it('keeps Create enabled when the picker has a chosen project', () => {
    setup({ project: projects[1], projects, showProjectPicker: true, onProjectChange: vi.fn() });
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(
      false
    );
    expect(screen.getByText('/repo/gateway')).toBeTruthy();
  });
});
