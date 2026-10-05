import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { TaskPill } from '../TaskPill';

describe('TaskPill', () => {
  it('renders nothing when no tasks are running', () => {
    const { container } = render(<TaskPill runningCount={0} open={false} onToggle={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the running count', () => {
    const { getByText } = render(<TaskPill runningCount={3} open={false} onToggle={vi.fn()} />);
    expect(getByText('3')).toBeTruthy();
    expect(getByText('running')).toBeTruthy();
  });

  it('invokes onToggle when clicked', () => {
    const onToggle = vi.fn();
    const { getByTitle } = render(<TaskPill runningCount={1} open={false} onToggle={onToggle} />);
    fireEvent.click(getByTitle('Background tasks'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('reflects the open state via aria-expanded', () => {
    const { getByTitle } = render(<TaskPill runningCount={1} open={true} onToggle={vi.fn()} />);
    expect(getByTitle('Background tasks').getAttribute('aria-expanded')).toBe('true');
  });
});
