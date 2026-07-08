import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterChips } from './FilterChips';

const chips = [
  { key: 'all', label: 'All' },
  { key: 'b1', label: 'This Device', online: true },
];

describe('FilterChips', () => {
  it('marks the active chip pressed and fires onSelect', () => {
    const onSelect = vi.fn();
    render(<FilterChips chips={chips} activeKey="all" onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /This Device/ }));
    expect(onSelect).toHaveBeenCalledWith('b1');
  });
});
