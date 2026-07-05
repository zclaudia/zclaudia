// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

import { useCatalogByBackend } from '../useCatalogByBackend';
import type { AgentsBackend } from '../agents-types';
import { useTopLevelViewStore } from '../../../stores/topLevelViewStore';

describe('useCatalogByBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTopLevelViewStore.setState({ agentsRefreshNonce: 0 });
  });

  it('fetches each ONLINE backend into the data map keyed by backendId', async () => {
    const backends: AgentsBackend[] = [
      { backendId: 'b1', name: 'Backend 1', online: true },
      { backendId: 'b2', name: 'Backend 2', online: true },
    ];
    const fetcher = vi.fn(async (backendId: string) => `value-${backendId}`);

    const { result } = renderHook(() => useCatalogByBackend(backends, fetcher));

    expect(result.current.loading).toBe(true);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data.get('b1')).toBe('value-b1');
    expect(result.current.data.get('b2')).toBe('value-b2');
    expect(result.current.errors.size).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('skips offline backends: no fetch call, no map entry', async () => {
    const backends: AgentsBackend[] = [
      { backendId: 'b1', name: 'Backend 1', online: true },
      { backendId: 'b2', name: 'Backend 2', online: false },
    ];
    const fetcher = vi.fn(async (backendId: string) => `value-${backendId}`);

    const { result } = renderHook(() => useCatalogByBackend(backends, fetcher));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data.has('b1')).toBe(true);
    expect(result.current.data.has('b2')).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('b1');
  });

  it('isolates a failing backend into errors while the other still loads', async () => {
    const backends: AgentsBackend[] = [
      { backendId: 'b1', name: 'Backend 1', online: true },
      { backendId: 'b2', name: 'Backend 2', online: true },
    ];
    const fetcher = vi.fn(async (backendId: string) => {
      if (backendId === 'b1') throw new Error('boom');
      return `value-${backendId}`;
    });

    const { result } = renderHook(() => useCatalogByBackend(backends, fetcher));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.errors.get('b1')).toBe('boom');
    expect(result.current.data.has('b1')).toBe(false);
    expect(result.current.data.get('b2')).toBe('value-b2');
    expect(result.current.errors.has('b2')).toBe(false);
  });

  it('stringifies non-Error rejections into errors', async () => {
    const backends: AgentsBackend[] = [{ backendId: 'b1', name: 'Backend 1', online: true }];
    const fetcher = vi.fn(() => Promise.reject('plain failure'));

    const { result } = renderHook(() => useCatalogByBackend(backends, fetcher));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.errors.get('b1')).toBe('plain failure');
    expect(result.current.data.has('b1')).toBe(false);
  });

  it('refetches when the store nonce is bumped', async () => {
    const backends: AgentsBackend[] = [{ backendId: 'b1', name: 'Backend 1', online: true }];
    const fetcher = vi.fn(async () => 'value');

    const { result } = renderHook(() => useCatalogByBackend(backends, fetcher));

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    act(() => {
      useTopLevelViewStore.getState().bumpAgentsRefresh();
    });

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('does not retrigger on fetcher identity change but uses the latest fetcher next cycle', async () => {
    const backends: AgentsBackend[] = [{ backendId: 'b1', name: 'Backend 1', online: true }];
    const fetcherA = vi.fn(async () => 'from-a');
    const fetcherB = vi.fn(async () => 'from-b');

    const { result, rerender } = renderHook(
      ({ fetcher }: { fetcher: (backendId: string) => Promise<string> }) =>
        useCatalogByBackend(backends, fetcher),
      { initialProps: { fetcher: fetcherA } }
    );

    await waitFor(() => {
      expect(result.current.data.get('b1')).toBe('from-a');
    });

    // Swapping the fetcher (e.g. an inline closure re-created per render)
    // must NOT retrigger a fetch cycle...
    rerender({ fetcher: fetcherB });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(fetcherA).toHaveBeenCalledTimes(1);
    expect(fetcherB).not.toHaveBeenCalled();
    expect(result.current.data.get('b1')).toBe('from-a');

    // ...but the next cycle (nonce bump) uses the latest fetcher.
    act(() => {
      useTopLevelViewStore.getState().bumpAgentsRefresh();
    });

    await waitFor(() => {
      expect(result.current.data.get('b1')).toBe('from-b');
    });
    expect(fetcherA).toHaveBeenCalledTimes(1);
    expect(fetcherB).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale fetch that resolves after the backend set changed', async () => {
    let resolveB1: (value: string) => void = () => {};
    const fetcher = vi.fn((backendId: string) => {
      if (backendId === 'b1') {
        return new Promise<string>(resolve => {
          resolveB1 = resolve;
        });
      }
      return Promise.resolve(`value-${backendId}`);
    });

    const { result, rerender } = renderHook(
      ({ backends }: { backends: AgentsBackend[] }) => useCatalogByBackend(backends, fetcher),
      { initialProps: { backends: [{ backendId: 'b1', name: 'Backend 1', online: true }] } }
    );

    // b1 removed while its fetch is still in flight.
    rerender({ backends: [{ backendId: 'b2', name: 'Backend 2', online: true }] });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // b1's slow fetch resolves late; the cancelled guard must discard it.
    await act(async () => {
      resolveB1('stale-value');
    });
    await act(async () => {});

    expect(result.current.data.has('b1')).toBe(false);
    expect(result.current.data.get('b2')).toBe('value-b2');
    expect(result.current.loading).toBe(false);
  });

  it('settles loading to false for an empty backends array', async () => {
    const fetcher = vi.fn(async () => 'value');

    const { result } = renderHook(() => useCatalogByBackend([], fetcher));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data.size).toBe(0);
    expect(result.current.errors.size).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
