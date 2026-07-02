import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ToolRuleList } from '../ToolRuleList';

const rules = [
  { toolName: 'Bash', pattern: '^git(\\s.*)?$', action: 'approve' as const },
  { toolName: 'Bash', pattern: '^rm .*$', action: 'deny' as const },
  { toolName: 'WebFetch', action: 'escalate' as const },
];

describe('ToolRuleList', () => {
  it('groups rules by action and renders syntax text', () => {
    render(<ToolRuleList rules={rules} onChange={vi.fn()} />);
    expect(screen.getByText('Bash(git *)')).toBeInTheDocument();
    expect(screen.getByText('Bash(rm *)')).toBeInTheDocument();
    expect(screen.getByText('WebFetch')).toBeInTheDocument();
    expect(screen.getByText('Allow')).toBeInTheDocument();
    expect(screen.getByText('Ask')).toBeInTheDocument();
    expect(screen.getByText('Deny')).toBeInTheDocument();
  });

  it('adds a parsed rule to the right group on Enter', () => {
    const onChange = vi.fn();
    render(<ToolRuleList rules={[]} onChange={onChange} />);
    const input = screen.getAllByPlaceholderText('Bash(git *)')[0]; // Allow group input (first)
    fireEvent.change(input, { target: { value: 'Read(*.md)' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith([
      { toolName: 'Read', pattern: '^.*\\.md$', action: 'approve' },
    ]);
  });

  it('shows inline error for invalid syntax and does not call onChange', () => {
    const onChange = vi.fn();
    render(<ToolRuleList rules={[]} onChange={onChange} />);
    const input = screen.getAllByPlaceholderText('Bash(git *)')[0];
    fireEvent.change(input, { target: { value: 'Bash(broken' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Missing closing parenthesis/i)).toBeInTheDocument();
  });

  it('removes a rule', () => {
    const onChange = vi.fn();
    render(<ToolRuleList rules={rules} onChange={onChange} />);
    fireEvent.click(screen.getAllByLabelText(/remove rule/i)[0]);
    expect(onChange).toHaveBeenCalledWith(rules.slice(1));
  });

  it('renders continue-action rules in a read-only Advanced group', () => {
    render(
      <ToolRuleList
        rules={[{ toolName: 'Bash', pattern: '^x$', action: 'continue' as const }]}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.queryAllByLabelText(/remove rule/i)).toHaveLength(0);
  });
});
