import { usePluginStore } from '../stores/pluginStore';
import { useRightWorkspaceStore, findPaneWithTool } from '../stores/rightWorkspaceStore';
import { useRightSidebarStore } from '../stores/rightSidebarStore';
import { MULTI_INSTANCE_PANELS } from '../stores/panelInstance';
import { getTerminalScopeKey } from '../stores/terminalStore';

export interface OpenToolCtx {
  projectId?: string;
  backendId?: string | null;
  target?: 'primary' | 'focused' | 'new-split';
}

/** Resolve the instanceKey for a multi-instance tool from context (terminal only today). */
function resolveInstanceKey(toolId: string, ctx: OpenToolCtx): string | undefined {
  if (toolId === 'terminal' && ctx.projectId) {
    return getTerminalScopeKey(ctx.projectId, ctx.backendId);
  }
  return undefined;
}

export function openToolInWorkspace(sessionId: string, toolId: string, ctx: OpenToolCtx = {}): void {
  const panel = usePluginStore.getState().panels.find((p) => p.id === toolId);
  const openMode = panel?.openMode ?? 'shared';
  const multiInstance = MULTI_INSTANCE_PANELS.has(toolId);
  useRightWorkspaceStore.getState().openTool(sessionId, toolId, {
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
  const ws = useRightWorkspaceStore.getState().bySession[sessionId];
  if (!ws?.root) return;
  const paneId = findPaneWithTool(ws.root, toolId, undefined, true);
  if (!paneId) return;
  useRightWorkspaceStore.getState().closePane(sessionId, paneId);
  // Preserve panel-specific cleanup (terminal drawer, file viewer, draft store).
  usePluginStore.getState().panels.find((p) => p.id === toolId)?.onClose?.();
}

/** Reactive: is `toolId` present anywhere in the session's workspace tree? */
export function useToolOpenState(sessionId: string, toolId: string): boolean {
  return useRightWorkspaceStore((s) => {
    const root = s.bySession[sessionId]?.root ?? null;
    return findPaneWithTool(root, toolId, undefined, true) !== null;
  });
}
