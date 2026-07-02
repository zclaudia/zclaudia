import { useCallback } from 'react';
import { useProjectStore } from '../stores/projectStore';
import type { Session } from '@zclaudia/shared';
import * as api from '../services/api';

/**
 * Hook for managing session configurations (add/update/delete)
 * Uses HTTP REST API instead of WebSocket messages
 */
export function useSessionManager() {
  const refreshSessions = useCallback(async () => {
    try {
      const sessions = await api.getSessions();
      useProjectStore.getState().setSessions(sessions);
    } catch (err) {
      console.error('[SessionManager] Failed to refresh sessions:', err);
    }
  }, []);

  const addSession = useCallback(
    async (session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>) => {
      const created = await api.createSession(session);
      await refreshSessions();
      return created;
    },
    [refreshSessions]
  );

  const updateSession = useCallback(
    async (id: string, updates: Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>) => {
      await api.updateSession(id, updates);
      await refreshSessions();
    },
    [refreshSessions]
  );

  const deleteSession = useCallback(
    async (id: string) => {
      await api.deleteSession(id);
      await refreshSessions();
    },
    [refreshSessions]
  );

  return {
    addSession,
    updateSession,
    deleteSession,
  };
}
