import {
  mapLayoutPreset,
  presetTreeFromLayout,
  useLayoutPresetStore,
  type PresetMutationResult,
} from '../stores/layoutPresetStore';
import {
  CHAT_TOOL_ID,
  findPaneWithTool,
  flattenPanes,
  isChatRef,
  isSafeTree,
  newPane,
  replaceChild,
  useRightWorkspaceStore,
  type LayoutNode,
  type PlaceholderNode,
  type SessionWorkspace,
} from '../stores/rightWorkspaceStore';
import { useProjectWorkspaceStore } from '../stores/projectWorkspaceStore';
import { useProjectStore } from '../stores/projectStore';
import { useRightSidebarStore } from '../stores/rightSidebarStore';
import { usePluginStore } from '../stores/pluginStore';
import { MULTI_INSTANCE_PANELS } from '../stores/panelInstance';
import { getTerminalScopeKey } from '../stores/terminalStore';
import { focusProjectChat } from './projectWorkspaceActions';
import type { OpenToolCtx } from './workspaceActions';

export type ApplyPresetResult = { ok: true; workspaceId: string } |
  { ok: false; error: 'not-found' | 'workspace-not-found' | 'invalid-layout' };
export type FillSlotResult = { ok: true; paneId: string } |
  { ok: false; error: 'slot-not-found' | 'wrong-slot-kind' | 'workspace-not-found' | 'panel-not-found' | 'session-not-found' };

function projectWorkspace(projectId: string) {
  const project = useProjectWorkspaceStore.getState().byProject[projectId];
  const ws = project ? useRightWorkspaceStore.getState().bySession[project.workspaceId] : undefined;
  return project && ws ? { project, ws } : undefined;
}

/** The complete mapped tree is validated before the single layout notification. */
function commit(workspaceId: string, ws: SessionWorkspace): void {
  if (ws.root && !isSafeTree(ws.root)) throw new Error('Invalid workspace layout');
  useRightWorkspaceStore.setState(state => {
    if (state.bySession[workspaceId] === ws) return state;
    return {
      bySession: { ...state.bySession, [workspaceId]: ws },
      order: [workspaceId, ...state.order.filter(id => id !== workspaceId)],
    };
  });
}

export function applyLayoutPreset(projectId: string, presetId: string): ApplyPresetResult {
  const preset = useLayoutPresetStore.getState().presets.find(p => p.id === presetId);
  if (!preset) return { ok: false, error: 'not-found' };
  const current = projectWorkspace(projectId);
  if (!current) return { ok: false, error: 'workspace-not-found' };
  let next: SessionWorkspace;
  try {
    next = mapLayoutPreset(current.ws, preset, current.project.focusedChatSessionId);
  } catch {
    return { ok: false, error: 'invalid-layout' };
  }
  commit(current.project.workspaceId, next);
  useLayoutPresetStore.getState().setProjectPreset(projectId, presetId);
  // Presets expose their geometry. Focus uses the chat maximum to hide kept tools.
  useRightSidebarStore.getState().setCollapsed(false);
  return { ok: true, workspaceId: current.project.workspaceId };
}

export function saveCurrentLayoutPreset(projectId: string, name: string): PresetMutationResult {
  const current = projectWorkspace(projectId);
  if (!current?.ws.root) return { ok: false, error: 'invalid-layout' };
  const result = useLayoutPresetStore.getState().createPreset(name, presetTreeFromLayout(current.ws.root));
  if (result.ok) useLayoutPresetStore.getState().setProjectPreset(projectId, result.preset.id);
  return result;
}

function findPlaceholder(root: LayoutNode | null, id: string): PlaceholderNode | undefined {
  if (!root || root.kind === 'pane') return undefined;
  if (root.kind === 'placeholder') return root.id === id ? root : undefined;
  return findPlaceholder(root.children[0], id) ?? findPlaceholder(root.children[1], id);
}

export function fillChatSlot(projectId: string, placeholderId: string, sessionId: string): FillSlotResult {
  const current = projectWorkspace(projectId);
  if (!current?.ws.root) return { ok: false, error: 'workspace-not-found' };
  const placeholder = findPlaceholder(current.ws.root, placeholderId);
  if (!placeholder) return { ok: false, error: 'slot-not-found' };
  if (placeholder.accepts !== 'chat' || !sessionId) return { ok: false, error: 'wrong-slot-kind' };
  const session = useProjectStore.getState().sessions.find(s => s.id === sessionId);
  if (!session || session.projectId !== projectId || session.archivedAt) {
    return { ok: false, error: 'session-not-found' };
  }
  // Selecting an already-open session focuses its original host, leaving the empty slot available.
  const existing = focusProjectChat(projectId, sessionId);
  if (existing.ok) return existing;
  const pane = newPane(CHAT_TOOL_ID, sessionId);
  commit(current.project.workspaceId, {
    ...current.ws, root: replaceChild(current.ws.root, placeholderId, pane),
    focusedPaneId: pane.id, maximizedPaneId: null,
  });
  useProjectWorkspaceStore.getState().setFocusedChat(projectId, sessionId);
  return { ok: true, paneId: pane.id };
}

/** Explicit launcher selection fills a tool slot; applying a preset never calls this. */
export function fillToolSlot(
  projectId: string,
  placeholderId: string,
  toolId: string,
  ctx: OpenToolCtx = {}
): FillSlotResult {
  const current = projectWorkspace(projectId);
  if (!current?.ws.root) return { ok: false, error: 'workspace-not-found' };
  const placeholder = findPlaceholder(current.ws.root, placeholderId);
  if (!placeholder) return { ok: false, error: 'slot-not-found' };
  if (placeholder.accepts === 'chat' || toolId === CHAT_TOOL_ID ||
      (placeholder.accepts !== 'tool:*' && placeholder.accepts !== `tool:${toolId}`)) {
    return { ok: false, error: 'wrong-slot-kind' };
  }
  const panel = usePluginStore.getState().panels.find(p => p.id === toolId);
  if (!panel) return { ok: false, error: 'panel-not-found' };
  const instanceKey = toolId === 'terminal' ? getTerminalScopeKey(ctx.projectId ?? projectId, ctx.backendId) : undefined;
  const existing = findPaneWithTool(current.ws.root, toolId, instanceKey, !MULTI_INSTANCE_PANELS.has(toolId));
  if (existing) {
    useRightWorkspaceStore.getState().setActiveTool(current.project.workspaceId, existing, toolId, instanceKey);
    useRightWorkspaceStore.getState().setMaximizedPane(current.project.workspaceId, null);
    useRightSidebarStore.getState().setCollapsed(false);
    return { ok: true, paneId: existing };
  }
  const pane = newPane(toolId, instanceKey);
  const primary = flattenPanes(current.ws.root).find(p => p.id === current.ws.primaryPaneId && !p.tools.some(isChatRef));
  commit(current.project.workspaceId, {
    ...current.ws, root: replaceChild(current.ws.root, placeholderId, pane),
    primaryPaneId: primary?.id ?? pane.id, focusedPaneId: pane.id, maximizedPaneId: null,
  });
  useRightSidebarStore.getState().setCollapsed(false);
  panel.onOpen?.({ sessionId: current.project.focusedChatSessionId, projectId: ctx.projectId ?? projectId, backendId: ctx.backendId });
  return { ok: true, paneId: pane.id };
}
