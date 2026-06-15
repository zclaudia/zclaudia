import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Which backend rows are expanded in the sidebar. Persisted so the tree shape
 * survives reloads (mirrors sidebarWidthStore). Stored as an array for JSON
 * serialization; membership is checked via isBackendExpanded.
 */
interface SidebarExpansionState {
  expandedBackendIds: string[];
  toggleBackend: (backendId: string) => void;
  expandBackend: (backendId: string) => void;
  collapseBackend: (backendId: string) => void;
  isBackendExpanded: (backendId: string) => boolean;
}

export const useSidebarExpansionStore = create<SidebarExpansionState>()(
  persist(
    (set, get) => ({
      expandedBackendIds: [],
      toggleBackend: (backendId) =>
        set((s) => ({
          expandedBackendIds: s.expandedBackendIds.includes(backendId)
            ? s.expandedBackendIds.filter((id) => id !== backendId)
            : [...s.expandedBackendIds, backendId],
        })),
      expandBackend: (backendId) =>
        set((s) => (s.expandedBackendIds.includes(backendId)
          ? s
          : { expandedBackendIds: [...s.expandedBackendIds, backendId] })),
      collapseBackend: (backendId) =>
        set((s) => ({ expandedBackendIds: s.expandedBackendIds.filter((id) => id !== backendId) })),
      isBackendExpanded: (backendId) => get().expandedBackendIds.includes(backendId),
    }),
    {
      name: 'claudia-sidebar-expansion',
      partialize: (state) => ({ expandedBackendIds: state.expandedBackendIds }),
    },
  ),
);
