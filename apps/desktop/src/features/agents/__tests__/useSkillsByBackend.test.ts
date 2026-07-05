// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { WorkspaceSkillInfo, SkillLoadDiagnostic } from '../../../services/api';

import { useSkillsByBackend } from '../useSkillsByBackend';
import type { AgentsBackend } from '../agents-types';
import { useTopLevelViewStore } from '../../../stores/topLevelViewStore';
import * as api from '../../../services/api';

vi.mock('../../../services/api', () => ({
  getWorkspaceSkillsResultForBackend: vi.fn(),
  getExternalSkillDirsForBackend: vi.fn(),
}));

function makeSkill(id: string): WorkspaceSkillInfo {
  return {
    id,
    name: id,
    description: `desc-${id}`,
    path: `/skills/${id}`,
  };
}

function makeDiagnostic(path: string): SkillLoadDiagnostic {
  return {
    type: 'warning',
    code: 'test',
    message: 'test diagnostic',
    path,
    source: 'workspace',
  };
}

describe('useSkillsByBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTopLevelViewStore.setState({ agentsRefreshNonce: 0 });
  });

  it('fetches skills/diagnostics/dirs for each ONLINE backend, keyed by backendId', async () => {
    const backends: AgentsBackend[] = [
      { backendId: 'b1', name: 'Backend 1', online: true },
      { backendId: 'b2', name: 'Backend 2', online: true },
    ];
    vi.mocked(api.getWorkspaceSkillsResultForBackend).mockImplementation(async backendId => {
      if (backendId === 'b1')
        return { skills: [makeSkill('s1')], diagnostics: [makeDiagnostic('/skills/s1')] };
      if (backendId === 'b2') return { skills: [makeSkill('s2')], diagnostics: [] };
      return { skills: [], diagnostics: [] };
    });
    vi.mocked(api.getExternalSkillDirsForBackend).mockImplementation(async backendId => {
      if (backendId === 'b1') return ['/dir/b1'];
      if (backendId === 'b2') return ['/dir/b2'];
      return [];
    });

    const { result } = renderHook(() => useSkillsByBackend(backends));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.skills.get('b1')).toEqual([makeSkill('s1')]);
    expect(result.current.diagnostics.get('b1')).toEqual([makeDiagnostic('/skills/s1')]);
    expect(result.current.dirs.get('b1')).toEqual(['/dir/b1']);

    expect(result.current.skills.get('b2')).toEqual([makeSkill('s2')]);
    expect(result.current.diagnostics.get('b2')).toEqual([]);
    expect(result.current.dirs.get('b2')).toEqual(['/dir/b2']);

    expect(api.getWorkspaceSkillsResultForBackend).toHaveBeenCalledTimes(2);
    expect(api.getExternalSkillDirsForBackend).toHaveBeenCalledTimes(2);
  });

  it('skips offline backends: no fetch calls, no map entries', async () => {
    const backends: AgentsBackend[] = [
      { backendId: 'b1', name: 'Backend 1', online: true },
      { backendId: 'b2', name: 'Backend 2', online: false },
    ];
    vi.mocked(api.getWorkspaceSkillsResultForBackend).mockResolvedValue({
      skills: [makeSkill('s1')],
      diagnostics: [],
    });
    vi.mocked(api.getExternalSkillDirsForBackend).mockResolvedValue([]);

    const { result } = renderHook(() => useSkillsByBackend(backends));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.skills.has('b1')).toBe(true);
    expect(result.current.skills.has('b2')).toBe(false);
    expect(result.current.dirs.has('b2')).toBe(false);
    expect(api.getWorkspaceSkillsResultForBackend).toHaveBeenCalledTimes(1);
    expect(api.getWorkspaceSkillsResultForBackend).toHaveBeenCalledWith('b1');
    expect(api.getExternalSkillDirsForBackend).toHaveBeenCalledTimes(1);
    expect(api.getExternalSkillDirsForBackend).toHaveBeenCalledWith('b1');
  });

  it('records an error when the skills fetch fails, without affecting the other backend', async () => {
    const backends: AgentsBackend[] = [
      { backendId: 'b1', name: 'Backend 1', online: true },
      { backendId: 'b2', name: 'Backend 2', online: true },
    ];
    vi.mocked(api.getWorkspaceSkillsResultForBackend).mockImplementation(async backendId => {
      if (backendId === 'b1') throw new Error('boom');
      return { skills: [makeSkill('s2')], diagnostics: [] };
    });
    vi.mocked(api.getExternalSkillDirsForBackend).mockResolvedValue(['/dir']);

    const { result } = renderHook(() => useSkillsByBackend(backends));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.errors.get('b1')).toBe('boom');
    expect(result.current.skills.has('b1')).toBe(false);
    expect(result.current.diagnostics.has('b1')).toBe(false);
    // dirs may still land for the failed backend since it's fetched independently.
    expect(result.current.dirs.get('b1')).toEqual(['/dir']);

    expect(result.current.errors.has('b2')).toBe(false);
    expect(result.current.skills.get('b2')).toEqual([makeSkill('s2')]);
  });

  it('soft-fails a dirs fetch: dirs falls back to [], no error recorded, skills stay intact', async () => {
    const backends: AgentsBackend[] = [{ backendId: 'b1', name: 'Backend 1', online: true }];
    vi.mocked(api.getWorkspaceSkillsResultForBackend).mockResolvedValue({
      skills: [makeSkill('s1')],
      diagnostics: [],
    });
    vi.mocked(api.getExternalSkillDirsForBackend).mockRejectedValue(new Error('dirs boom'));

    const { result } = renderHook(() => useSkillsByBackend(backends));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.dirs.get('b1')).toEqual([]);
    expect(result.current.errors.has('b1')).toBe(false);
    expect(result.current.skills.get('b1')).toEqual([makeSkill('s1')]);
  });

  it('refetches when the store nonce is bumped', async () => {
    const backends: AgentsBackend[] = [{ backendId: 'b1', name: 'Backend 1', online: true }];
    vi.mocked(api.getWorkspaceSkillsResultForBackend).mockResolvedValue({
      skills: [makeSkill('s1')],
      diagnostics: [],
    });
    vi.mocked(api.getExternalSkillDirsForBackend).mockResolvedValue(['/dir']);

    const { result } = renderHook(() => useSkillsByBackend(backends));

    await waitFor(() => {
      expect(api.getWorkspaceSkillsResultForBackend).toHaveBeenCalledTimes(1);
      expect(api.getExternalSkillDirsForBackend).toHaveBeenCalledTimes(1);
    });

    act(() => {
      useTopLevelViewStore.getState().bumpAgentsRefresh();
    });

    await waitFor(() => {
      expect(api.getWorkspaceSkillsResultForBackend).toHaveBeenCalledTimes(2);
      expect(api.getExternalSkillDirsForBackend).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('settles loading to false for an empty backends array', async () => {
    const { result } = renderHook(() => useSkillsByBackend([]));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.skills.size).toBe(0);
    expect(result.current.diagnostics.size).toBe(0);
    expect(result.current.dirs.size).toBe(0);
    expect(result.current.errors.size).toBe(0);
    expect(api.getWorkspaceSkillsResultForBackend).not.toHaveBeenCalled();
    expect(api.getExternalSkillDirsForBackend).not.toHaveBeenCalled();
  });

  it('ignores a stale fetch that resolves after the backend set changed', async () => {
    let resolveB1Skills: (value: {
      skills: WorkspaceSkillInfo[];
      diagnostics: SkillLoadDiagnostic[];
    }) => void = () => {};
    vi.mocked(api.getWorkspaceSkillsResultForBackend).mockImplementation(backendId => {
      if (backendId === 'b1') {
        return new Promise(resolve => {
          resolveB1Skills = resolve;
        });
      }
      return Promise.resolve({ skills: [makeSkill('s2')], diagnostics: [] });
    });
    vi.mocked(api.getExternalSkillDirsForBackend).mockResolvedValue([]);

    const { result, rerender } = renderHook(
      ({ backends }: { backends: AgentsBackend[] }) => useSkillsByBackend(backends),
      { initialProps: { backends: [{ backendId: 'b1', name: 'Backend 1', online: true }] } }
    );

    // b1 removed while its fetch is still in flight.
    rerender({ backends: [{ backendId: 'b2', name: 'Backend 2', online: true }] });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // b1's slow fetch resolves late; the cancelled guard must discard it.
    // Drain the full microtask chain (allSettled pair -> Promise.all -> .then)
    // so the stale setState would have landed by now if the guard were missing.
    await act(async () => {
      resolveB1Skills({ skills: [makeSkill('s1')], diagnostics: [] });
    });
    await act(async () => {});
    await act(async () => {});

    expect(result.current.skills.has('b1')).toBe(false);
    expect(result.current.skills.get('b2')).toEqual([makeSkill('s2')]);
    expect(result.current.loading).toBe(false);
  });
});
