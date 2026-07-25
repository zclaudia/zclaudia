import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ItemCard } from './ItemCard';
import type { LibraryItem } from '../agents-types';

const item: LibraryItem = {
  kind: 'profile',
  backendId: 'b1',
  id: 'p1',
  title: 'Coding',
  subtitle: 'deepseek-v4-flash',
  status: 'Default',
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

  it('hides the backend badge when showBackendBadge is false', () => {
    render(
      <ItemCard
        item={item}
        backendName="This Device"
        backendOnline
        showBackendBadge={false}
        onOpen={() => {}}
      />
    );
    expect(screen.queryByText('This Device')).not.toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('opens profile actions without opening the card', () => {
    const onOpen = vi.fn();
    const onSetDefault = vi.fn();
    render(
      <ItemCard
        item={item}
        backendName="This Device"
        backendOnline
        onOpen={onOpen}
        actions={[{ label: 'Set as default agent', onSelect: onSetDefault }]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menu')).toHaveClass('fixed');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Set as default agent' }));

    expect(onSetDefault).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('renders the Draft chip when recordStatus is draft', () => {
    const draftItem: LibraryItem = {
      ...item,
      recordStatus: { completeness: 'draft', availability: { usable: true } },
    };
    render(<ItemCard item={draftItem} backendName="This Device" backendOnline onOpen={() => {}} />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('renders no chip when recordStatus is ready', () => {
    const readyItem: LibraryItem = {
      ...item,
      recordStatus: { completeness: 'ready', availability: { usable: true } },
    };
    render(<ItemCard item={readyItem} backendName="This Device" backendOnline onOpen={() => {}} />);
    expect(screen.queryByText('Draft')).not.toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('Disabled')).not.toBeInTheDocument();
  });
});
