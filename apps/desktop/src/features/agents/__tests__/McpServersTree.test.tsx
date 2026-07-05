// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { McpServerConfig, McpServerStatus } from '@zclaudia/shared';
import { McpServersTree } from '../McpServersTree';
import type { AgentsBackend, AgentsSelection } from '../agents-types';
import type { McpServersByBackend } from '../useMcpServersByBackend';

const backends: AgentsBackend[] = [
  { backendId: 'b1', name: 'Local Server', online: true },
  { backendId: 'b2', name: 'Remote Server', online: false },
];

function server(overrides?: Partial<McpServerConfig>): McpServerConfig {
  return { id: 'm1', name: 'context7', enabled: true, ...overrides } as McpServerConfig;
}

function status(state: McpServerStatus['state']): McpServerStatus {
  return { name: 'context7', state };
}

function emptyData(overrides?: Partial<McpServersByBackend>): McpServersByBackend {
  return {
    servers: new Map(),
    statuses: new Map(),
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

/** The leading status dot of the row containing the given server name. */
function dotFor(name: string): Element {
  const row = screen.getByText(name).closest('button')!;
  return row.querySelector('span.w-1\\.5.h-1\\.5')!;
}

describe('McpServersTree', () => {
  it('renders one group per backend, in order', () => {
    render(<McpServersTree {...baseProps} />);
    expect(screen.getByText('Local Server')).toBeInTheDocument();
    expect(screen.getByText('Remote Server')).toBeInTheDocument();
  });

  it('offline group is dimmed and never renders children even when expanded', () => {
    render(
      <McpServersTree
        {...baseProps}
        data={emptyData({ servers: new Map([['b2', []]]) })}
        expandedBackendIds={['b2']}
      />
    );
    const header = screen.getByText('Remote Server').closest('div.group')!;
    expect(header.className).toContain('opacity-60');
    expect(screen.queryByText('No MCP servers')).toBeNull();
  });

  it('children do not render when backend is not expanded', () => {
    render(
      <McpServersTree
        {...baseProps}
        data={emptyData({ servers: new Map([['b1', []]]) })}
        expandedBackendIds={[]}
      />
    );
    expect(screen.queryByText('No MCP servers')).toBeNull();
  });

  it('clicking online group header calls onToggleBackend with backendId', () => {
    const onToggleBackend = vi.fn();
    render(<McpServersTree {...baseProps} onToggleBackend={onToggleBackend} />);
    fireEvent.click(screen.getByText('Local Server'));
    expect(onToggleBackend).toHaveBeenCalledWith('b1');
  });

  it('expanded online group with loading and no entry yet shows Loading…', () => {
    render(
      <McpServersTree
        {...baseProps}
        data={emptyData({ loading: true })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('keeps showing existing servers during a background refetch (stale-while-refetch)', () => {
    render(
      <McpServersTree
        {...baseProps}
        data={emptyData({ loading: true, servers: new Map([['b1', [server()]]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText('context7')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('expanded online group with an error shows error text', () => {
    render(
      <McpServersTree
        {...baseProps}
        data={emptyData({ errors: new Map([['b1', 'boom']]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText("Couldn't load MCP servers")).toBeInTheDocument();
  });

  it('expanded online group with empty server array shows No MCP servers', () => {
    render(
      <McpServersTree
        {...baseProps}
        data={emptyData({ servers: new Map([['b1', []]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText('No MCP servers')).toBeInTheDocument();
  });

  it('expanded online group renders server rows', () => {
    const servers = [server(), server({ id: 'm2', name: 'playwright' })];
    render(
      <McpServersTree
        {...baseProps}
        data={emptyData({ servers: new Map([['b1', servers]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText('context7')).toBeInTheDocument();
    expect(screen.getByText('playwright')).toBeInTheDocument();
  });

  it('clicking a server row fires onSelectItem with kind mcp-server', () => {
    const onSelectItem = vi.fn();
    render(
      <McpServersTree
        {...baseProps}
        data={emptyData({ servers: new Map([['b1', [server()]]]) })}
        expandedBackendIds={['b1']}
        onSelectItem={onSelectItem}
      />
    );
    fireEvent.click(screen.getByText('context7'));
    expect(onSelectItem).toHaveBeenCalledWith({ backendId: 'b1', kind: 'mcp-server', id: 'm1' });
  });

  it('selected server row has bg-secondary styling', () => {
    render(
      <McpServersTree
        {...baseProps}
        data={emptyData({ servers: new Map([['b1', [server()]]]) })}
        expandedBackendIds={['b1']}
        selection={{ backendId: 'b1', kind: 'mcp-server', id: 'm1' }}
      />
    );
    const row = screen.getByText('context7').closest('button')!;
    expect(row.className).toContain('bg-secondary');
  });

  it('unselected server row does not have bg-secondary styling', () => {
    render(
      <McpServersTree
        {...baseProps}
        data={emptyData({ servers: new Map([['b1', [server()]]]) })}
        expandedBackendIds={['b1']}
        selection={{ backendId: 'b1', kind: 'mcp-server', id: 'other' }}
      />
    );
    const row = screen.getByText('context7').closest('button')!;
    expect(row.className.split(/\s+/)).not.toContain('bg-secondary');
  });

  it('online group has a + button with New MCP server label', () => {
    render(<McpServersTree {...baseProps} />);
    expect(screen.getByRole('button', { name: 'New MCP server' })).toBeInTheDocument();
  });

  it('clicking + fires onSelectItem with kind new-mcp-server', () => {
    const onSelectItem = vi.fn();
    render(<McpServersTree {...baseProps} onSelectItem={onSelectItem} />);
    fireEvent.click(screen.getByRole('button', { name: 'New MCP server' }));
    expect(onSelectItem).toHaveBeenCalledWith({ backendId: 'b1', kind: 'new-mcp-server' });
  });

  describe('status dot', () => {
    function renderWithStatus(state: McpServerStatus['state']) {
      render(
        <McpServersTree
          {...baseProps}
          data={emptyData({
            servers: new Map([['b1', [server()]]]),
            statuses: new Map([['b1', { context7: status(state) }]]),
          })}
          expandedBackendIds={['b1']}
        />
      );
    }

    it('connected server shows a success dot', () => {
      renderWithStatus('connected');
      const dot = dotFor('context7');
      expect(dot.className).toContain('bg-success');
      expect(dot.className).not.toContain('animate-pulse');
    });

    it('connecting server shows a pulsing success dot', () => {
      renderWithStatus('connecting');
      const dot = dotFor('context7');
      expect(dot.className).toContain('bg-success');
      expect(dot.className).toContain('animate-pulse');
    });

    it('failed server shows a destructive dot', () => {
      renderWithStatus('failed');
      expect(dotFor('context7').className).toContain('bg-destructive');
    });

    it('needs-auth server shows a warning dot', () => {
      renderWithStatus('needs-auth');
      expect(dotFor('context7').className).toContain('bg-warning');
    });

    it('configured (not yet connected) server shows a muted dot', () => {
      renderWithStatus('configured');
      expect(dotFor('context7').className).toContain('bg-muted-foreground/40');
    });

    it('idle-disconnected server shows a muted dot', () => {
      renderWithStatus('idle-disconnected');
      expect(dotFor('context7').className).toContain('bg-muted-foreground/40');
    });

    it('server without a status entry shows a muted dot', () => {
      render(
        <McpServersTree
          {...baseProps}
          data={emptyData({ servers: new Map([['b1', [server()]]]) })}
          expandedBackendIds={['b1']}
        />
      );
      expect(dotFor('context7').className).toContain('bg-muted-foreground/40');
    });

    it('disabled server shows a muted dot even when its status says connected', () => {
      render(
        <McpServersTree
          {...baseProps}
          data={emptyData({
            servers: new Map([['b1', [server({ enabled: false })]]]),
            statuses: new Map([['b1', { context7: status('connected') }]]),
          })}
          expandedBackendIds={['b1']}
        />
      );
      const dot = dotFor('context7');
      expect(dot.className).toContain('bg-muted-foreground/40');
      expect(dot.className.split(/\s+/)).not.toContain('bg-success');
    });
  });

  it('disabled server shows a disabled tag', () => {
    render(
      <McpServersTree
        {...baseProps}
        data={emptyData({ servers: new Map([['b1', [server({ enabled: false })]]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.getByText('disabled')).toBeInTheDocument();
  });

  it('enabled server shows no disabled tag', () => {
    render(
      <McpServersTree
        {...baseProps}
        data={emptyData({ servers: new Map([['b1', [server()]]]) })}
        expandedBackendIds={['b1']}
      />
    );
    expect(screen.queryByText('disabled')).toBeNull();
  });
});
