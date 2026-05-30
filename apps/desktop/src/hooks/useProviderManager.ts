import { useCallback } from 'react';
import type { ProviderConfig } from '@zclaudia/shared';
import * as api from '../services/api';

/**
 * Hook for managing provider configurations (add/update/delete)
 * Uses HTTP REST API instead of WebSocket messages
 */
export function useProviderManager() {
  const addProvider = useCallback(
    async (provider: Omit<ProviderConfig, 'id' | 'createdAt' | 'updatedAt'>) => {
      await api.createProvider(provider);
    },
    []
  );

  const updateProvider = useCallback(
    async (id: string, updates: Partial<Omit<ProviderConfig, 'id' | 'createdAt' | 'updatedAt'>>) => {
      await api.updateProvider(id, updates);
    },
    []
  );

  const deleteProvider = useCallback(
    async (id: string) => {
      await api.deleteProvider(id);
    },
    []
  );

  return {
    addProvider,
    updateProvider,
    deleteProvider
  };
}
