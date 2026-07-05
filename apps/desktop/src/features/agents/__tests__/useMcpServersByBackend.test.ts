// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { McpServerConfig, McpServerStatus } from '@zclaudia/shared';

import { useMcpServersByBackend } from '../useMcpServersByBackend';
import type { AgentsBackend } from '../agents-types';
import { useTopLevelViewStore } from '../../../stores/topLevelViewStore';
import * as api from '../../../services/api';

vi.mock('../../../services/api', () => ({
  getMcpServersForBackend: vi.fn(),
  getMcpServerStatusesForBackend: vi.fn(),
}));

function makeServer(name: string): McpServerConfig {
  return {
    name,
    transport: { type: 'stdio', command: 'echo' },
  } as McpServerConfig;
}

function makeStatus(name: string, state: McpServerStatus['state'] = 'connected'): McpServerStatus {
  return { name, state };
}

describe('useMcpServersByBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTopLevelViewStore.setState({ agentsRefreshNonce: 0 });
  });

  it('populates servers and statuses (keyed by name) for each ONLINE backend', async () => {
    const backends: AgentsBackend[] = [
      { backendId: 'b1', name: 'Backend 1', online: true },
      { backendId: 'b2', name: 'Backend 2', online: true },
    ];
    vi.mocked(api.getMcpServersForBackend).mockImplementation(async backendId => {
      if (backendId === 'b1') return [makeServer('s1')];
      if (backendId === 'b2') return [makeServer('s2')];
      return [];
    });
    vi.mocked(api.getMcpServerStatusesForBackend).mockImplementation(async backendId => {
      if (backendId === 'b1') return [makeStatus('s1', 'connected')];
      if (backendId === 'b2') return [makeStatus('s2', 'disconnected')];
      return [];
    });

    const { result } = renderHook(() => useMcpServersByBackend(backends));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.servers.get('b1')).toEqual([makeServer('s1')]);
    expect(result.current.statuses.get('b1')).toEqual({ s1: makeStatus('s1', 'connected') });

    expect(result.current.servers.get('b2')).toEqual([makeServer('s2')]);
    expect(result.current.statuses.get('b2')).toEqual({ s2: makeStatus('s2', 'disconnected') });

    expect(result.current.errors.size).toBe(0);
    expect(api.getMcpServersForBackend).toHaveBeenCalledTimes(2);
    expect(api.getMcpServerStatusesForBackend).toHaveBeenCalledTimes(2);
  });

  it('skips offline backends: no fetch calls, no map entries', async () => {
    const backends: AgentsBackend[] = [
      { backendId: 'b1', name: 'Backend 1', online: true },
      { backendId: 'b2', name: 'Backend 2', online: false },
    ];
    vi.mocked(api.getMcpServersForBackend).mockResolvedValue([makeServer('s1')]);
    vi.mocked(api.getMcpServerStatusesForBackend).mockResolvedValue([makeStatus('s1')]);

    const { result } = renderHook(() => useMcpServersByBackend(backends));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.servers.has('b1')).toBe(true);
    expect(result.current.servers.has('b2')).toBe(false);
    expect(result.current.statuses.has('b2')).toBe(false);
    expect(api.getMcpServersForBackend).toHaveBeenCalledTimes(1);
    expect(api.getMcpServersForBackend).toHaveBeenCalledWith('b1');
    expect(api.getMcpServerStatusesForBackend).toHaveBeenCalledTimes(1);
    expect(api.getMcpServerStatusesForBackend).toHaveBeenCalledWith('b1');
  });

  it('records an error when servers fetch fails, without affecting the other backend', async () => {
    const backends: AgentsBackend[] = [
      { backendId: 'b1', name: 'Backend 1', online: true },
      { backendId: 'b2', name: 'Backend 2', online: true },
    ];
    vi.mocked(api.getMcpServersForBackend).mockImplementation(async backendId => {
      if (backendId === 'b1') throw new Error('boom');
      return [makeServer('s2')];
    });
    vi.mocked(api.getMcpServerStatusesForBackend).mockResolvedValue([makeStatus('s2')]);

    const { result } = renderHook(() => useMcpServersByBackend(backends));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.errors.get('b1')).toBe('boom');
    expect(result.current.servers.has('b1')).toBe(false);
    expect(result.current.statuses.has('b1')).toBe(false);

    expect(result.current.errors.has('b2')).toBe(false);
    expect(result.current.servers.get('b2')).toEqual([makeServer('s2')]);
    expect(result.current.statuses.get('b2')).toEqual({ s2: makeStatus('s2') });
  });

  it('soft-fails when statuses fetch fails: servers land, no statuses entry, no error', async () => {
    const backends: AgentsBackend[] = [{ backendId: 'b1', name: 'Backend 1', online: true }];
    vi.mocked(api.getMcpServersForBackend).mockResolvedValue([makeServer('s1')]);
    vi.mocked(api.getMcpServerStatusesForBackend).mockRejectedValue(new Error('status boom'));

    const { result } = renderHook(() => useMcpServersByBackend(backends));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.servers.get('b1')).toEqual([makeServer('s1')]);
    expect(result.current.statuses.has('b1')).toBe(false);
    expect(result.current.errors.has('b1')).toBe(false);
  });

  it('refetches when the store nonce is bumped', async () => {
    const backends: AgentsBackend[] = [{ backendId: 'b1', name: 'Backend 1', online: true }];
    vi.mocked(api.getMcpServersForBackend).mockResolvedValue([makeServer('s1')]);
    vi.mocked(api.getMcpServerStatusesForBackend).mockResolvedValue([makeStatus('s1')]);

    const { result } = renderHook(() => useMcpServersByBackend(backends));

    await waitFor(() => {
      expect(api.getMcpServersForBackend).toHaveBeenCalledTimes(1);
      expect(api.getMcpServerStatusesForBackend).toHaveBeenCalledTimes(1);
    });

    act(() => {
      useTopLevelViewStore.getState().bumpAgentsRefresh();
    });

    await waitFor(() => {
      expect(api.getMcpServersForBackend).toHaveBeenCalledTimes(2);
      expect(api.getMcpServerStatusesForBackend).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('settles loading to false for an empty backends array', async () => {
    const { result } = renderHook(() => useMcpServersByBackend([]));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.servers.size).toBe(0);
    expect(result.current.statuses.size).toBe(0);
    expect(result.current.errors.size).toBe(0);
    expect(api.getMcpServersForBackend).not.toHaveBeenCalled();
    expect(api.getMcpServerStatusesForBackend).not.toHaveBeenCalled();
  });

  it('maps the composite fetcher result correctly across a mixed batch (fail / soft-fail / success)', async () => {
    const backends: AgentsBackend[] = [
      { backendId: 'b1', name: 'Backend 1', online: true },
      { backendId: 'b2', name: 'Backend 2', online: true },
      { backendId: 'b3', name: 'Backend 3', online: true },
    ];
    vi.mocked(api.getMcpServersForBackend).mockImplementation(async backendId => {
      if (backendId === 'b1') throw new Error('servers boom');
      if (backendId === 'b2') return [makeServer('s2')];
      return [makeServer('s3')];
    });
    vi.mocked(api.getMcpServerStatusesForBackend).mockImplementation(async backendId => {
      if (backendId === 'b2') throw new Error('statuses boom');
      return [makeStatus('s3')];
    });

    const { result } = renderHook(() => useMcpServersByBackend(backends));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // b1: servers rejected -> error, no servers/statuses entries.
    expect(result.current.errors.get('b1')).toBe('servers boom');
    expect(result.current.servers.has('b1')).toBe(false);
    expect(result.current.statuses.has('b1')).toBe(false);

    // b2: servers fulfilled, statuses rejected -> soft-fail, servers land, no error.
    expect(result.current.servers.get('b2')).toEqual([makeServer('s2')]);
    expect(result.current.statuses.has('b2')).toBe(false);
    expect(result.current.errors.has('b2')).toBe(false);

    // b3: both fulfilled -> servers + statuses keyed by name.
    expect(result.current.servers.get('b3')).toEqual([makeServer('s3')]);
    expect(result.current.statuses.get('b3')).toEqual({ s3: makeStatus('s3') });
  });

  it('ignores a stale fetch that resolves after the backend set changed', async () => {
    let resolveB1Servers: (value: McpServerConfig[]) => void = () => {};
    vi.mocked(api.getMcpServersForBackend).mockImplementation(backendId => {
      if (backendId === 'b1') {
        return new Promise(resolve => {
          resolveB1Servers = resolve;
        });
      }
      return Promise.resolve([makeServer('s2')]);
    });
    vi.mocked(api.getMcpServerStatusesForBackend).mockResolvedValue([]);

    const { result, rerender } = renderHook(
      ({ backends }: { backends: AgentsBackend[] }) => useMcpServersByBackend(backends),
      { initialProps: { backends: [{ backendId: 'b1', name: 'Backend 1', online: true }] } }
    );

    // b1 removed while its fetch is still in flight.
    rerender({ backends: [{ backendId: 'b2', name: 'Backend 2', online: true }] });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // b1's slow fetch resolves late; the cancelled guard must discard it.
    await act(async () => {
      resolveB1Servers([makeServer('s1')]);
    });
    await act(async () => {});
    await act(async () => {});

    expect(result.current.servers.has('b1')).toBe(false);
    expect(result.current.servers.get('b2')).toEqual([makeServer('s2')]);
    expect(result.current.loading).toBe(false);
  });
});
