/**
 * Runtime descriptor store — the set of agent-runtime descriptors served by the
 * active backend (built-in `zclaudia` plus any active plugin-registered runtimes).
 *
 * Server-authoritative and keyed per backend (like llmProfileMetaStore), because
 * which runtimes exist depends on which plugins are active on the connected server.
 * Populated by `fetchAndSyncRuntimeDescriptors` on connect / active-server change.
 */
import { create } from 'zustand';
import type { ProfileConfigDescriptor } from '@zclaudia/shared/core/profile-config-descriptor';
import { useServerStore } from './serverStore';

interface RuntimeDescriptorState {
  byBackend: Record<string, ProfileConfigDescriptor[]>;

  setDescriptors: (descriptors: ProfileConfigDescriptor[], backendId?: string | null) => void;
  getDescriptors: (backendId?: string | null) => ProfileConfigDescriptor[];
}

const EMPTY: ProfileConfigDescriptor[] = [];

function resolveBackendId(backendId?: string | null): string | null {
  if (backendId) return backendId;
  const getState = (useServerStore as { getState?: () => { activeServerId?: string | null } })
    .getState;
  return getState?.().activeServerId ?? null;
}

export const useRuntimeDescriptorStore = create<RuntimeDescriptorState>((set, get) => ({
  byBackend: {},

  setDescriptors: (descriptors, backendId) =>
    set(state => {
      const resolvedBackendId = resolveBackendId(backendId);
      if (!resolvedBackendId) return state;
      return {
        byBackend: {
          ...state.byBackend,
          [resolvedBackendId]: descriptors,
        },
      };
    }),

  getDescriptors: backendId => {
    const resolvedBackendId = resolveBackendId(backendId);
    if (!resolvedBackendId) return EMPTY;
    return get().byBackend[resolvedBackendId] ?? EMPTY;
  },
}));
