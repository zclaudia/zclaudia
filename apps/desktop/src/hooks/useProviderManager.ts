import { useCallback } from 'react';
import type { LlmProfileConfig } from '@zclaudia/shared';
import * as api from '../services/api';

/**
 * Hook for managing provider configurations (add/update/delete)
 * Uses HTTP REST API instead of WebSocket messages
 */
export function useProviderManager() {
  const addProvider = useCallback(
    async (provider: Omit<LlmProfileConfig, 'id' | 'createdAt' | 'updatedAt'>) => {
      await api.createLlmProfile(provider);
    },
    []
  );

  const updateProvider = useCallback(
    async (id: string, updates: Partial<Omit<LlmProfileConfig, 'id' | 'createdAt' | 'updatedAt'>>) => {
      await api.updateLlmProfile(id, updates);
    },
    []
  );

  const deleteProvider = useCallback(
    async (id: string) => {
      await api.deleteLlmProfile(id);
    },
    []
  );

  return {
    addProvider,
    updateProvider,
    deleteProvider
  };
}
