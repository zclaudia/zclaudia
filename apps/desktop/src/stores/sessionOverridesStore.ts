import { create } from 'zustand';
import type { UnifiedPermissionPolicy } from '@zclaudia/shared';

interface SessionOverridesState {
  // Permission policy override per session (user-selected policy, null = use project default)
  permissionOverrides: Record<string, Partial<UnifiedPermissionPolicy> | null>;
  // Worktree override per session (user-selected working directory, empty = use project root)
  worktreeOverrides: Record<string, string>;

  setPermissionOverride: (
    sessionId: string,
    policy: Partial<UnifiedPermissionPolicy> | null
  ) => void;
  getPermissionOverride: (sessionId: string) => Partial<UnifiedPermissionPolicy> | null;
  setWorktreeOverride: (sessionId: string, path: string) => void;
  getWorktreeOverride: (sessionId: string) => string;
  clearWorktreeOverride: (sessionId: string) => void;
}

export const useSessionOverridesStore = create<SessionOverridesState>((set, get) => ({
  permissionOverrides: {},
  worktreeOverrides: {},

  setPermissionOverride: (sessionId, policy) =>
    set(state => {
      if (!policy) {
        // Clear override by removing the key
        const { [sessionId]: _, ...rest } = state.permissionOverrides;
        return { permissionOverrides: rest };
      }
      return {
        permissionOverrides: { ...state.permissionOverrides, [sessionId]: policy },
      };
    }),
  getPermissionOverride: sessionId => get().permissionOverrides[sessionId] || null,

  setWorktreeOverride: (sessionId, path) =>
    set(state => ({
      worktreeOverrides: { ...state.worktreeOverrides, [sessionId]: path },
    })),
  getWorktreeOverride: sessionId => get().worktreeOverrides[sessionId] || '',
  clearWorktreeOverride: sessionId =>
    set(state => {
      const { [sessionId]: _, ...rest } = state.worktreeOverrides;
      return { worktreeOverrides: rest };
    }),
}));
