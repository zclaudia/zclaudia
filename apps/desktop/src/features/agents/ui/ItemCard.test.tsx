import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ItemCard } from './ItemCard';
import type { LibraryItem } from '../agents-types';

const item: LibraryItem = {
  kind: 'profile', backendId: 'b1', id: 'p1', title: 'Coding',
  subtitle: 'deepseek-v4-flash', status: 'Default',
};

describe('ItemCard', () => {
  it('shows title, subtitle, type badge, backend badge, and status', () => {
    render(<ItemCard item={item} backendName="This Device" backendOnline onOpen={() => {}} />);
    expect(screen.getByText('Coding')).toBeInTheDocument();
    expect(screen.getByText('deepseek-v4-flash')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('This Device')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('calls onOpen when clicked', () => {
    const onOpen = vi.fn();
    render(<ItemCard item={item} backendName="This Device" backendOnline onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /Coding/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
