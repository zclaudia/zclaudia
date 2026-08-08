import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HookList } from '../HookList';

const hooks = [
  { event: 'PreToolUse' as const, matcher: 'Bash(git *)', command: 'lint.sh', timeoutMs: 5000 },
  { event: 'PostToolUse' as const, command: 'audit.sh', enabled: false },
];

it('renders hook rows with event, matcher, command', () => {
  render(<HookList hooks={hooks} onChange={vi.fn()} />);
  expect(screen.getByDisplayValue('Bash(git *)')).toBeInTheDocument();
  expect(screen.getByDisplayValue('lint.sh')).toBeInTheDocument();
  expect(screen.getByDisplayValue('audit.sh')).toBeInTheDocument();
});

it('adds a new empty hook row', () => {
  const onChange = vi.fn();
  render(<HookList hooks={[]} onChange={onChange} />);
  fireEvent.click(screen.getByText(/add hook/i));
  expect(onChange).toHaveBeenCalledWith([{ event: 'PreToolUse', command: '' }]);
});

it('shows a validation error for a bad matcher and does not propagate it', () => {
  const onChange = vi.fn();
  render(<HookList hooks={[{ event: 'PreToolUse', command: 'x' }]} onChange={onChange} />);
  const matcherInput = screen.getByPlaceholderText(/Bash\(git \*\)/i);
  fireEvent.change(matcherInput, { target: { value: 'Bash(broken' } });
  expect(screen.getByText(/Missing closing parenthesis/i)).toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

it('removes a hook', () => {
  const onChange = vi.fn();
  render(<HookList hooks={hooks} onChange={onChange} />);
  fireEvent.click(screen.getAllByLabelText(/remove hook/i)[0]);
  expect(onChange).toHaveBeenCalledWith([hooks[1]]);
});

it('toggles enabled state', () => {
  const onChange = vi.fn();
  render(<HookList hooks={hooks} onChange={onChange} />);
  fireEvent.click(screen.getAllByLabelText(/hook enabled/i)[1]);
  // The second hook has enabled:false; toggling it on emits enabled:true
  expect(onChange).toHaveBeenCalledWith([
    hooks[0],
    { event: 'PostToolUse', command: 'audit.sh', enabled: true },
  ]);
});

it('edits the command', () => {
  const onChange = vi.fn();
  render(<HookList hooks={[{ event: 'PreToolUse', command: 'old.sh' }]} onChange={onChange} />);
  fireEvent.change(screen.getByDisplayValue('old.sh'), { target: { value: 'new.sh' } });
  expect(onChange).toHaveBeenCalledWith([{ event: 'PreToolUse', command: 'new.sh' }]);
});

describe('HookList read-only', () => {
  it('renders each hook as static text with no fields or add button', () => {
    render(<HookList hooks={hooks} onChange={vi.fn()} readOnly />);

    expect(screen.getByText('Bash(git *)')).toBeInTheDocument();
    expect(screen.getByText('lint.sh')).toBeInTheDocument();
    expect(screen.getByText('audit.sh')).toBeInTheDocument();
    expect(screen.getByText('(disabled)')).toBeInTheDocument();

    expect(screen.queryByDisplayValue('lint.sh')).toBeNull();
    expect(screen.queryByText(/add hook/i)).toBeNull();
    expect(screen.queryByLabelText('remove hook')).toBeNull();
  });

  it('keeps the privilege warning, which is the reason to show them at all', () => {
    render(<HookList hooks={[]} onChange={vi.fn()} readOnly />);
    expect(screen.getByText(/arbitrary shell commands/i)).toBeInTheDocument();
    expect(screen.getByText('No hooks configured.')).toBeInTheDocument();
  });
});
