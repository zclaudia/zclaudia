import { useCallback, useEffect, useState } from 'react';
import type { GitWorktree, Project, Session } from '@zclaudia/shared';
import * as api from '../../services/api';
import { runWithToast } from '../git';
import { confirm } from '../../stores/confirmDialogStore';
import { groupSessionsByWorktree as groupSessionsByWorktreeFn } from './worktreeGrouping';
import type { WorktreeGroup } from './worktreeGrouping';

interface UseProjectWorktreesOptions {
  /** Projects whose expansion triggers a worktree fetch. */
  expandedProjects: Set<string>;
  selectedSessionId: string | null;
  visibleSessions: Session[];
  visibleProjects: Project[];
  sessionsByProject: Map<string, Session[]>;
}

/**
 * Worktree state and flows for the sidebar project tree: per-project worktree
 * fetching, worktree-grouped session derivation, expansion state (worktree
 * groups + regular-sessions collapse), auto-expansion of the selected
 * session's group, and the confirmed worktree-removal flow.
 */
export function useProjectWorktrees({
  expandedProjects,
  selectedSessionId,
  visibleSessions,
  visibleProjects,
  sessionsByProject,
}: UseProjectWorktreesOptions) {
  const [expandedWorktrees, setExpandedWorktrees] = useState<Set<string>>(new Set());
  const [regularSessionsCollapsed, setRegularSessionsCollapsed] = useState<Set<string>>(new Set());
  const [worktreesByProject, setWorktreesByProject] = useState<Map<string, GitWorktree[]>>(
    new Map()
  );

  const refreshProjectWorktrees = useCallback(async (projectId: string) => {
    try {
      const worktrees = await api.getProjectWorktrees(projectId);
      setWorktreesByProject(prev => new Map(prev).set(projectId, worktrees));
    } catch {
      setWorktreesByProject(prev => new Map(prev).set(projectId, []));
    }
  }, []);

  // Fetch worktrees for projects as they expand (cached per project).
  useEffect(() => {
    for (const projectId of expandedProjects) {
      if (!worktreesByProject.has(projectId)) {
        refreshProjectWorktrees(projectId).catch(() => {});
      }
    }
  }, [expandedProjects, worktreesByProject, refreshProjectWorktrees]);

  const getWorktreeGroupsForProject = useCallback(
    (projectId: string): WorktreeGroup[] => {
      const projectSessions = sessionsByProject.get(projectId) || [];
      const project = visibleProjects.find(p => p.id === projectId);
      const worktrees = worktreesByProject.get(projectId) || [];
      return groupSessionsByWorktreeFn(projectSessions, project?.rootPath, worktrees);
    },
    [sessionsByProject, visibleProjects, worktreesByProject]
  );

  const toggleWorktree = useCallback((key: string) => {
    setExpandedWorktrees(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Keep the selected session's worktree group expanded so the current
  // session is never hidden inside a collapsed group.
  useEffect(() => {
    if (!selectedSessionId) return;
    const session = visibleSessions.find(s => s.id === selectedSessionId);
    if (!session) return;
    const groups = getWorktreeGroupsForProject(session.projectId);
    if (groups.length === 0) return;
    for (const group of groups) {
      if (group.sessions.some(s => s.id === selectedSessionId)) {
        const wtKey = `${session.projectId}:${group.key}`;
        setExpandedWorktrees(prev => {
          if (prev.has(wtKey)) return prev;
          return new Set(prev).add(wtKey);
        });
        break;
      }
    }
  }, [selectedSessionId, visibleSessions, getWorktreeGroupsForProject]);

  const toggleRegularSessions = useCallback((projectId: string) => {
    setRegularSessionsCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  const handleDeleteWorktree = useCallback(
    async (projectId: string, worktreePath: string, branchName?: string) => {
      const label = branchName || worktreePath;
      const confirmed = await confirm({
        title: 'Remove worktree?',
        message: `This deletes the directory at "${worktreePath}" and the local branch "${label}". This cannot be undone.`,
        confirmLabel: 'Remove',
        destructive: true,
      });
      if (!confirmed) return;

      const result = await runWithToast(`Remove worktree '${label}'`, projectId, () =>
        api.deleteProjectWorktree(projectId, worktreePath)
      );
      if (result === null) return;
      await refreshProjectWorktrees(projectId);
    },
    [refreshProjectWorktrees]
  );

  return {
    worktreesByProject,
    expandedWorktrees,
    toggleWorktree,
    regularSessionsCollapsed,
    toggleRegularSessions,
    handleDeleteWorktree,
  };
}
