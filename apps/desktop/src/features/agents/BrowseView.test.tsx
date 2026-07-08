import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowseView } from './BrowseView';
import type { LibraryItem } from './agents-types';

const backends = [{ backendId: 'b1', name: 'This Device', online: true }];
const items: LibraryItem[] = [
  { kind: 'profile', backendId: 'b1', id: 'p1', title: 'Coding', subtitle: 'deepseek-v4-flash' },
  { kind: 'skill', backendId: 'b1', id: 's1', title: 'web-search', subtitle: 'Fan-out research' },
];

function setup(overrides = {}) {
  const props = {
    tab: 'profiles' as const,
    backendFilter: 'all',
    backends,
    items,
    onOpen: vi.fn(),
    onSelectBackendFilter: vi.fn(),
    onNew: vi.fn(),
    ...overrides,
  };
  render(<BrowseView {...props} />);
  return props;
}

describe('BrowseView', () => {
  it('renders a card per item', () => {
    setup();
    expect(screen.getByRole('button', { name: /Coding/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /web-search/ })).toBeInTheDocument();
  });

  it('filters cards by the search query', () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'coding' } });
    expect(screen.getByRole('button', { name: /Coding/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /web-search/ })).not.toBeInTheDocument();
  });

  it('opens an item card', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /Coding/ }));
    expect(props.onOpen).toHaveBeenCalledWith(items[0]);
  });

  it('shows an empty state when there are no items', () => {
    setup({ items: [] });
    expect(screen.getByText(/Nothing here yet|No items/i)).toBeInTheDocument();
  });
});
