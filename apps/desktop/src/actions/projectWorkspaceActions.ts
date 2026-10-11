import {
  CHAT_TOOL_ID,
  activeToolRef,
  findPane,
  flattenPanes,
  genId,
  isChatRef,
  newPane,
  removePane,
  replaceChild,
  sameRef,
  pruneChat,
  useRightWorkspaceStore,
  type LayoutNode,
  type PaneNode,
  type SessionWorkspace,
  type WorkspaceEdge,
} from '../stores/rightWorkspaceStore';
import { useProjectWorkspaceStore } from '../stores/projectWorkspaceStore';
import { useProjectStore } from '../stores/projectStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { useOwnershipStore } from '../stores/ownershipStore';

/**
 * Adopt the project's most recently used S2 tree once. Older per-session trees
 * stay available to the legacy renderer and are never overwritten or deleted.
 * Invoke after both stores hydrate, with the project's actual session ids.
 */
export function resolveProjectWorkspace(
  projectId: string,
  sessionIds: string[],
  preferredSessionId?: string
): string {
  const projects = useProjectWorkspaceStore.getState();
  const layouts = useRightWorkspaceStore.getState();
  const existing = projects.byProject[projectId];
  if (existing && layouts.bySession[existing.workspaceId]) {
    if (!layouts.bySession[existing.workspaceId].durable) useRightWorkspaceStore.setState(state => ({
      bySession: { ...state.bySession, [existing.workspaceId]: { ...state.bySession[existing.workspaceId], durable: true } },
    }));
    return existing.workspaceId;
  }
  const ids = [...new Set(sessionIds)];
  const candidate = layouts.order.find(id => ids.includes(id) && layouts.bySession[id]) ??
    ids.find(id => layouts.bySession[id]);
  const workspaceId = candidate ?? preferredSessionId ?? ids[0];
  if (!workspaceId) throw new Error('A project workspace requires at least one session');
  const initial = layouts.bySession[workspaceId];
  // Do not reseed the original anchor chat after a user replaced/closed that ref.
  if (!flattenPanes(initial?.root ?? null).some(p => p.tools.some(isChatRef))) {
    layouts.ensureChatSession(workspaceId);
  }
  const workspace = useRightWorkspaceStore.getState().bySession[workspaceId];
  if (!workspace.durable) useRightWorkspaceStore.setState(state => ({
    bySession: { ...state.bySession, [workspaceId]: { ...state.bySession[workspaceId], durable: true } },
  }));
  const chats = flattenPanes(workspace.root).filter(p => p.tools.some(isChatRef));
  const focusedPane = chats.find(p => p.id === workspace.focusedPaneId) ?? chats[0];
  const active = focusedPane ? activeToolRef(focusedPane) : undefined;
  const focusedChatSessionId = active?.instanceKey ?? workspaceId;
  useProjectWorkspaceStore.setState(state => ({ byProject: { ...state.byProject, [projectId]: {
    workspaceId, focusedChatSessionId, toolBindings: existing?.toolBindings ?? {},
  } } }));
  return workspaceId;
}

export const migrateSessionLayouts = resolveProjectWorkspace;

export type ProjectChatResult = { ok: true; paneId: string } | { ok: false };

/** New refs require positive catalog evidence; a known delete beats stale REST data. */
export function isProjectChatAvailable(projectId: string, sessionId: string): boolean {
  const local = useProjectStore.getState().sessions.find(session => session.id === sessionId);
  if (local?.archivedAt) return false;
  const ownership = useOwnershipStore.getState();
  const backendId = ownership.getProjectBackendId(projectId) ?? ownership.getSessionBackendId(sessionId);
  const sessions = useSessionsStore.getState();
  if (backendId ? sessions.deletedSessionIds.get(backendId)?.has(sessionId) :
      [...sessions.deletedSessionIds.values()].some(ids => ids.has(sessionId))) return false;
  const remote = backendId ? sessions.remoteSessions.get(backendId)?.find(session => session.id === sessionId) :
    [...sessions.remoteSessions.values()].flat().find(session => session.id === sessionId && session.projectId === projectId);
  return remote ? remote.projectId === projectId && !remote.archivedAt : local?.projectId === projectId;
}

function chatPane(root: LayoutNode | null, sessionId: string): PaneNode | undefined {
  return flattenPanes(root).find(p => p.tools.some(ref => sameRef(ref, CHAT_TOOL_ID, sessionId)));
}

function anchor(projectId: string, sessionId: string): string {
  const saved = useProjectWorkspaceStore.getState().byProject[projectId];
  if (saved && useRightWorkspaceStore.getState().bySession[saved.workspaceId]) return saved.workspaceId;
  const sessions = useProjectStore.getState().sessions.filter(s => s.projectId === projectId).map(s => s.id);
  return resolveProjectWorkspace(projectId, [...sessions, sessionId], sessionId);
}

function preferredChatPane(projectId: string, ws: SessionWorkspace, targetPaneId?: string): PaneNode | undefined {
  const explicit = targetPaneId ? findPane(ws.root, targetPaneId) : null;
  if (explicit?.tools.some(isChatRef)) return explicit;
  const focused = ws.focusedPaneId ? findPane(ws.root, ws.focusedPaneId) : null;
  if (focused?.tools.some(isChatRef)) return focused;
  const remembered = useProjectWorkspaceStore.getState().byProject[projectId]?.focusedChatSessionId;
  return (remembered ? chatPane(ws.root, remembered) : undefined) ??
    flattenPanes(ws.root).find(p => p.tools.some(isChatRef));
}

/** One layout notification; project focus metadata carries no geometry/content identity. */
function updateWorkspace(workspaceId: string, edit: (ws: SessionWorkspace) => SessionWorkspace): void {
  useRightWorkspaceStore.setState(state => {
    const ws = state.bySession[workspaceId];
    if (!ws) return state;
    const next = edit(ws);
    if (next === ws) return state;
    const panes = flattenPanes(next.root);
    const primary = panes.find(p => p.id === next.primaryPaneId && !p.tools.some(isChatRef)) ??
      panes.find(p => !p.tools.some(isChatRef));
    const focused = panes.find(p => p.id === next.focusedPaneId) ?? panes[0];
    const maximizedPaneId = panes.some(p => p.id === next.maximizedPaneId) ? next.maximizedPaneId : null;
    return {
      bySession: { ...state.bySession, [workspaceId]: { ...next,
        primaryPaneId: primary?.id ?? null, focusedPaneId: focused?.id ?? null, maximizedPaneId,
      } },
      order: [workspaceId, ...state.order.filter(id => id !== workspaceId)],
    };
  });
}

function activate(ws: SessionWorkspace, pane: PaneNode, sessionId: string): SessionWorkspace {
  if (!ws.root) return ws;
  if (pane.activeToolId === CHAT_TOOL_ID && pane.activeInstanceKey === sessionId &&
      ws.focusedPaneId === pane.id && (!ws.maximizedPaneId || ws.maximizedPaneId === pane.id)) return ws;
  const active = { ...pane, activeToolId: CHAT_TOOL_ID, activeInstanceKey: sessionId };
  return { ...ws, root: replaceChild(ws.root, pane.id, active), focusedPaneId: pane.id,
    // A hidden pane must become visible when selected.
    maximizedPaneId: ws.maximizedPaneId && ws.maximizedPaneId !== pane.id ? null : ws.maximizedPaneId,
  };
}

export function focusProjectChat(projectId: string, sessionId: string): ProjectChatResult {
  const project = useProjectWorkspaceStore.getState().byProject[projectId];
  if (!project) return { ok: false };
  const ws = useRightWorkspaceStore.getState().bySession[project.workspaceId];
  const pane = chatPane(ws?.root ?? null, sessionId);
  if (!pane) return { ok: false };
  updateWorkspace(project.workspaceId, current => activate(current, pane, sessionId));
  useProjectWorkspaceStore.getState().setFocusedChat(projectId, sessionId);
  return { ok: true, paneId: pane.id };
}

/** A real deletion can leave an anchor empty or containing only tools. */
function insertFirstChat(projectId: string, workspaceId: string, sessionId: string): ProjectChatResult {
  const inserted = newPane(CHAT_TOOL_ID, sessionId);
  updateWorkspace(workspaceId, current => ({ ...current,
    root: current.root ? { id: genId('grp'), kind: 'group', dir: 'row', ratio: 0.5,
      children: [inserted, current.root] } : inserted,
    focusedPaneId: inserted.id, maximizedPaneId: null,
  }));
  useProjectWorkspaceStore.getState().setFocusedChat(projectId, sessionId);
  return { ok: true, paneId: inserted.id };
}

/** Plain click replaces the focused chat; modifier click opens a distinct pane beside it. */
export function selectProjectChat(
  projectId: string,
  sessionId: string,
  options: { beside?: boolean; targetPaneId?: string } = {}
): ProjectChatResult {
  if (!isProjectChatAvailable(projectId, sessionId)) return { ok: false };
  const workspaceId = anchor(projectId, sessionId);
  const ws = useRightWorkspaceStore.getState().bySession[workspaceId];
  if (!ws) return { ok: false };
  if (chatPane(ws.root, sessionId)) return focusProjectChat(projectId, sessionId);
  const target = preferredChatPane(projectId, ws, options.targetPaneId);
  if (!target) return insertFirstChat(projectId, workspaceId, sessionId);
  let paneId = target.id;
  if (options.beside) {
    const inserted = newPane(CHAT_TOOL_ID, sessionId);
    paneId = inserted.id;
    const split: LayoutNode = { id: genId('grp'), kind: 'group', dir: 'row', ratio: 0.5,
      children: [target, inserted] };
    updateWorkspace(workspaceId, current => current.root ? { ...current,
      root: replaceChild(current.root, target.id, split), focusedPaneId: inserted.id, maximizedPaneId: null,
    } : current);
  } else {
    const active = activeToolRef(target);
    const remembered = useProjectWorkspaceStore.getState().byProject[projectId]?.focusedChatSessionId;
    const replacedSession = isChatRef(active) ? active.instanceKey : remembered;
    const index = target.tools.findIndex(ref => sameRef(ref, CHAT_TOOL_ID, replacedSession));
    const replaceIndex = index >= 0 ? index : target.tools.findIndex(isChatRef);
    const tools = target.tools.map((ref, i) => i === replaceIndex ? { toolId: CHAT_TOOL_ID, instanceKey: sessionId } : ref);
    const changed = { ...target, tools, activeToolId: CHAT_TOOL_ID, activeInstanceKey: sessionId };
    updateWorkspace(workspaceId, current => current.root ? activate({ ...current,
      root: replaceChild(current.root, target.id, changed),
    }, changed, sessionId) : current);
  }
  useProjectWorkspaceStore.getState().setFocusedChat(projectId, sessionId);
  return { ok: true, paneId };
}

/** Add a chat tab without replacing or remounting any existing session ref. */
export function openSessionTab(projectId: string, sessionId: string, targetPaneId?: string): ProjectChatResult {
  if (!isProjectChatAvailable(projectId, sessionId)) return { ok: false };
  const workspaceId = anchor(projectId, sessionId);
  const ws = useRightWorkspaceStore.getState().bySession[workspaceId];
  if (!ws) return { ok: false };
  if (chatPane(ws.root, sessionId)) return focusProjectChat(projectId, sessionId);
  const target = preferredChatPane(projectId, ws, targetPaneId);
  if (!target) return insertFirstChat(projectId, workspaceId, sessionId);
  const changed = { ...target, tools: [...target.tools, { toolId: CHAT_TOOL_ID, instanceKey: sessionId }],
    activeToolId: CHAT_TOOL_ID, activeInstanceKey: sessionId };
  updateWorkspace(workspaceId, current => current.root ? activate({ ...current,
    root: replaceChild(current.root, target.id, changed),
  }, changed, sessionId) : current);
  useProjectWorkspaceStore.getState().setFocusedChat(projectId, sessionId);
  return { ok: true, paneId: target.id };
}

export function closeChatRef(projectId: string, sessionId: string): ProjectChatResult {
  const project = useProjectWorkspaceStore.getState().byProject[projectId];
  const ws = project ? useRightWorkspaceStore.getState().bySession[project.workspaceId] : undefined;
  if (!project || !ws?.root) return { ok: false };
  const allChats = flattenPanes(ws.root).flatMap(p => p.tools.filter(isChatRef));
  const pane = chatPane(ws.root, sessionId);
  if (!pane || new Set(allChats.map(ref => ref.instanceKey)).size <= 1) return { ok: false };
  const tools = pane.tools.filter(ref => !sameRef(ref, CHAT_TOOL_ID, sessionId));
  const active = tools.find(ref => sameRef(ref, pane.activeToolId, pane.activeInstanceKey)) ?? tools[0];
  const root = tools.length ? replaceChild(ws.root, pane.id, { ...pane, tools,
    activeToolId: active.toolId, activeInstanceKey: active.instanceKey,
  }) : removePane(ws.root, pane.id);
  const remaining = flattenPanes(root).filter(p => p.tools.some(isChatRef));
  const nextSession = project.focusedChatSessionId === sessionId
    ? active?.instanceKey ?? activeToolRef(remaining[0]).instanceKey
    : project.focusedChatSessionId;
  const nextPane = chatPane(root, nextSession ?? '');
  updateWorkspace(project.workspaceId, current => ({ ...current, root,
    focusedPaneId: current.focusedPaneId === pane.id ? nextPane?.id ?? null : current.focusedPaneId,
  }));
  if (nextSession) useProjectWorkspaceStore.getState().setFocusedChat(projectId, nextSession);
  return { ok: true, paneId: nextPane?.id ?? remaining[0].id };
}

/** Atomic chat-ref move, including splitting a session tab out or moving to a root edge. */
export function moveProjectChatToEdge(
  projectId: string,
  sessionId: string,
  edge: WorkspaceEdge,
  targetPaneId?: string
): ProjectChatResult {
  const project = useProjectWorkspaceStore.getState().byProject[projectId];
  const ws = project ? useRightWorkspaceStore.getState().bySession[project.workspaceId] : undefined;
  if (!project || !ws?.root || !['left', 'right', 'top', 'bottom'].includes(edge)) return { ok: false };
  const source = chatPane(ws.root, sessionId);
  if (!source) {
    const target = targetPaneId ? findPane(ws.root, targetPaneId) : ws.root;
    if (!isProjectChatAvailable(projectId, sessionId) || !target) return { ok: false };
    const inserted = newPane(CHAT_TOOL_ID, sessionId);
    const first = edge === 'left' || edge === 'top';
    const split: LayoutNode = { id: genId('grp'), kind: 'group', dir: edge === 'left' || edge === 'right' ? 'row' : 'col',
      ratio: 0.5, children: first ? [inserted, target] : [target, inserted] };
    updateWorkspace(project.workspaceId, current => ({ ...current,
      root: targetPaneId && current.root ? replaceChild(current.root, targetPaneId, split) : split,
      focusedPaneId: inserted.id, maximizedPaneId: null,
    }));
    useProjectWorkspaceStore.getState().setFocusedChat(projectId, sessionId);
    return { ok: true, paneId: inserted.id };
  }
  if (source.id === targetPaneId && source.tools.length === 1) return { ok: false };
  const ref = source.tools.find(t => sameRef(t, CHAT_TOOL_ID, sessionId));
  if (!ref) return { ok: false };
  const tools = source.tools.filter(t => t !== ref);
  const active = tools.find(t => sameRef(t, source.activeToolId, source.activeInstanceKey)) ?? tools[0];
  const rest = tools.length ? replaceChild(ws.root, source.id, { ...source, tools,
    activeToolId: active.toolId, activeInstanceKey: active.instanceKey,
  }) : removePane(ws.root, source.id);
  if (!rest) return { ok: false };
  const target = targetPaneId ? findPane(rest, targetPaneId) : rest;
  if (!target) return { ok: false };
  const inserted = tools.length ? { ...newPane(CHAT_TOOL_ID, sessionId), tools: [ref] } : source;
  const first = edge === 'left' || edge === 'top';
  const split: LayoutNode = { id: genId('grp'), kind: 'group', dir: edge === 'left' || edge === 'right' ? 'row' : 'col',
    ratio: 0.5, children: first ? [inserted, target] : [target, inserted] };
  const root = targetPaneId ? replaceChild(rest, targetPaneId, split) : split;
  updateWorkspace(project.workspaceId, current => ({ ...current, root, focusedPaneId: inserted.id, maximizedPaneId: null }));
  useProjectWorkspaceStore.getState().setFocusedChat(projectId, sessionId);
  return { ok: true, paneId: inserted.id };
}

/** Standalone windows own one real chat ref under a separate layout storage key. */
export function moveScopedChatToEdge(
  workspaceId: string,
  sessionId: string,
  edge: WorkspaceEdge,
  targetPaneId?: string
): ProjectChatResult {
  const ws = useRightWorkspaceStore.getState().bySession[workspaceId];
  const source = chatPane(ws?.root ?? null, sessionId);
  if (!ws?.root || !source || source.tools.length !== 1 ||
      !['left', 'right', 'top', 'bottom'].includes(edge) || source.id === targetPaneId) return { ok: false };
  const rest = removePane(ws.root, source.id);
  if (!rest) return { ok: false };
  const target = targetPaneId ? findPane(rest, targetPaneId) : rest;
  if (!target) return { ok: false };
  const first = edge === 'left' || edge === 'top';
  const split: LayoutNode = { id: genId('grp'), kind: 'group', dir: edge === 'left' || edge === 'right' ? 'row' : 'col',
    ratio: 0.5, children: first ? [source, target] : [target, source] };
  updateWorkspace(workspaceId, current => ({ ...current,
    root: targetPaneId ? replaceChild(rest, targetPaneId, split) : split,
    focusedPaneId: source.id, maximizedPaneId: null,
  }));
  return { ok: true, paneId: source.id };
}

/** A chat strip is a dedicated merge target; ordinary pane-center drops remain forbidden. */
export function moveProjectChatToTab(
  projectId: string,
  sessionId: string,
  targetPaneId: string,
  toIndex?: number
): ProjectChatResult {
  const project = useProjectWorkspaceStore.getState().byProject[projectId];
  const ws = project ? useRightWorkspaceStore.getState().bySession[project.workspaceId] : undefined;
  if (!project || !ws?.root) return { ok: false };
  const source = chatPane(ws.root, sessionId);
  const target = findPane(ws.root, targetPaneId);
  if (!source || !target || !source.tools.every(isChatRef) || !target.tools.every(isChatRef)) return { ok: false };
  const sourceIndex = source.tools.findIndex(t => sameRef(t, CHAT_TOOL_ID, sessionId));
  const ref = source.tools[sourceIndex];
  const samePane = source.id === target.id;
  if (!samePane && target.tools.some(t => sameRef(t, CHAT_TOOL_ID, sessionId))) return { ok: false };
  const insertion = typeof toIndex === 'number' && Number.isFinite(toIndex)
    ? Math.max(0, Math.min(target.tools.length, Math.trunc(toIndex))) : target.tools.length;
  const sourceTools = source.tools.filter((_, index) => index !== sourceIndex);
  const targetTools = samePane ? [...sourceTools] : [...target.tools];
  targetTools.splice(samePane && insertion > sourceIndex ? insertion - 1 : insertion, 0, ref);
  const updatedTarget = { ...target, tools: targetTools, activeToolId: CHAT_TOOL_ID, activeInstanceKey: sessionId };
  let root: LayoutNode | null = ws.root;
  if (!samePane) {
    const active = sourceTools.find(t => sameRef(t, source.activeToolId, source.activeInstanceKey)) ?? sourceTools[0];
    root = sourceTools.length ? replaceChild(root, source.id, { ...source, tools: sourceTools,
      activeToolId: active.toolId, activeInstanceKey: active.instanceKey,
    }) : removePane(root, source.id);
  }
  if (!root) return { ok: false };
  root = replaceChild(root, target.id, updatedTarget);
  updateWorkspace(project.workspaceId, current => ({ ...current, root, focusedPaneId: target.id,
    maximizedPaneId: current.maximizedPaneId === target.id ? target.id : null,
  }));
  useProjectWorkspaceStore.getState().setFocusedChat(projectId, sessionId);
  return { ok: true, paneId: target.id };
}

/** Catalog reconciliation is separate from user close: deleted sessions cannot stay subscribed. */
export function reconcileProjectChats(
  projectId: string,
  validSessionIds: string[],
  preferredSessionId?: string,
  options: { authoritative?: boolean } = {}
): ProjectChatResult {
  const valid = new Set(validSessionIds);
  // Only a complete owner snapshot can distinguish an empty project from loading.
  if (!valid.size) {
    if (!options.authoritative) return { ok: false };
    const project = useProjectWorkspaceStore.getState().byProject[projectId];
    if (!project) return { ok: false };
    updateWorkspace(project.workspaceId, current => {
      const root = pruneChat(current.root);
      return root === current.root ? current : { ...current, root };
    });
    if (project.focusedChatSessionId !== '' || Object.values(project.toolBindings).some(binding => binding.mode === 'fixed')) {
      useProjectWorkspaceStore.setState(state => ({ byProject: { ...state.byProject, [projectId]: {
        ...project, focusedChatSessionId: '',
        toolBindings: Object.fromEntries(Object.entries(project.toolBindings).map(([key]) => [key, { mode: 'follow' as const }])),
      } } }));
    }
    return { ok: false };
  }
  const workspaceId = resolveProjectWorkspace(projectId, validSessionIds, preferredSessionId);
  const ws = useRightWorkspaceStore.getState().bySession[workspaceId];
  const seen = new Set<string>();
  const prune = (node: LayoutNode | null): LayoutNode | null => {
    if (!node || node.kind === 'placeholder') return node;
    if (node.kind === 'group') {
      const a = prune(node.children[0]);
      const b = prune(node.children[1]);
      if (!a) return b;
      if (!b) return a;
      return a === node.children[0] && b === node.children[1] ? node : { ...node, children: [a, b] };
    }
    const tools = node.tools.filter(ref => {
      if (!isChatRef(ref)) return true;
      if (!ref.instanceKey || !valid.has(ref.instanceKey) || seen.has(ref.instanceKey)) return false;
      seen.add(ref.instanceKey);
      return true;
    });
    if (!tools.length) return null;
    if (tools.length === node.tools.length) return node;
    const active = tools.find(t => sameRef(t, node.activeToolId, node.activeInstanceKey)) ?? tools[0];
    return { ...node, tools, activeToolId: active.toolId, activeInstanceKey: active.instanceKey };
  };
  let root = prune(ws.root);
  if (!seen.size) {
    const sessionId = preferredSessionId && valid.has(preferredSessionId) ? preferredSessionId : validSessionIds[0];
    const inserted = newPane(CHAT_TOOL_ID, sessionId);
    root = root ? { id: genId('grp'), kind: 'group', dir: 'row', ratio: 0.5, children: [inserted, root] } : inserted;
    seen.add(sessionId);
  }
  const project = useProjectWorkspaceStore.getState().byProject[projectId];
  const nextSession = seen.has(project.focusedChatSessionId) ? project.focusedChatSessionId :
    preferredSessionId && seen.has(preferredSessionId) ? preferredSessionId : [...seen][0];
  const nextPane = chatPane(root, nextSession);
  if (!nextPane) return { ok: false };
  updateWorkspace(workspaceId, current => {
    const focusedExists = current.focusedPaneId && findPane(root, current.focusedPaneId);
    return root === current.root ? current : { ...current, root,
      focusedPaneId: focusedExists ? current.focusedPaneId : nextPane.id,
    };
  });
  const toolBindings = Object.fromEntries(Object.entries(project.toolBindings).map(([key, binding]) =>
    [key, binding.mode === 'fixed' && !valid.has(binding.sessionId) ? { mode: 'follow' as const } : binding]));
  if (nextSession !== project.focusedChatSessionId ||
      Object.values(project.toolBindings).some(binding => binding.mode === 'fixed' && !valid.has(binding.sessionId))) {
    useProjectWorkspaceStore.setState(state => ({ byProject: { ...state.byProject, [projectId]: {
      ...project, focusedChatSessionId: nextSession, toolBindings,
    } } }));
  }
  return { ok: true, paneId: nextPane.id };
}
