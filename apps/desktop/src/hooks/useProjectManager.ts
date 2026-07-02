import { useCallback } from 'react';
import { useProjectStore } from '../stores/projectStore';
import type { Project } from '@zclaudia/shared';
import * as api from '../services/api';

/**
 * Hook for managing project configurations (add/update/delete)
 * Uses HTTP REST API instead of WebSocket messages
 */
export function useProjectManager() {
  const refreshProjects = useCallback(async () => {
    try {
      const projects = await api.getProjects();
      useProjectStore.getState().setProjects(projects);
    } catch (err) {
      console.error('[ProjectManager] Failed to refresh projects:', err);
    }
  }, []);

  const addProject = useCallback(
    async (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => {
      await api.createProject(project);
      await refreshProjects();
    },
    [refreshProjects]
  );

  const updateProject = useCallback(
    async (id: string, updates: Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>>) => {
      await api.updateProject(id, updates);
      await refreshProjects();
    },
    [refreshProjects]
  );

  const deleteProject = useCallback(
    async (id: string) => {
      await api.deleteProject(id);
      await refreshProjects();
    },
    [refreshProjects]
  );

  return {
    addProject,
    updateProject,
    deleteProject,
  };
}
