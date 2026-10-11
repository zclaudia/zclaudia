// Session ownership bookkeeping shared by sessionsStore and projectStore.
// Both stores record/clear ownershipStore entries and clean up a session's
// right-workspace layout when a session disappears; those cross-store writes
// live here so the stores never import each other.
import { useOwnershipStore } from '../stores/ownershipStore';
import { useRightWorkspaceStore } from '../stores/rightWorkspaceStore';
import { useProjectWorkspaceStore } from '../stores/projectWorkspaceStore';
import { sessionWorkspaceId } from '../utils/workspaceStorage';
import { flattenPanes, isChatRef, removeChatSession, repairWorkspace } from '../utils/workspaceLayout';

/** Replace a backend's session ownership with the given snapshot. */
export function reassignSessionOwnersForBackend(backendId: string, sessionIds: string[]): void {
  const ownership = useOwnershipStore.getState();
  ownership.removeSessionOwnersByBackend(backendId);
  ownership.setSessionOwners(sessionIds, backendId);
}

/** Record which backend owns a session (created/updated events). */
export function recordSessionOwner(sessionId: string, backendId: string): void {
  useOwnershipStore.getState().setSessionOwner(sessionId, backendId);
}

/**
 * An adopted project layout keeps its original session key as a stable anchor.
 * Authoritative deletion removes its chat refs immediately, even if the REST
 * catalog has not refreshed. The anchor and every surviving chat/tool remain.
 */
export function forgetSession(sessionId: string): void {
  useOwnershipStore.getState().removeSessionOwner(sessionId);
  const projectAnchors = new Set(Object.values(useProjectWorkspaceStore.getState().byProject)
    .map(workspace => workspace.workspaceId));
  useRightWorkspaceStore.setState(state => {
    const bySession = { ...state.bySession };
    let changed = false;
    for (const anchor of projectAnchors) {
      const ws = bySession[anchor];
      if (!ws) continue;
      const root = removeChatSession(ws.root, sessionId);
      if (root === ws.root) continue;
      bySession[anchor] = repairWorkspace({ ...ws, root });
      changed = true;
    }
    for (const layoutId of [sessionId, sessionWorkspaceId(sessionId)]) {
      if (projectAnchors.has(layoutId) || !bySession[layoutId]) continue;
      delete bySession[layoutId];
      changed = true;
    }
    return changed ? { bySession, order: state.order.filter(id => bySession[id]) } : state;
  });
  useProjectWorkspaceStore.setState(state => {
    const byProject = { ...state.byProject };
    let changed = false;
    for (const [projectId, project] of Object.entries(state.byProject)) {
      const chats = flattenPanes(useRightWorkspaceStore.getState().bySession[project.workspaceId]?.root ?? null)
        .flatMap(pane => pane.tools.filter(isChatRef));
      const focusedChatSessionId = project.focusedChatSessionId === sessionId
        ? chats[0]?.instanceKey ?? '' : project.focusedChatSessionId;
      const toolBindings = { ...project.toolBindings };
      let bindingsChanged = false;
      for (const [key, binding] of Object.entries(toolBindings)) {
        if (binding.mode !== 'fixed' || binding.sessionId !== sessionId) continue;
        toolBindings[key] = { mode: 'follow' };
        bindingsChanged = true;
      }
      if (focusedChatSessionId === project.focusedChatSessionId && !bindingsChanged) continue;
      byProject[projectId] = { ...project, focusedChatSessionId, toolBindings };
      changed = true;
    }
    return changed ? { byProject } : state;
  });
}

/** Forget all session ownership recorded for a backend. */
export function forgetSessionOwnersForBackend(backendId: string): void {
  useOwnershipStore.getState().removeSessionOwnersByBackend(backendId);
}

/** Clear every session ownership record (full disconnect). */
export function clearSessionOwnership(): void {
  useOwnershipStore.getState().clearSessionOwners();
}
