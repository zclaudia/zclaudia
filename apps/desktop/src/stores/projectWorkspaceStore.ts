import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { workspaceStorageKey } from '../utils/workspaceStorage';
import { isChatRef, workspaceRefKey, type ToolRef } from '../utils/workspaceLayout';

export type ToolChatBinding = { mode: 'follow' } | { mode: 'fixed'; sessionId: string };

export interface ProjectWorkspace {
  /** Stable key into the compatibility layout store; it does not change with selection. */
  workspaceId: string;
  focusedChatSessionId: string;
  /** Content-ref identities survive pane moves, tabs, and preset application. */
  toolBindings: Record<string, ToolChatBinding>;
}

interface ProjectWorkspaceState {
  byProject: Record<string, ProjectWorkspace>;
  setFocusedChat: (projectId: string, sessionId: string) => void;
  setToolBinding: (projectId: string, ref: ToolRef, binding: ToolChatBinding) => void;
  removeProject: (projectId: string) => void;
}

export { workspaceRefKey } from '../utils/workspaceLayout';

function restoreProjects(persisted: unknown): Record<string, ProjectWorkspace> {
  const result: Record<string, ProjectWorkspace> = {};
  const saved = (persisted as { byProject?: unknown } | null)?.byProject;
  if (!saved || typeof saved !== 'object') return result;
  for (const [projectId, candidate] of Object.entries(saved)) {
    if (!candidate || typeof candidate !== 'object') continue;
    const ws = candidate as Partial<ProjectWorkspace>;
    if (typeof ws.workspaceId !== 'string' || !ws.workspaceId ||
        typeof ws.focusedChatSessionId !== 'string' || !ws.focusedChatSessionId) continue;
    const toolBindings: Record<string, ToolChatBinding> = {};
    if (ws.toolBindings && typeof ws.toolBindings === 'object') {
      for (const [key, binding] of Object.entries(ws.toolBindings)) {
        if (binding?.mode === 'follow') toolBindings[key] = { mode: 'follow' };
        if (binding?.mode === 'fixed' && typeof binding.sessionId === 'string' && binding.sessionId) {
          toolBindings[key] = { mode: 'fixed', sessionId: binding.sessionId };
        }
      }
    }
    result[projectId] = { workspaceId: ws.workspaceId, focusedChatSessionId: ws.focusedChatSessionId, toolBindings };
  }
  return result;
}

export const useProjectWorkspaceStore = create<ProjectWorkspaceState>()(
  persist(
    set => ({
      byProject: {},
      setFocusedChat: (projectId, sessionId) => set(state => {
        const ws = state.byProject[projectId];
        if (!ws || ws.focusedChatSessionId === sessionId) return state;
        return { byProject: { ...state.byProject, [projectId]: { ...ws, focusedChatSessionId: sessionId } } };
      }),
      setToolBinding: (projectId, ref, binding) => set(state => {
        const ws = state.byProject[projectId];
        if (!ws || isChatRef(ref)) return state;
        return { byProject: { ...state.byProject, [projectId]: {
          ...ws, toolBindings: { ...ws.toolBindings, [workspaceRefKey(ref)]: binding },
        } } };
      }),
      removeProject: projectId => set(state => {
        if (!state.byProject[projectId]) return state;
        const byProject = { ...state.byProject };
        delete byProject[projectId];
        return { byProject };
      }),
    }),
    {
      name: workspaceStorageKey('claudia-project-workspace', typeof window === 'undefined' ? '' : window.location.search),
      version: 1,
      partialize: state => ({ byProject: state.byProject }),
      migrate: saved => ({ byProject: restoreProjects(saved) }),
      merge: (saved, current) => ({ ...current, byProject: restoreProjects(saved) }),
    }
  )
);

export function resolveToolBindingSession(
  projectId: string,
  ref: ToolRef,
  fallbackSessionId?: string
): string | undefined {
  const ws = useProjectWorkspaceStore.getState().byProject[projectId];
  const binding = ws?.toolBindings[workspaceRefKey(ref)];
  return binding?.mode === 'fixed' ? binding.sessionId : ws?.focusedChatSessionId ?? fallbackSessionId;
}
