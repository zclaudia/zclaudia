import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toggle } from '../Toggle';

describe('Toggle', () => {
  it('reflects checked state and toggles on click', () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} aria-label="Feature" />);
    const sw = screen.getByRole('switch', { name: 'Feature' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does not fire when disabled', () => {
    const onChange = vi.fn();
    render(<Toggle checked disabled onChange={onChange} aria-label="Feature" />);
    fireEvent.click(screen.getByRole('switch', { name: 'Feature' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
