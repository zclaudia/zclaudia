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
  errors: Map<string, string>;
  loading: boolean;
}

/**
 * Fetch each online backend's workspace skills (+ diagnostics) and external skill dirs;
 * refetches when agentsRefreshNonce bumps.
 *
 * Skills and dirs are fetched independently per backend: a dirs failure is soft (dirs
 * entry falls back to []) and never pollutes the errors map, since dirs are secondary
 * to the skills list.
 */
export function useSkillsByBackend(backends: AgentsBackend[]): SkillsByBackend {
  const nonce = useTopLevelViewStore(s => s.agentsRefreshNonce);
  const [state, setState] = useState<SkillsByBackend>({
    skills: new Map(),
    diagnostics: new Map(),
    dirs: new Map(),
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
          dirs.set(backendId, []);
        }
      });

      setState({ skills, diagnostics, dirs, errors, loading: false });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineKey, nonce]);

  return state;
}
