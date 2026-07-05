// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentsTree } from '../AgentsTree';
import type { AgentsBackend, ProfilesByBackend } from '../useProfilesByBackend';
import type { AgentsSelection } from '../agents-types';

const backends: AgentsBackend[] = [
  { backendId: 'b1', name: 'Local Server', online: true },
  { backendId: 'b2', name: 'Remote Server', online: false },
];

function emptyData(overrides?: Partial<ProfilesByBackend>): ProfilesByBackend {
  return {
    profiles: new Map(),
    errors: new Map(),
    loading: false,
    ...overrides,
  };
}

const baseProps = {
  backends,
  data: emptyData(),
  selection: null as AgentsSelection | null,
  expandedBackendIds: [] as string[],
  onToggleBackend: vi.fn(),
  onSelectItem: vi.fn(),
};

describe('AgentsTree', () => {
  it('renders one group per backend, in order', () => {
    render(<AgentsTree {...baseProps} />);
    expect(screen.getByText('Local Server')).toBeInTheDocument();
    expect(screen.getByText('Remote Server')).toBeInTheDocument();
  });

  it('online group shows a success status dot', () => {
    render(<AgentsTree {...baseProps} />);
    const row = screen.getByText('Local Server').closest('button')!;
    const dot = row.querySelector('span.h-2.w-2')!;
    expect(dot.className).toContain('bg-success');
  });

  it('offline group shows a muted status dot and is dimmed', () => {
    render(<AgentsTree {...baseProps} />);
    const row = screen.getByText('Remote Server').closest('button')!;
    const dot = row.querySelector('span.h-2.w-2')!;
    expect(dot.className).toContain('bg-muted-foreground');
    expect(dot.className).not.toContain('bg-success');

    const header = screen.getByText('Remote Server').closest('div.group')!;
    expect(header.className).toContain('opacity-60');
  });

  it('offline group has no chevron and no + button', () => {
    render(<AgentsTree {...baseProps} />);
    const header = screen.getByText('Remote Server').closest('div.group')!;
    expect(header.querySelector('svg.lucide-chevron-right')).toBeNull();
    expect(header.querySelector('button[aria-label="New profile"]')).toBeNull();
  });

  it('clicking offline group header does not call onToggleBackend', () => {
    const onToggleBackend = vi.fn();
    render(<AgentsTree {...baseProps} onToggleBackend={onToggleBackend} />);
    fireEvent.click(screen.getByText('Remote Server'));
    expect(onToggleBackend).not.toHaveBeenCalled();
  });

  it('online group header has a chevron', () => {
    render(<AgentsTree {...baseProps} />);
    const header = screen.getByText('Local Server').closest('div.group')!;
    expect(header.querySelector('svg.lucide-chevron-right')).not.toBeNull();
  });

  it('clicking online group header calls onToggleBackend with backendId', () => {
    const onToggleBackend = vi.fn();
    render(<AgentsTree {...baseProps} onToggleBackend={onToggleBackend} />);
    fireEvent.click(screen.getByText('Local Server'));
    expect(onToggleBackend).toHaveBeenCalledWith('b1');
  });

  it('children do not render when backend is not expanded', () => {
    render(
      <AgentsTree
        {...baseProps}
        data={emptyData({ profiles: new Map([['b1', []]]) })}
        expandedBackendIds={[]}
      />
    );
    expect(screen.queryByText('No profiles')).toBeNull();
  });

  it('offline group children never render even if included in expandedBackendIds', () => {
    render(
      <AgentsTree
        {...baseProps}
        data={emptyData({ profiles: new Map([['b2', []]]) })}
        expandedBackendIds={['b2']}
      />
    );
    expect(screen.queryByText('No profiles')).toBeNull();
  });

  it('expanded online group with loading and no entry yet shows Loading…', () => {
    render(
      <AgentsTree {...baseProps} data={emptyData({ loading: true })} expandedBackendIds={['b1']} />
    );
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('expanded online group with an error shows error text', () => {
    render(
      <AgentsTree
        {...baseProps}
        data={emptyData({ errors: new Map([['b1', 'boom']]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText("Couldn't load profiles")).toBeInTheDocument();
  });

  it('expanded online group with empty profile array shows No profiles', () => {
    render(
      <AgentsTree
        {...baseProps}
        data={emptyData({ profiles: new Map([['b1', []]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText('No profiles')).toBeInTheDocument();
  });

  it('expanded online group renders profile rows', () => {
    const profiles = [
      { id: 'p1', name: 'Coder', isDefault: false } as any,
      { id: 'p2', name: 'Reviewer', isDefault: false } as any,
    ];
    render(
      <AgentsTree
        {...baseProps}
        data={emptyData({ profiles: new Map([['b1', profiles]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText('Coder')).toBeInTheDocument();
    expect(screen.getByText('Reviewer')).toBeInTheDocument();
  });

  it('default profile shows a Default badge', () => {
    const profiles = [{ id: 'p1', name: 'Coder', isDefault: true } as any];
    render(
      <AgentsTree
        {...baseProps}
        data={emptyData({ profiles: new Map([['b1', profiles]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('non-default profile shows no Default badge', () => {
    const profiles = [{ id: 'p1', name: 'Coder', isDefault: false } as any];
    render(
      <AgentsTree
        {...baseProps}
        data={emptyData({ profiles: new Map([['b1', profiles]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.queryByText('Default')).toBeNull();
  });

  it('clicking a profile row fires onSelectItem with kind profile', () => {
    const onSelectItem = vi.fn();
    const profiles = [{ id: 'p1', name: 'Coder', isDefault: false } as any];
    render(
      <AgentsTree
        {...baseProps}
        data={emptyData({ profiles: new Map([['b1', profiles]]) })}
        expandedBackendIds={['b1']}
        onSelectItem={onSelectItem}
      />
    );
    fireEvent.click(screen.getByText('Coder'));
    expect(onSelectItem).toHaveBeenCalledWith({ backendId: 'b1', kind: 'profile', id: 'p1' });
  });

  it('selected profile row has bg-secondary styling', () => {
    const profiles = [{ id: 'p1', name: 'Coder', isDefault: false } as any];
    render(
      <AgentsTree
        {...baseProps}
        data={emptyData({ profiles: new Map([['b1', profiles]]) })}
        expandedBackendIds={['b1']}
        selection={{ backendId: 'b1', kind: 'profile', id: 'p1' }}
      />
    );
    const row = screen.getByText('Coder').closest('button')!;
    expect(row.className).toContain('bg-secondary');
  });

  it('unselected profile row does not have bg-secondary styling', () => {
    const profiles = [{ id: 'p1', name: 'Coder', isDefault: false } as any];
    render(
      <AgentsTree
        {...baseProps}
        data={emptyData({ profiles: new Map([['b1', profiles]]) })}
        expandedBackendIds={['b1']}
        selection={{ backendId: 'b1', kind: 'profile', id: 'p2' }}
      />
    );
    const row = screen.getByText('Coder').closest('button')!;
    expect(row.className.split(/\s+/)).not.toContain('bg-secondary');
  });

  it('online group has a + button with New profile label', () => {
    render(<AgentsTree {...baseProps} />);
    expect(screen.getByRole('button', { name: 'New profile' })).toBeInTheDocument();
  });

  it('clicking + fires onSelectItem with kind new', () => {
    const onSelectItem = vi.fn();
    render(<AgentsTree {...baseProps} onSelectItem={onSelectItem} />);
    fireEvent.click(screen.getByRole('button', { name: 'New profile' }));
    expect(onSelectItem).toHaveBeenCalledWith({ backendId: 'b1', kind: 'new' });
  });
});
