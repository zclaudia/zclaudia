// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { LlmProfileConfig } from '@zclaudia/shared';

import { useLlmProfilesByBackend, type AgentsBackend } from '../useLlmProfilesByBackend';
import { useTopLevelViewStore } from '../../../stores/topLevelViewStore';
import * as api from '../../../services/api';

vi.mock('../../../services/api', () => ({
  listLlmProfilesForBackend: vi.fn(),
}));

function makeProfile(id: string): LlmProfileConfig {
  return {
    id,
    name: id,
    providerType: 'anthropic',
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('useLlmProfilesByBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTopLevelViewStore.setState({ agentsRefreshNonce: 0 });
  });

  it('fetches each ONLINE backend profiles into the map keyed by backendId', async () => {
    const backends: AgentsBackend[] = [
      { backendId: 'b1', name: 'Backend 1', online: true },
      { backendId: 'b2', name: 'Backend 2', online: true },
    ];
    vi.mocked(api.listLlmProfilesForBackend).mockImplementation(async backendId => {
      if (backendId === 'b1') return [makeProfile('lp1')];
      if (backendId === 'b2') return [makeProfile('lp2')];
      return [];
    });

    const { result } = renderHook(() => useLlmProfilesByBackend(backends));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.profiles.get('b1')).toEqual([makeProfile('lp1')]);
    expect(result.current.profiles.get('b2')).toEqual([makeProfile('lp2')]);
    expect(api.listLlmProfilesForBackend).toHaveBeenCalledTimes(2);
  });

  it('skips offline backends: no fetch call, no map entry', async () => {
    const backends: AgentsBackend[] = [
      { backendId: 'b1', name: 'Backend 1', online: true },
      { backendId: 'b2', name: 'Backend 2', online: false },
    ];
    vi.mocked(api.listLlmProfilesForBackend).mockResolvedValue([makeProfile('lp1')]);

    const { result } = renderHook(() => useLlmProfilesByBackend(backends));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.profiles.has('b1')).toBe(true);
    expect(result.current.profiles.has('b2')).toBe(false);
    expect(api.listLlmProfilesForBackend).toHaveBeenCalledTimes(1);
    expect(api.listLlmProfilesForBackend).toHaveBeenCalledWith('b1');
  });

  it('records an error for a failing backend while the other still loads', async () => {
    const backends: AgentsBackend[] = [
      { backendId: 'b1', name: 'Backend 1', online: true },
      { backendId: 'b2', name: 'Backend 2', online: true },
    ];
    vi.mocked(api.listLlmProfilesForBackend).mockImplementation(async backendId => {
      if (backendId === 'b1') throw new Error('boom');
      return [makeProfile('lp2')];
    });

    const { result } = renderHook(() => useLlmProfilesByBackend(backends));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.errors.get('b1')).toBe('boom');
    expect(result.current.profiles.has('b1')).toBe(false);
    expect(result.current.profiles.get('b2')).toEqual([makeProfile('lp2')]);
  });

  it('refetches when the store nonce is bumped', async () => {
    const backends: AgentsBackend[] = [{ backendId: 'b1', name: 'Backend 1', online: true }];
    vi.mocked(api.listLlmProfilesForBackend).mockResolvedValue([makeProfile('lp1')]);

    const { result } = renderHook(() => useLlmProfilesByBackend(backends));

    await waitFor(() => {
      expect(api.listLlmProfilesForBackend).toHaveBeenCalledTimes(1);
    });

    act(() => {
      useTopLevelViewStore.getState().bumpAgentsRefresh();
    });

    await waitFor(() => {
      expect(api.listLlmProfilesForBackend).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('sets loading true during fetch and false after settle', async () => {
    const backends: AgentsBackend[] = [{ backendId: 'b1', name: 'Backend 1', online: true }];
    let resolveFetch: (value: LlmProfileConfig[]) => void = () => {};
    vi.mocked(api.listLlmProfilesForBackend).mockImplementation(
      () =>
        new Promise(resolve => {
          resolveFetch = resolve;
        })
    );

    const { result } = renderHook(() => useLlmProfilesByBackend(backends));

    expect(result.current.loading).toBe(true);

    act(() => {
      resolveFetch([makeProfile('lp1')]);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('ignores a stale fetch that resolves after the backend set changed', async () => {
    let resolveB1: (value: LlmProfileConfig[]) => void = () => {};
    vi.mocked(api.listLlmProfilesForBackend).mockImplementation(backendId => {
      if (backendId === 'b1') {
        return new Promise(resolve => {
          resolveB1 = resolve;
        });
      }
      return Promise.resolve([makeProfile('lp2')]);
    });

    const { result, rerender } = renderHook(
      ({ backends }: { backends: AgentsBackend[] }) => useLlmProfilesByBackend(backends),
      { initialProps: { backends: [{ backendId: 'b1', name: 'Backend 1', online: true }] } }
    );

    // b1 removed while its fetch is still in flight.
    rerender({ backends: [{ backendId: 'b2', name: 'Backend 2', online: true }] });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // b1's slow fetch resolves late; the cancelled guard must discard it.
    act(() => {
      resolveB1([makeProfile('lp1')]);
    });
    await Promise.resolve();

    expect(result.current.profiles.has('b1')).toBe(false);
    expect(result.current.profiles.get('b2')).toEqual([makeProfile('lp2')]);
    expect(result.current.loading).toBe(false);
  });

  it('stringifies non-Error rejections into errors', async () => {
    const backends: AgentsBackend[] = [{ backendId: 'b1', name: 'Backend 1', online: true }];
    vi.mocked(api.listLlmProfilesForBackend).mockRejectedValue('plain failure');

    const { result } = renderHook(() => useLlmProfilesByBackend(backends));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.errors.get('b1')).toBe('plain failure');
    expect(result.current.profiles.has('b1')).toBe(false);
  });

  it('settles loading to false for an empty backends array', async () => {
    const { result } = renderHook(() => useLlmProfilesByBackend([]));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.profiles.size).toBe(0);
    expect(result.current.errors.size).toBe(0);
    expect(api.listLlmProfilesForBackend).not.toHaveBeenCalled();
  });
});
