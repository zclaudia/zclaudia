import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { MULTI_INSTANCE_PANELS } from './panelInstance';
import { recoverableJsonStorage, workspaceStorageKey } from '../utils/workspaceStorage';
import {
  CHAT_TOOL_ID,
  DEFAULT_RATIO,
  findPane,
  findPaneWithTool,
  findToolConflict,
  flattenPanes,
  genId,
  isPinnedPane,
  newPane,
  normalizeSessionWorkspace,
  restoreLayoutTree,
  pickFirstPane,
  pruneTools,
  removePane,
  repairWorkspace,
  replaceChild,
  sameRef,
  setRatioAt,
  type GroupNode,
  type LayoutNode,
  type PaneNode,
  type SessionWorkspace,
  type SplitDir,
  type SplitResult,
  type WorkspaceEdge,
} from '../utils/workspaceLayout';

// Compatibility entry for existing UI consumers; stores share the pure module directly.
export * from '../utils/workspaceLayout';

const MAX_LEGACY_SESSIONS = 50;
const EMPTY: SessionWorkspace = { root: null, primaryPaneId: null, focusedPaneId: null };

export interface OpenToolOpts {
  instanceKey?: string;
  target?: 'primary' | 'focused' | 'new-split';
  openMode?: 'shared' | 'dedicated';
  multiInstance?: boolean;
}

interface RightWorkspaceState {
  bySession: Record<string, SessionWorkspace>;
  /** MRU order of sessionIds; front = most recent. Used for LRU eviction. */
  order: string[];
  ensureSession: (sessionId: string) => void;
  ensureChatSession: (sessionId: string, ratio?: number) => void;
  openTool: (sessionId: string, toolId: string, opts?: OpenToolOpts) => void;
  closePane: (sessionId: string, paneId: string) => void;
  splitPane: (
    sessionId: string,
    fromPaneId: string,
    dir: SplitDir,
    toolId: string,
    instanceKey?: string,
    multiInstance?: boolean,
    insertFirst?: boolean
  ) => SplitResult;
  replaceTool: (
    sessionId: string,
    paneId: string,
    toolId: string,
    instanceKey?: string,
    multiInstance?: boolean
  ) => SplitResult;
  setRatio: (sessionId: string, groupId: string, ratio: number) => void;
  focusPane: (sessionId: string, paneId: string) => void;
  setActiveTool: (sessionId: string, paneId: string, toolId: string, instanceKey?: string) => void;
  closeTool: (sessionId: string, paneId: string, toolId: string, instanceKey?: string) => void;
  reorderTab: (sessionId: string, paneId: string, fromIndex: number, toIndex: number) => void;
  moveTab: (
    sessionId: string,
    fromPaneId: string,
    toPaneId: string,
    toolId: string,
    instanceKey: string | undefined,
    toIndex?: number
  ) => void;
  splitTabOut: (
    sessionId: string,
    fromPaneId: string,
    toolId: string,
    instanceKey: string | undefined,
    dir: SplitDir,
    insertFirst?: boolean
  ) => SplitResult;
  moveTabToEdge: (
    sessionId: string,
    fromPaneId: string,
    targetPaneId: string,
    toolId: string,
    instanceKey: string | undefined,
    edge: WorkspaceEdge
  ) => SplitResult;
  moveChatPane: (sessionId: string, edge: WorkspaceEdge, targetPaneId?: string) => SplitResult;
  setMaximizedPane: (sessionId: string, paneId: string | null) => void;
  resetSession: (sessionId: string) => void;
  removeSession: (sessionId: string) => void;
}

/**
 * Bound the legacy tools-only cache. Chat-bearing layouts are durable project
 * or standalone workspaces, so selecting other sessions must never evict them.
 */
function touch(order: string[], bySession: Record<string, SessionWorkspace>, sessionId: string) {
  const next = [sessionId, ...order.filter(id => id !== sessionId && bySession[id])];
  const evictable = next.filter(
    id => !bySession[id]?.durable && !flattenPanes(bySession[id]?.root ?? null).some(isPinnedPane)
  );
  for (const victim of evictable.slice(MAX_LEGACY_SESSIONS)) {
    delete bySession[victim];
    next.splice(next.indexOf(victim), 1);
  }
  return next;
}

function paneWithoutTab(pane: PaneNode, index: number): PaneNode | null {
  const tools = pane.tools.filter((_, i) => i !== index);
  if (!tools.length) return null;
  const active =
    tools.find(t => sameRef(t, pane.activeToolId, pane.activeInstanceKey)) ??
    tools[Math.min(index, tools.length - 1)];
  return { ...pane, tools, activeToolId: active.toolId, activeInstanceKey: active.instanceKey };
}

function insertAtEdge(target: LayoutNode, inserted: PaneNode, edge: WorkspaceEdge): GroupNode {
  const first = edge === 'left' || edge === 'top';
  return {
    id: genId('grp'),
    kind: 'group',
    dir: edge === 'left' || edge === 'right' ? 'row' : 'col',
    ratio: DEFAULT_RATIO,
    children: first ? [inserted, target] : [target, inserted],
  };
}

/** Both migration and merge use the same flag-independent validation. */
function restoreWorkspaces(persisted: unknown): Pick<RightWorkspaceState, 'bySession' | 'order'> {
  const p = (persisted ?? {}) as Partial<RightWorkspaceState>;
  const entries: [string, SessionWorkspace][] = [];
  if (p.bySession && typeof p.bySession === 'object') {
    for (const [id, ws] of Object.entries(p.bySession)) {
      const root = restoreLayoutTree(ws?.root, MULTI_INSTANCE_PANELS);
      entries.push([
        id,
        repairWorkspace({
          ...(ws?.durable === true ? { durable: true } : {}),
          root,
          primaryPaneId: root ? (ws?.primaryPaneId ?? null) : null,
          focusedPaneId: root ? (ws?.focusedPaneId ?? null) : null,
          ...(ws?.maximizedPaneId !== undefined ? { maximizedPaneId: ws.maximizedPaneId } : {}),
        }),
      ]);
    }
  }
  const bySession = Object.fromEntries(entries);
  const order = Array.isArray(p.order)
    ? [...new Set(p.order.filter(id => typeof id === 'string' && Object.hasOwn(bySession, id)))]
    : [];
  return { bySession, order };
}

export const useRightWorkspaceStore = create<RightWorkspaceState>()(
  persist(
    (set, _get) => {
      /** Apply `mut` to a fresh copy of the session's workspace, then persist + touch MRU. */
      const update = (sessionId: string, mut: (ws: SessionWorkspace) => SessionWorkspace) =>
        set(s => {
          const bySession = { ...s.bySession };
          const current = bySession[sessionId] ?? { ...EMPTY };
          const next = mut(current);
          if (next === current) return s;
          bySession[sessionId] = repairWorkspace(next);
          const order = touch([...s.order], bySession, sessionId);
          return { bySession, order };
        });

      return {
        bySession: {},
        order: [],

        ensureSession: sessionId =>
          set(s => {
            if (s.bySession[sessionId]) return {};
            const bySession = { ...s.bySession, [sessionId]: { ...EMPTY } };
            return { bySession, order: touch([...s.order], bySession, sessionId) };
          }),

        ensureChatSession: (sessionId, ratio = DEFAULT_RATIO) =>
          update(sessionId, ws => normalizeSessionWorkspace(ws, sessionId, ratio)),

        openTool: (sessionId, toolId, opts = {}) =>
          update(sessionId, ws => {
            if (toolId === CHAT_TOOL_ID) return ws;
            const singleton = !opts.multiInstance;
            const instanceKey = opts.instanceKey;

            // 1) Already open → focus it (make it the pane's active tab).
            const existing = findPaneWithTool(ws.root, toolId, instanceKey, singleton);
            if (existing) {
              if (!ws.root) return ws;
              const pane = findPane(ws.root, existing);
              if (!pane) return ws;
              const ref = pane.tools.find(
                t => t.toolId === toolId && (singleton || t.instanceKey === instanceKey)
              );
              if (!ref) return ws;
              const root = replaceChild(ws.root, existing, {
                ...pane,
                activeToolId: ref.toolId,
                activeInstanceKey: ref.instanceKey,
              });
              return { ...ws, root, focusedPaneId: existing, maximizedPaneId: null };
            }

            // 2) Empty workspace → seed as primary + focused.
            if (!ws.root) {
              const pane = newPane(toolId, instanceKey);
              return {
                ...ws,
                root: pane,
                primaryPaneId: pane.id,
                focusedPaneId: pane.id,
                maximizedPaneId: null,
              };
            }

            // 3) Append a tab to the focused pane (fallback: primary, then first).
            const toolPanes = flattenPanes(ws.root).filter(p => !isPinnedPane(p));
            const targetId =
              toolPanes.find(p => p.id === ws.focusedPaneId)?.id ??
              toolPanes.find(p => p.id === ws.primaryPaneId)?.id ??
              toolPanes[0]?.id;
            if (!targetId) {
              const pane = newPane(toolId, instanceKey);
              const root: GroupNode = {
                id: genId('grp'),
                kind: 'group',
                dir: 'row',
                ratio: DEFAULT_RATIO,
                children: [ws.root, pane],
              };
              return {
                ...ws,
                root,
                primaryPaneId: pane.id,
                focusedPaneId: pane.id,
                maximizedPaneId: null,
              };
            }
            const pane = findPane(ws.root, targetId);
            if (!pane) return ws;
            const appended: PaneNode = {
              ...pane,
              tools: [...pane.tools, { toolId, instanceKey }],
              activeToolId: toolId,
              activeInstanceKey: instanceKey,
            };
            return {
              ...ws,
              root: replaceChild(ws.root, targetId, appended),
              focusedPaneId: targetId,
              maximizedPaneId: null,
            };
          }),

        splitPane: (
          sessionId,
          fromPaneId,
          dir,
          toolId,
          instanceKey,
          multiInstance,
          insertFirst = false
        ) => {
          const ws = _get().bySession[sessionId];
          if (!ws?.root || !findPane(ws.root, fromPaneId)) return { ok: false, conflictPaneId: '' };
          if (toolId === CHAT_TOOL_ID) return { ok: false, conflictPaneId: fromPaneId };
          const singleton = !multiInstance;
          const conflict = findToolConflict(ws.root, toolId, instanceKey, singleton, ' __new__');
          if (conflict) return { ok: false, conflictPaneId: conflict };
          const ref = newPane(toolId, instanceKey);
          update(sessionId, w => {
            if (!w.root) return w;
            const fp = findPane(w.root, fromPaneId);
            if (!fp) return w;
            const group: GroupNode = {
              id: genId('grp'),
              kind: 'group',
              dir,
              ratio: DEFAULT_RATIO,
              children: insertFirst ? [ref, fp] : [fp, ref],
            };
            return { ...w, root: replaceChild(w.root, fromPaneId, group), focusedPaneId: ref.id };
          });
          return { ok: true, newPaneId: ref.id };
        },

        replaceTool: (sessionId, paneId, toolId, instanceKey, multiInstance) => {
          const ws = _get().bySession[sessionId];
          const pane = ws?.root ? findPane(ws.root, paneId) : null;
          if (!pane) return { ok: false, conflictPaneId: '' };
          if (isPinnedPane(pane) || toolId === CHAT_TOOL_ID)
            return { ok: false, conflictPaneId: paneId };
          const singleton = !multiInstance;
          const conflict = findToolConflict(ws.root, toolId, instanceKey, singleton, paneId);
          if (conflict) return { ok: false, conflictPaneId: conflict };
          update(sessionId, w => {
            if (!w.root) return w;
            const p = findPane(w.root, paneId);
            if (!p) return w;
            const replaced: PaneNode = {
              ...p,
              tools: [{ toolId, instanceKey }],
              activeToolId: toolId,
              activeInstanceKey: instanceKey,
            };
            return { ...w, root: replaceChild(w.root, paneId, replaced), focusedPaneId: paneId };
          });
          return { ok: true, newPaneId: '' };
        },

        closePane: (sessionId, paneId) =>
          update(sessionId, ws => {
            if (!ws.root) return ws;
            const pane = findPane(ws.root, paneId);
            if (!pane || isPinnedPane(pane)) return ws;
            const next = removePane(ws.root, paneId);
            if (next === ws.root) return ws; // not found
            const primaryPaneId =
              ws.primaryPaneId === paneId ? pickFirstPane(next) : ws.primaryPaneId;
            const focusedPaneId =
              ws.focusedPaneId === paneId ? pickFirstPane(next) : ws.focusedPaneId;
            return { ...ws, root: next, primaryPaneId, focusedPaneId };
          }),

        setRatio: (sessionId, groupId, ratio) =>
          update(sessionId, ws =>
            ws.root && Number.isFinite(ratio)
              ? { ...ws, root: setRatioAt(ws.root, groupId, ratio) }
              : ws
          ),

        focusPane: (sessionId, paneId) =>
          update(sessionId, ws =>
            findPane(ws.root, paneId) ? { ...ws, focusedPaneId: paneId } : ws
          ),

        setActiveTool: (sessionId, paneId, toolId, instanceKey) =>
          update(sessionId, ws => {
            const pane = ws.root ? findPane(ws.root, paneId) : null;
            if (!pane || !pane.tools.some(t => sameRef(t, toolId, instanceKey))) return ws;
            const replaced: PaneNode = {
              ...pane,
              activeToolId: toolId,
              activeInstanceKey: instanceKey,
            };
            if (!ws.root) return ws;
            return { ...ws, root: replaceChild(ws.root, paneId, replaced), focusedPaneId: paneId };
          }),

        closeTool: (sessionId, paneId, toolId, instanceKey) =>
          update(sessionId, ws => {
            if (!ws.root) return ws;
            const pane = findPane(ws.root, paneId);
            if (!pane || isPinnedPane(pane) || toolId === CHAT_TOOL_ID) return ws;
            const idx = pane.tools.findIndex(t => sameRef(t, toolId, instanceKey));
            if (idx < 0) return ws;
            const nextTools = pane.tools.filter((_, i) => i !== idx);

            // Last tab → collapse the pane (mirror closePane reassignment).
            if (nextTools.length === 0) {
              const next = removePane(ws.root, paneId);
              if (next === ws.root) return ws;
              const primaryPaneId =
                ws.primaryPaneId === paneId ? pickFirstPane(next) : ws.primaryPaneId;
              const focusedPaneId =
                ws.focusedPaneId === paneId ? pickFirstPane(next) : ws.focusedPaneId;
              return { ...ws, root: next, primaryPaneId, focusedPaneId };
            }

            // Keep current active if it survived, else the neighbor at the closed index.
            const wasActive =
              pane.activeToolId === toolId && pane.activeInstanceKey === instanceKey;
            const activeRef = wasActive
              ? nextTools[Math.min(idx, nextTools.length - 1)]
              : (nextTools.find(
                  t => t.toolId === pane.activeToolId && t.instanceKey === pane.activeInstanceKey
                ) ?? nextTools[0]);
            const replaced: PaneNode = {
              ...pane,
              tools: nextTools,
              activeToolId: activeRef.toolId,
              activeInstanceKey: activeRef.instanceKey,
            };
            return { ...ws, root: replaceChild(ws.root, paneId, replaced), focusedPaneId: paneId };
          }),

        reorderTab: (sessionId, paneId, fromIndex, toIndex) =>
          update(sessionId, ws => {
            const pane = ws.root ? findPane(ws.root, paneId) : null;
            if (!pane) return ws;
            const n = pane.tools.length;
            if (
              fromIndex < 0 ||
              fromIndex >= n ||
              toIndex < 0 ||
              toIndex >= n ||
              fromIndex === toIndex
            )
              return ws;
            const tools = [...pane.tools];
            const [moved] = tools.splice(fromIndex, 1);
            tools.splice(toIndex, 0, moved);
            if (!ws.root) return ws;
            return { ...ws, root: replaceChild(ws.root, paneId, { ...pane, tools }) };
          }),

        moveTab: (sessionId, fromPaneId, toPaneId, toolId, instanceKey, toIndex) =>
          update(sessionId, ws => {
            if (!ws.root || fromPaneId === toPaneId) return ws;
            const fromPane = findPane(ws.root, fromPaneId);
            const toPane = findPane(ws.root, toPaneId);
            if (!fromPane || !toPane) return ws;
            if (isPinnedPane(fromPane) || isPinnedPane(toPane) || toolId === CHAT_TOOL_ID)
              return ws;
            const idx = fromPane.tools.findIndex(t => sameRef(t, toolId, instanceKey));
            if (idx < 0) return ws;

            // Destination already has this tool (singleton: any instance; multi: same instanceKey) → no-op.
            const singleton = !MULTI_INSTANCE_PANELS.has(toolId);
            const dup = toPane.tools.some(
              t => t.toolId === toolId && (singleton || t.instanceKey === instanceKey)
            );
            if (dup) return ws;

            const ref = fromPane.tools[idx];

            // 1) Insert into destination at toIndex (default end) and make it active.
            const insertAt =
              toIndex === undefined
                ? toPane.tools.length
                : Math.max(0, Math.min(toIndex, toPane.tools.length));
            const toTools = [...toPane.tools];
            toTools.splice(insertAt, 0, ref);
            const newTo: PaneNode = {
              ...toPane,
              tools: toTools,
              activeToolId: ref.toolId,
              activeInstanceKey: ref.instanceKey,
            };
            let root = replaceChild(ws.root, toPaneId, newTo);

            // 2) Remove from source; collapse if emptied.
            const fromTools = fromPane.tools.filter((_, i) => i !== idx);
            let primaryPaneId = ws.primaryPaneId;
            if (fromTools.length === 0) {
              const collapsed = removePane(root, fromPaneId);
              root = collapsed ?? root;
              if (primaryPaneId === fromPaneId) primaryPaneId = pickFirstPane(root);
            } else {
              const wasActive =
                fromPane.activeToolId === toolId && fromPane.activeInstanceKey === instanceKey;
              const activeRef = wasActive
                ? fromTools[Math.min(idx, fromTools.length - 1)]
                : (fromTools.find(
                    t =>
                      t.toolId === fromPane.activeToolId &&
                      t.instanceKey === fromPane.activeInstanceKey
                  ) ?? fromTools[0]);
              const newFrom: PaneNode = {
                ...fromPane,
                tools: fromTools,
                activeToolId: activeRef.toolId,
                activeInstanceKey: activeRef.instanceKey,
              };
              root = replaceChild(root, fromPaneId, newFrom);
            }

            return { ...ws, root, primaryPaneId, focusedPaneId: toPaneId };
          }),

        splitTabOut: (sessionId, fromPaneId, toolId, instanceKey, dir, insertFirst = false) => {
          const ws = _get().bySession[sessionId];
          const fromPane = ws?.root ? findPane(ws.root, fromPaneId) : null;
          if (!fromPane) return { ok: false, conflictPaneId: '' };
          if (isPinnedPane(fromPane) || toolId === CHAT_TOOL_ID)
            return { ok: false, conflictPaneId: fromPaneId };
          const idx = fromPane.tools.findIndex(t => sameRef(t, toolId, instanceKey));
          if (idx < 0 || fromPane.tools.length <= 1) return { ok: false, conflictPaneId: '' };
          const ref = fromPane.tools[idx];
          const newP = { ...newPane(ref.toolId, ref.instanceKey), tools: [ref] };
          update(sessionId, w => {
            if (!w.root) return w;
            const fp = findPane(w.root, fromPaneId);
            if (!fp) return w;
            const remaining = fp.tools.filter((_, i) => i !== idx);
            const wasActive = fp.activeToolId === toolId && fp.activeInstanceKey === instanceKey;
            const activeRef = wasActive
              ? remaining[Math.min(idx, remaining.length - 1)]
              : (remaining.find(
                  t => t.toolId === fp.activeToolId && t.instanceKey === fp.activeInstanceKey
                ) ?? remaining[0]);
            const updatedFrom: PaneNode = {
              ...fp,
              tools: remaining,
              activeToolId: activeRef.toolId,
              activeInstanceKey: activeRef.instanceKey,
            };
            const group: GroupNode = {
              id: genId('grp'),
              kind: 'group',
              dir,
              ratio: DEFAULT_RATIO,
              children: insertFirst ? [newP, updatedFrom] : [updatedFrom, newP],
            };
            return { ...w, root: replaceChild(w.root, fromPaneId, group), focusedPaneId: newP.id };
          });
          return { ok: true, newPaneId: newP.id };
        },

        moveTabToEdge: (sessionId, fromPaneId, targetPaneId, toolId, instanceKey, edge) => {
          const ws = _get().bySession[sessionId];
          const from = ws?.root ? findPane(ws.root, fromPaneId) : null;
          const target = ws?.root ? findPane(ws.root, targetPaneId) : null;
          if (
            !from ||
            !target ||
            !['left', 'right', 'top', 'bottom'].includes(edge) ||
            isPinnedPane(from) ||
            toolId === CHAT_TOOL_ID
          ) {
            return { ok: false, conflictPaneId: '' };
          }
          const index = from.tools.findIndex(t => sameRef(t, toolId, instanceKey));
          if (index < 0 || (fromPaneId === targetPaneId && from.tools.length === 1)) {
            return { ok: false, conflictPaneId: '' };
          }
          const conflict = findToolConflict(
            ws.root,
            toolId,
            instanceKey,
            !MULTI_INSTANCE_PANELS.has(toolId),
            fromPaneId
          );
          if (conflict) return { ok: false, conflictPaneId: conflict };
          const ref = from.tools[index];
          // Moving the last tab moves its shell too; a partial tab split gets a new shell.
          const inserted =
            from.tools.length === 1
              ? from
              : { ...newPane(ref.toolId, ref.instanceKey), tools: [ref] };
          update(sessionId, current => {
            if (!current.root) return current;
            const remaining = paneWithoutTab(from, index);
            const root = remaining
              ? replaceChild(current.root, fromPaneId, remaining)
              : removePane(current.root, fromPaneId);
            if (!root) return current;
            const destination = findPane(root, targetPaneId);
            if (!destination) return current;
            return {
              ...current,
              root: replaceChild(root, targetPaneId, insertAtEdge(destination, inserted, edge)),
              focusedPaneId: inserted.id,
              maximizedPaneId: null,
            };
          });
          return { ok: true, newPaneId: inserted.id };
        },

        moveChatPane: (sessionId, edge, targetPaneId) => {
          const ws = _get().bySession[sessionId];
          const chat = flattenPanes(ws?.root ?? null).find(p =>
            p.tools.some(t => sameRef(t, CHAT_TOOL_ID, sessionId))
          );
          if (
            !ws?.root ||
            !chat ||
            !['left', 'right', 'top', 'bottom'].includes(edge) ||
            targetPaneId === chat.id ||
            (targetPaneId && !findPane(ws.root, targetPaneId))
          ) {
            return { ok: false, conflictPaneId: '' };
          }
          const rest = removePane(ws.root, chat.id);
          if (!rest) return { ok: false, conflictPaneId: '' };
          const target = targetPaneId ? findPane(rest, targetPaneId) : rest;
          if (!target) return { ok: false, conflictPaneId: '' };
          update(sessionId, current => ({
            ...current,
            root: targetPaneId
              ? replaceChild(rest, targetPaneId, insertAtEdge(target, chat, edge))
              : insertAtEdge(rest, chat, edge),
            focusedPaneId: chat.id,
            maximizedPaneId: null,
          }));
          return { ok: true, newPaneId: chat.id };
        },

        setMaximizedPane: (sessionId, paneId) =>
          update(sessionId, ws => {
            if (paneId !== null && !findPane(ws.root, paneId)) return ws;
            if (ws.maximizedPaneId === paneId) return ws;
            return { ...ws, maximizedPaneId: paneId, ...(paneId ? { focusedPaneId: paneId } : {}) };
          }),

        resetSession: sessionId =>
          update(sessionId, ws => {
            const root = pruneTools(ws.root);
            return {
              ...ws,
              root,
              primaryPaneId: null,
              focusedPaneId: pickFirstPane(root),
              maximizedPaneId: null,
            };
          }),

        removeSession: sessionId =>
          set(s => {
            if (!s.bySession[sessionId]) return {};
            const bySession = { ...s.bySession };
            delete bySession[sessionId];
            return { bySession, order: s.order.filter(id => id !== sessionId) };
          }),
      };
    },
    {
      name: workspaceStorageKey(
        'claudia-right-workspace',
        typeof window === 'undefined' ? '' : window.location.search
      ),
      version: 3,
      storage: createJSONStorage(() => recoverableJsonStorage(localStorage)),
      partialize: s => ({ bySession: s.bySession, order: s.order }),
      migrate: persisted => restoreWorkspaces(persisted),
      merge: (persisted, current) => ({ ...current, ...restoreWorkspaces(persisted) }),
    }
  )
);

// One-time cleanup of the retired global split-layout persistence.
if (typeof localStorage !== 'undefined') {
  try {
    localStorage.removeItem('claudia-split-layout');
  } catch {
    /* ignore */
  }
}
