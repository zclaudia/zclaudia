import { usePluginStore, type PanelCloseCtx } from '../stores/pluginStore';
import { useRightWorkspaceStore, findPaneWithTool, findPane, flattenPanes, sameRef } from '../stores/rightWorkspaceStore';
import { resolveToolBindingSession, useProjectWorkspaceStore } from '../stores/projectWorkspaceStore';
import { useWorkspaceRoutingStore } from '../stores/workspaceRoutingStore';
import { useProjectStore } from '../stores/projectStore';
import { useAppearanceStore } from '../stores/appearanceStore';
import { isMobileViewport } from '../hooks/useMediaQuery';
import { useRightSidebarStore } from '../stores/rightSidebarStore';
import { MULTI_INSTANCE_PANELS } from '../stores/panelInstance';
import { getTerminalScopeKey } from '../stores/terminalStore';
import { useOwnershipStore } from '../stores/ownershipStore';
import { useServerStore } from '../stores/serverStore';

export interface OpenToolCtx {
  projectId?: string;
  backendId?: string | null;
  target?: 'primary' | 'focused' | 'new-split';
}

export function workspaceIdForSession(sessionId: string, projectId?: string): string {
  if (!useAppearanceStore.getState().unifiedWorkspace || isMobileViewport()) return sessionId;
  const route = useWorkspaceRoutingStore.getState().active;
  if (route && (route.sessionId === sessionId || route.workspaceId === sessionId)) return route.workspaceId;
  const pid = projectId ?? useProjectStore.getState().sessions.find(s => s.id === sessionId)?.projectId;
  return (pid ? useProjectWorkspaceStore.getState().byProject[pid]?.workspaceId : undefined) ?? sessionId;
}

/** Resolve the instanceKey for a multi-instance tool from context (terminal only today). */
function resolveInstanceKey(toolId: string, ctx: OpenToolCtx): string | undefined {
  if (toolId === 'terminal' && ctx.projectId) {
    return getTerminalScopeKey(ctx.projectId, ctx.backendId);
  }
  return undefined;
}

export function openToolInWorkspace(
  sessionId: string,
  toolId: string,
  ctx: OpenToolCtx = {}
): void {
  const panel = usePluginStore.getState().panels.find(p => p.id === toolId);
  const openMode = panel?.openMode ?? 'shared';
  const multiInstance = MULTI_INSTANCE_PANELS.has(toolId);
  const workspaceId = workspaceIdForSession(sessionId, ctx.projectId);
  useRightWorkspaceStore.getState().setMaximizedPane(workspaceId, null);
  useRightWorkspaceStore.getState().openTool(workspaceId, toolId, {
    openMode,
    multiInstance,
    instanceKey: resolveInstanceKey(toolId, ctx),
    target: ctx.target,
  });
  useRightSidebarStore.getState().setCollapsed(false);
  // Per-tool init on explicit open (e.g. create a terminal session). Mirrors the
  // onClose hook in closeToolInWorkspace; only fires on user-initiated opens.
  panel?.onOpen?.({ sessionId, projectId: ctx.projectId, backendId: ctx.backendId });
}

export function closeToolInWorkspace(sessionId: string, toolId: string): void {
  const workspaceId = workspaceIdForSession(sessionId);
  const ws = useRightWorkspaceStore.getState().bySession[workspaceId];
  if (!ws?.root) return;
  const paneId = findPaneWithTool(ws.root, toolId, undefined, true);
  if (!paneId) return;
  const ref = findPane(ws.root, paneId)?.tools.find(t => t.toolId === toolId);
  if (!ref) return;
  closeTabInWorkspace(workspaceId, paneId, ref.toolId, ref.instanceKey);
  // Preserve panel-specific cleanup (terminal drawer, file viewer, draft store).
}

/** Close a single tab in a pane and run the panel's onClose lifecycle. */
export function closeTabInWorkspace(
  sessionId: string,
  paneId: string,
  toolId: string,
  instanceKey?: string
): void {
  const workspaceId = workspaceIdForSession(sessionId);
  const before = useRightWorkspaceStore.getState().bySession[workspaceId]?.root;
  const ref = before ? findPane(before, paneId)?.tools.find(t => t.toolId === toolId && t.instanceKey === instanceKey) : undefined;
  if (!ref) return;
  useRightWorkspaceStore.getState().closeTool(workspaceId, paneId, toolId, instanceKey);
  const after = useRightWorkspaceStore.getState().bySession[workspaceId]?.root;
  if (flattenPanes(after ?? null).some(pane => pane.tools.some(tool => sameRef(tool, toolId, instanceKey)))) return;
  const projects = useProjectWorkspaceStore.getState().byProject;
  const route = useWorkspaceRoutingStore.getState().active;
  const sessions = useProjectStore.getState().sessions;
  const projectId = sessions.find(session => session.id === sessionId)?.projectId ??
    Object.entries(projects).find(([, project]) => project.workspaceId === workspaceId)?.[0] ??
    (route?.workspaceId === workspaceId ? route.projectId : undefined);
  const boundSessionId = route?.workspaceId === workspaceId && !route.projectScoped
    ? route.sessionId
    : projectId ? resolveToolBindingSession(projectId, ref, sessionId) ?? sessionId : sessionId;
  const boundProjectId = sessions.find(session => session.id === boundSessionId)?.projectId ?? projectId;
  const ctx: PanelCloseCtx = {
    sessionId: boundSessionId,
    projectId: boundProjectId,
    backendId: useOwnershipStore.getState().getSessionBackendId(boundSessionId) ?? useServerStore.getState().activeServerId,
    instanceKey,
  };
  if (toolId === 'terminal' && instanceKey) {
    const separator = instanceKey.indexOf('::');
    if (separator >= 0) {
      ctx.backendId = instanceKey.slice(0, separator) === 'no-backend' ? null : instanceKey.slice(0, separator);
      ctx.projectId = instanceKey.slice(separator + 2);
    }
  }
  usePluginStore
    .getState()
    .panels.find(p => p.id === toolId)
    ?.onClose?.(ctx);
}

/** Reactive: is `toolId` present anywhere in the session's workspace tree? */
export function useToolOpenState(sessionId: string, toolId: string): boolean {
  const pid = useProjectStore(s => s.sessions.find(session => session.id === sessionId)?.projectId);
  const unified = useAppearanceStore(s => s.unifiedWorkspace);
  const anchor = useProjectWorkspaceStore(s => pid ? s.byProject[pid]?.workspaceId : undefined);
  const route = useWorkspaceRoutingStore(s => s.active);
  const scoped = route && (route.sessionId === sessionId || route.workspaceId === sessionId) ? route.workspaceId : undefined;
  const workspaceId = unified && !isMobileViewport() ? scoped ?? anchor ?? sessionId : sessionId;
  return useRightWorkspaceStore(s => {
    const root = s.bySession[workspaceId]?.root ?? null;
    return findPaneWithTool(root, toolId, undefined, true) !== null;
  });
}
