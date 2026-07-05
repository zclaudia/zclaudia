import { useEffect, useState } from 'react';
import type { WorkspaceSkillInfo, SkillLoadDiagnostic } from '../../services/api';
import {
  getWorkspaceSkillsResultForBackend,
  getExternalSkillDirsForBackend,
} from '../../services/api';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';
import type { AgentsBackend } from './agents-types';

export interface SkillsByBackend {
  skills: Map<string, WorkspaceSkillInfo[]>;
  diagnostics: Map<string, SkillLoadDiagnostic[]>;
  dirs: Map<string, string[]>;
  /**
   * Backends whose external-dirs fetch failed. No dirs entry is recorded for them —
   * consumers must not treat the missing entry as an empty list (SkillDirsEditor PUTs
   * the whole array on every mutation, so an editable [] would silently wipe the
   * backend's configured dirs).
   */
  dirsFailed: Set<string>;
  errors: Map<string, string>;
  loading: boolean;
}

/**
 * Fetch each online backend's workspace skills (+ diagnostics) and external skill dirs;
 * refetches when agentsRefreshNonce bumps.
 *
 * Skills and dirs are fetched independently per backend: a dirs failure never pollutes
 * the errors map (dirs are secondary to the skills list) — it is recorded in dirsFailed
 * instead, with no dirs entry.
 */
export function useSkillsByBackend(backends: AgentsBackend[]): SkillsByBackend {
  const nonce = useTopLevelViewStore(s => s.agentsRefreshNonce);
  const [state, setState] = useState<SkillsByBackend>({
    skills: new Map(),
    diagnostics: new Map(),
    dirs: new Map(),
    dirsFailed: new Set(),
    errors: new Map(),
    loading: true,
  });

  const onlineKey = backends
    .filter(b => b.online)
    .map(b => b.backendId)
    .sort()
    .join(',');

  useEffect(() => {
    let cancelled = false;
    const onlineBackends = backends.filter(b => b.online);

    setState(prev => ({ ...prev, loading: true }));

    void Promise.all(
      onlineBackends.map(b =>
        Promise.allSettled([
          getWorkspaceSkillsResultForBackend(b.backendId),
          getExternalSkillDirsForBackend(b.backendId),
        ])
      )
    ).then(results => {
      if (cancelled) return;

      const skills = new Map<string, WorkspaceSkillInfo[]>();
      const diagnostics = new Map<string, SkillLoadDiagnostic[]>();
      const dirs = new Map<string, string[]>();
      const dirsFailed = new Set<string>();
      const errors = new Map<string, string>();

      results.forEach(([skillsResult, dirsResult], index) => {
        const backendId = onlineBackends[index].backendId;

        if (skillsResult.status === 'fulfilled') {
          skills.set(backendId, skillsResult.value.skills);
          diagnostics.set(backendId, skillsResult.value.diagnostics);
        } else {
          const error = skillsResult.reason;
          errors.set(backendId, error instanceof Error ? error.message : String(error));
        }

        if (dirsResult.status === 'fulfilled') {
          dirs.set(backendId, dirsResult.value);
        } else {
          dirsFailed.add(backendId);
        }
      });

      setState({ skills, diagnostics, dirs, dirsFailed, errors, loading: false });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineKey, nonce]);

  return state;
}
