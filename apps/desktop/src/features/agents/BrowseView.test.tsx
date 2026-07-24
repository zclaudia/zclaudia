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

  it('groups cards under backend headers when multiple backends exist', () => {
    setup({
      backends: [
        { backendId: 'b1', name: 'This Device', online: true },
        { backendId: 'b2', name: 'Remote Box', online: false },
      ],
      items: [
        ...items,
        { kind: 'profile', backendId: 'b2', id: 'p2', title: 'Reviewer', subtitle: 'gpt-6' },
      ],
    });
    expect(screen.getByRole('heading', { name: 'This Device' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Remote Box' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reviewer/ })).toBeInTheDocument();
    // Cards no longer repeat the backend badge — the group header carries it.
    expect(screen.getAllByText('This Device')).toHaveLength(2); // filter chip + group header
  });

  it('renders a flat list without headers when a single backend is filtered', () => {
    setup({
      backends: [
        { backendId: 'b1', name: 'This Device', online: true },
        { backendId: 'b2', name: 'Remote Box', online: true },
      ],
      backendFilter: 'b1',
    });
    expect(screen.queryByRole('heading', { name: 'This Device' })).not.toBeInTheDocument();
    // The card keeps its own backend badge in flat mode.
    expect(screen.getAllByText('This Device').length).toBeGreaterThan(1);
  });

  it('skill cards get a delete menu that fires onDeleteSkill', () => {
    const onDeleteSkill = vi.fn();
    setup({
      items: [{ kind: 'skill', backendId: 'b1', id: 's1', title: 'web-search' }],
      onDeleteSkill,
    });
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete skill' }));
    expect(onDeleteSkill).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
  });

  it('read-only (source-managed) skill cards have no menu', () => {
    setup({
      items: [{ kind: 'skill', backendId: 'b1', id: 's1', title: 'plug-skill', deletable: false }],
    });
    expect(screen.getByRole('button', { name: /plug-skill/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
  });

  it('mcp server cards get a delete menu that fires onDeleteMcpServer', () => {
    const onDeleteMcpServer = vi.fn();
    setup({
      items: [{ kind: 'mcp-server', backendId: 'b1', id: 'm1', title: 'filesystem' }],
      onDeleteMcpServer,
    });
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete server' }));
    expect(onDeleteMcpServer).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
  });
});
