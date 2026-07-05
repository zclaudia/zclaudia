// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProvidersTree } from '../ProvidersTree';
import type { AgentsBackend, AgentsSelection } from '../agents-types';
import type { LlmProfilesByBackend } from '../useLlmProfilesByBackend';

const backends: AgentsBackend[] = [
  { backendId: 'b1', name: 'Local Server', online: true },
  { backendId: 'b2', name: 'Remote Server', online: false },
];

function emptyData(overrides?: Partial<LlmProfilesByBackend>): LlmProfilesByBackend {
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

describe('ProvidersTree', () => {
  it('renders one group per backend, in order', () => {
    render(<ProvidersTree {...baseProps} />);
    expect(screen.getByText('Local Server')).toBeInTheDocument();
    expect(screen.getByText('Remote Server')).toBeInTheDocument();
  });

  it('online group shows a success status dot', () => {
    render(<ProvidersTree {...baseProps} />);
    const row = screen.getByText('Local Server').closest('button')!;
    const dot = row.querySelector('span.h-2.w-2')!;
    expect(dot.className).toContain('bg-success');
  });

  it('offline group shows a muted status dot and is dimmed', () => {
    render(<ProvidersTree {...baseProps} />);
    const row = screen.getByText('Remote Server').closest('button')!;
    const dot = row.querySelector('span.h-2.w-2')!;
    expect(dot.className).toContain('bg-muted-foreground');
    expect(dot.className).not.toContain('bg-success');

    const header = screen.getByText('Remote Server').closest('div.group')!;
    expect(header.className).toContain('opacity-60');
  });

  it('offline group has no chevron and no + button', () => {
    render(<ProvidersTree {...baseProps} />);
    const header = screen.getByText('Remote Server').closest('div.group')!;
    expect(header.querySelector('svg.lucide-chevron-right')).toBeNull();
    expect(header.querySelector('button[aria-label="New provider"]')).toBeNull();
  });

  it('clicking offline group header does not call onToggleBackend', () => {
    const onToggleBackend = vi.fn();
    render(<ProvidersTree {...baseProps} onToggleBackend={onToggleBackend} />);
    fireEvent.click(screen.getByText('Remote Server'));
    expect(onToggleBackend).not.toHaveBeenCalled();
  });

  it('clicking online group header calls onToggleBackend with backendId', () => {
    const onToggleBackend = vi.fn();
    render(<ProvidersTree {...baseProps} onToggleBackend={onToggleBackend} />);
    fireEvent.click(screen.getByText('Local Server'));
    expect(onToggleBackend).toHaveBeenCalledWith('b1');
  });

  it('children do not render when backend is not expanded', () => {
    render(
      <ProvidersTree
        {...baseProps}
        data={emptyData({ profiles: new Map([['b1', []]]) })}
        expandedBackendIds={[]}
      />
    );
    expect(screen.queryByText('No providers')).toBeNull();
  });

  it('offline group children never render even if included in expandedBackendIds', () => {
    render(
      <ProvidersTree
        {...baseProps}
        data={emptyData({ profiles: new Map([['b2', []]]) })}
        expandedBackendIds={['b2']}
      />
    );
    expect(screen.queryByText('No providers')).toBeNull();
  });

  it('expanded online group with loading and no entry yet shows Loading…', () => {
    render(
      <ProvidersTree
        {...baseProps}
        data={emptyData({ loading: true })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('keeps showing existing profiles during a background refetch (stale-while-refetch)', () => {
    const profiles = [{ id: 'p1', name: 'My Anthropic', providerType: 'anthropic' } as any];
    render(
      <ProvidersTree
        {...baseProps}
        data={emptyData({ loading: true, profiles: new Map([['b1', profiles]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText('My Anthropic')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('expanded online group with an error shows error text', () => {
    render(
      <ProvidersTree
        {...baseProps}
        data={emptyData({ errors: new Map([['b1', 'boom']]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText("Couldn't load providers")).toBeInTheDocument();
  });

  it('expanded online group with empty profile array shows No providers', () => {
    render(
      <ProvidersTree
        {...baseProps}
        data={emptyData({ profiles: new Map([['b1', []]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText('No providers')).toBeInTheDocument();
  });

  it('expanded online group renders profile rows', () => {
    const profiles = [
      { id: 'p1', name: 'My Anthropic', providerType: 'anthropic' } as any,
      { id: 'p2', name: 'My OpenAI', providerType: 'openai' } as any,
    ];
    render(
      <ProvidersTree
        {...baseProps}
        data={emptyData({ profiles: new Map([['b1', profiles]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText('My Anthropic')).toBeInTheDocument();
    expect(screen.getByText('My OpenAI')).toBeInTheDocument();
  });

  it('clicking a profile row fires onSelectItem with kind llm-profile', () => {
    const onSelectItem = vi.fn();
    const profiles = [{ id: 'p1', name: 'My Anthropic', providerType: 'anthropic' } as any];
    render(
      <ProvidersTree
        {...baseProps}
        data={emptyData({ profiles: new Map([['b1', profiles]]) })}
        expandedBackendIds={['b1']}
        onSelectItem={onSelectItem}
      />
    );
    fireEvent.click(screen.getByText('My Anthropic'));
    expect(onSelectItem).toHaveBeenCalledWith({ backendId: 'b1', kind: 'llm-profile', id: 'p1' });
  });

  it('selected profile row has bg-secondary styling', () => {
    const profiles = [{ id: 'p1', name: 'My Anthropic', providerType: 'anthropic' } as any];
    render(
      <ProvidersTree
        {...baseProps}
        data={emptyData({ profiles: new Map([['b1', profiles]]) })}
        expandedBackendIds={['b1']}
        selection={{ backendId: 'b1', kind: 'llm-profile', id: 'p1' }}
      />
    );
    const row = screen.getByText('My Anthropic').closest('button')!;
    expect(row.className).toContain('bg-secondary');
  });

  it('unselected profile row does not have bg-secondary styling', () => {
    const profiles = [{ id: 'p1', name: 'My Anthropic', providerType: 'anthropic' } as any];
    render(
      <ProvidersTree
        {...baseProps}
        data={emptyData({ profiles: new Map([['b1', profiles]]) })}
        expandedBackendIds={['b1']}
        selection={{ backendId: 'b1', kind: 'llm-profile', id: 'p2' }}
      />
    );
    const row = screen.getByText('My Anthropic').closest('button')!;
    expect(row.className.split(/\s+/)).not.toContain('bg-secondary');
  });

  it('profile row shows a providerType tag', () => {
    const profiles = [{ id: 'p1', name: 'My Anthropic', providerType: 'anthropic' } as any];
    render(
      <ProvidersTree
        {...baseProps}
        data={emptyData({ profiles: new Map([['b1', profiles]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText('anthropic')).toBeInTheDocument();
  });

  it('default profile shows a default tag', () => {
    const profiles = [
      { id: 'p1', name: 'My Anthropic', providerType: 'anthropic', isDefault: true } as any,
    ];
    render(
      <ProvidersTree
        {...baseProps}
        data={emptyData({ profiles: new Map([['b1', profiles]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText('default')).toBeInTheDocument();
  });

  it('non-default profile shows no default tag', () => {
    const profiles = [
      { id: 'p1', name: 'My Anthropic', providerType: 'anthropic', isDefault: false } as any,
    ];
    render(
      <ProvidersTree
        {...baseProps}
        data={emptyData({ profiles: new Map([['b1', profiles]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.queryByText('default')).toBeNull();
  });

  it('online group has a + button with New provider label', () => {
    render(<ProvidersTree {...baseProps} />);
    expect(screen.getByRole('button', { name: 'New provider' })).toBeInTheDocument();
  });

  it('clicking + fires onSelectItem with kind new-llm-profile', () => {
    const onSelectItem = vi.fn();
    render(<ProvidersTree {...baseProps} onSelectItem={onSelectItem} />);
    fireEvent.click(screen.getByRole('button', { name: 'New provider' }));
    expect(onSelectItem).toHaveBeenCalledWith({ backendId: 'b1', kind: 'new-llm-profile' });
  });
});
