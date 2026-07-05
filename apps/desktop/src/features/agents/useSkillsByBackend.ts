import { useMemo } from 'react';
import type {
  WorkspaceSkillInfo,
  SkillLoadDiagnostic,
  WorkspaceSkillsResult,
} from '../../services/api';
import {
  getWorkspaceSkillsResultForBackend,
  getExternalSkillDirsForBackend,
} from '../../services/api';
import { useCatalogByBackend } from './useCatalogByBackend';
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
 * Skills and dirs are fetched independently per backend — via two useCatalogByBackend
 * instances rather than one composite fetcher, because the failure domains must stay
 * separate: a skills failure records an error but must NOT drop a successfully fetched
 * dirs list, and a dirs failure never pollutes the errors map (dirs are secondary to
 * the skills list) — it is recorded in dirsFailed instead, with no dirs entry.
 */
export function useSkillsByBackend(backends: AgentsBackend[]): SkillsByBackend {
  const skillsCatalog = useCatalogByBackend<WorkspaceSkillsResult>(
    backends,
    getWorkspaceSkillsResultForBackend
  );
  const dirsCatalog = useCatalogByBackend<string[]>(backends, getExternalSkillDirsForBackend);

  return useMemo(() => {
    const skills = new Map<string, WorkspaceSkillInfo[]>();
    const diagnostics = new Map<string, SkillLoadDiagnostic[]>();
    for (const [backendId, result] of skillsCatalog.data) {
      skills.set(backendId, result.skills);
      diagnostics.set(backendId, result.diagnostics);
    }

    return {
      skills,
      diagnostics,
      dirs: dirsCatalog.data,
      dirsFailed: new Set(dirsCatalog.errors.keys()),
      errors: skillsCatalog.errors,
      loading: skillsCatalog.loading || dirsCatalog.loading,
    };
  }, [skillsCatalog, dirsCatalog]);
}
