import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Chip } from './Chip';

describe('Chip', () => {
  it('renders label and fires onRemove', () => {
    const onRemove = vi.fn();
    render(<Chip label="web-search" onRemove={onRemove} />);
    expect(screen.getByText('web-search')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /remove web-search/i }));
    expect(onRemove).toHaveBeenCalled();
  });
});
