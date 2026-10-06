import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TodoUpdateSummary } from '../TodoUpdateSummary';

const TODOS = [
  { content: 'Extract verifyToken', status: 'completed' as const },
  { content: 'Write unit tests', status: 'in_progress' as const },
  { content: 'Run full suite', status: 'pending' as const },
];

describe('TodoUpdateSummary', () => {
  it('is a single line with progress until expanded', () => {
    render(<TodoUpdateSummary todos={TODOS} />);
    const toggle = screen.getByRole('button', { name: /Task list updated/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('1 of 3 done')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('expands to show that version of the list', () => {
    render(<TodoUpdateSummary todos={TODOS} />);
    fireEvent.click(screen.getByRole('button', { name: /Task list updated/ }));
    expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual(
      TODOS.map(t => t.content)
    );
    expect(screen.getByText('Write unit tests').closest('li')).toHaveAttribute(
      'data-status',
      'in_progress'
    );
  });
});
