// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';

import { useProfilesByBackend, type AgentsBackend } from '../useProfilesByBackend';
import { useTopLevelViewStore } from '../../../stores/topLevelViewStore';
import * as api from '../../../services/api';

vi.mock('../../../services/api', () => ({
  listAgentProfilesForBackend: vi.fn(),
}));

function makeProfile(id: string): AgentProfileConfig {
  return {
    id,
    name: id,
    llmProfileId: 'lp1',
    model: 'claude-sonnet-4-6',
    systemPrompt: '',
    enabledTools: ['read'],
    isDefault: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('useProfilesByBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTopLevelViewStore.setState({ agentsRefreshNonce: 0 } as any);
  });

  it('fetches each ONLINE backend profiles into the map keyed by backendId', async () => {
    const backends: AgentsBackend[] = [
      { backendId: 'b1', name: 'Backend 1', online: true },
      { backendId: 'b2', name: 'Backend 2', online: true },
    ];
    vi.mocked(api.listAgentProfilesForBackend).mockImplementation(async backendId => {
      if (backendId === 'b1') return [makeProfile('ap1')];
      if (backendId === 'b2') return [makeProfile('ap2')];
      return [];
    });

    const { result } = renderHook(() => useProfilesByBackend(backends));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.profiles.get('b1')).toEqual([makeProfile('ap1')]);
    expect(result.current.profiles.get('b2')).toEqual([makeProfile('ap2')]);
    expect(api.listAgentProfilesForBackend).toHaveBeenCalledTimes(2);
  });

  it('skips offline backends: no fetch call, no map entry', async () => {
    const backends: AgentsBackend[] = [
      { backendId: 'b1', name: 'Backend 1', online: true },
      { backendId: 'b2', name: 'Backend 2', online: false },
    ];
    vi.mocked(api.listAgentProfilesForBackend).mockResolvedValue([makeProfile('ap1')]);

    const { result } = renderHook(() => useProfilesByBackend(backends));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.profiles.has('b1')).toBe(true);
    expect(result.current.profiles.has('b2')).toBe(false);
    expect(api.listAgentProfilesForBackend).toHaveBeenCalledTimes(1);
    expect(api.listAgentProfilesForBackend).toHaveBeenCalledWith('b1');
  });

  it('records an error for a failing backend while the other still loads', async () => {
    const backends: AgentsBackend[] = [
      { backendId: 'b1', name: 'Backend 1', online: true },
      { backendId: 'b2', name: 'Backend 2', online: true },
    ];
    vi.mocked(api.listAgentProfilesForBackend).mockImplementation(async backendId => {
      if (backendId === 'b1') throw new Error('boom');
      return [makeProfile('ap2')];
    });

    const { result } = renderHook(() => useProfilesByBackend(backends));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.errors.get('b1')).toBe('boom');
    expect(result.current.profiles.has('b1')).toBe(false);
    expect(result.current.profiles.get('b2')).toEqual([makeProfile('ap2')]);
  });

  it('refetches when the store nonce is bumped', async () => {
    const backends: AgentsBackend[] = [{ backendId: 'b1', name: 'Backend 1', online: true }];
    vi.mocked(api.listAgentProfilesForBackend).mockResolvedValue([makeProfile('ap1')]);

    const { result } = renderHook(() => useProfilesByBackend(backends));

    await waitFor(() => {
      expect(api.listAgentProfilesForBackend).toHaveBeenCalledTimes(1);
    });

    act(() => {
      useTopLevelViewStore.getState().bumpAgentsRefresh();
    });

    await waitFor(() => {
      expect(api.listAgentProfilesForBackend).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('sets loading true during fetch and false after settle', async () => {
    const backends: AgentsBackend[] = [{ backendId: 'b1', name: 'Backend 1', online: true }];
    let resolveFetch: (value: AgentProfileConfig[]) => void = () => {};
    vi.mocked(api.listAgentProfilesForBackend).mockImplementation(
      () =>
        new Promise(resolve => {
          resolveFetch = resolve;
        })
    );

    const { result } = renderHook(() => useProfilesByBackend(backends));

    expect(result.current.loading).toBe(true);

    act(() => {
      resolveFetch([makeProfile('ap1')]);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });
});
