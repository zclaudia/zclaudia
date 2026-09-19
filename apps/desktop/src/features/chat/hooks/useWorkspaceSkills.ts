import { useCallback, useEffect, useState } from 'react';
import * as api from '../../../services/api';
import type { WorkspaceSkillInfo } from '../../../services/api/workspace-skills';

/**
 * Loads the workspace skill catalog used by the composer's slash menu (and
 * skill-token highlighting). Fetched once on mount; `loadWorkspaceSkills`
 * re-fetches on demand (e.g. after invoking a skill command that may have
 * changed the catalog).
 */
export function useWorkspaceSkills() {
  const [workspaceSkills, setWorkspaceSkills] = useState<WorkspaceSkillInfo[]>([]);

  const loadWorkspaceSkills = useCallback(async () => {
    try {
      const result = await api.getWorkspaceSkillsResult();
      setWorkspaceSkills(result.skills ?? []);
    } catch {
      setWorkspaceSkills([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getWorkspaceSkillsResult()
      .then(result => {
        if (!cancelled) setWorkspaceSkills(result.skills ?? []);
      })
      .catch(() => {
        if (!cancelled) setWorkspaceSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { workspaceSkills, loadWorkspaceSkills };
}
