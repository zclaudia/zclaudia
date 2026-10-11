import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useRightWorkspaceStore, findPane, flattenPanes, isChatRef, normalizeSessionWorkspace, pruneChat, type WorkspaceEdge } from '../../stores/rightWorkspaceStore';
import { useRightSidebarStore } from '../../stores/rightSidebarStore';
import { useProjectStore } from '../../stores/projectStore';
import { registerWorkspaceRoute, sessionWorkspaceId } from '../../stores/workspaceRoutingStore';
import { useProjectWorkspaceStore } from '../../stores/projectWorkspaceStore';
import { moveProjectChatToEdge, moveProjectChatToTab, moveScopedChatToEdge, reconcileProjectChats, selectProjectChat, resolveProjectWorkspace } from '../../actions/projectWorkspaceActions';
import { ChatPane } from './ChatPane';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { RightSidebarEmptyState } from '../../components/RightSidebarEmptyState';
import { FlatWorkspaceView } from '../../components/workspace/FlatWorkspaceView';
import { WorkspaceNavigationContext, type WorkspaceNavigationValue } from '../../components/workspace/WorkspaceContext';
import { useWorkspaceHydrated } from '../../components/workspace/useWorkspaceHydrated';
import { canDrop, resolvePointerToPane, resolveRootDrop, resolveTabDrop, useDragSplitStore } from '../../components/workspace/dragSplit';

interface Props extends WorkspaceNavigationValue {
  sessionId: string;
  workspaceScope?: 'project' | 'session';
  projectId?: string;
  projectRoot?: string;
  workingDirectory?: string;
  branchName?: string;
}

export function SessionWorkspaceView({ sessionId, projectId, projectRoot, workingDirectory, branchName, onReturnToDashboard, onOpenSidebar, workspaceScope = 'project', syncSelection = true }: Props) {
  const hydrated = useWorkspaceHydrated();
  const projectScoped = workspaceScope === 'project';
  const collapsed = useRightSidebarStore(s => s.collapsed);
  const widthFraction = useRightSidebarStore(s => s.widthFraction);
  const projectWorkspace = useProjectWorkspaceStore(s => projectScoped && projectId ? s.byProject[projectId] : undefined);
  const workspaceId = projectScoped ? projectWorkspace?.workspaceId ?? sessionId : sessionWorkspaceId(sessionId);
  const ws = useRightWorkspaceStore(s => s.bySession[workspaceId]);
  const catalog = useProjectStore(s => s.sessions);
  const focusedSession = useProjectStore(s => s.sessions.find(session => session.id === (projectScoped ? projectWorkspace?.focusedChatSessionId : sessionId)));
  const project = useProjectStore(s => s.projects.find(item => item.id === projectId));
  const focusedRoot = focusedSession?.workingDirectory || project?.rootPath || projectRoot;
  const ready = !!ws && flattenPanes(ws.root).some(p => p.tools.some(t => t.toolId === 'chat'));
  const contentRef = useRef<HTMLDivElement>(null);
  const activeDrag = useDragSplitStore(s => s.active);
  const hoverRootEdge = useDragSplitStore(s => s.hoverRootEdge);
  const navigation = useMemo(() => ({ onReturnToDashboard, onOpenSidebar, syncSelection }), [onReturnToDashboard, onOpenSidebar, syncSelection]);
  useKeyboardShortcuts({ projectId, projectRoot: focusedRoot });
  useEffect(() => {
    if (!hydrated) return;
    if (!projectScoped) {
      const state = useRightWorkspaceStore.getState();
      const current = state.bySession[workspaceId] ?? { root: null, primaryPaneId: null, focusedPaneId: null };
      const next = normalizeSessionWorkspace(current, sessionId, 1 - widthFraction);
      if (next !== current) useRightWorkspaceStore.setState(s => ({
        bySession: { ...s.bySession, [workspaceId]: next },
        order: [workspaceId, ...s.order.filter(id => id !== workspaceId)],
      }));
    } else if (projectId) {
      const ids = useProjectStore.getState().sessions.filter(s => s.projectId === projectId).map(s => s.id);
      if (!useProjectWorkspaceStore.getState().byProject[projectId] && !useRightWorkspaceStore.getState().bySession[sessionId]) useRightWorkspaceStore.getState().ensureChatSession(sessionId, 1 - widthFraction);
      resolveProjectWorkspace(projectId, ids, sessionId);
      selectProjectChat(projectId, sessionId);
    } else useRightWorkspaceStore.getState().ensureChatSession(sessionId, 1 - widthFraction);
  }, [hydrated, projectId, sessionId, widthFraction, projectScoped, workspaceId]);
  useEffect(() => {
    if (!hydrated || !ready || !projectId || !projectScoped) return;
    const ids = catalog.filter(s => s.projectId === projectId && !s.archivedAt).map(s => s.id);
    reconcileProjectChats(projectId, ids, sessionId);
  }, [catalog, hydrated, ready, projectId, sessionId, projectScoped]);
  useEffect(() => {
    if (!hydrated || !ready) return;
    return registerWorkspaceRoute({ workspaceId, sessionId, projectId, projectScoped });
  }, [hydrated, ready, workspaceId, sessionId, projectId, projectScoped]);
  useEffect(() => {
    if (!collapsed) return;
    useDragSplitStore.getState().endDrag();
    const state = useRightWorkspaceStore.getState();
    const current = state.bySession[workspaceId];
    const max = current?.maximizedPaneId;
    if (max && !flattenPanes(current.root).find(p => p.id === max)?.tools.some(t => t.toolId === 'chat')) state.setMaximizedPane(workspaceId, null);
  }, [collapsed, workspaceId]);
  useEffect(() => () => useDragSplitStore.getState().endDrag(), [workspaceId]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const state = useRightWorkspaceStore.getState();
      const current = state.bySession[workspaceId];
      if (e.key === 'Escape' && current?.maximizedPaneId) {
        e.preventDefault();
        state.setMaximizedPane(workspaceId, null);
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'Enter' && current?.focusedPaneId) {
        e.preventDefault();
        useRightSidebarStore.getState().setCollapsed(false);
        state.setMaximizedPane(workspaceId, current.maximizedPaneId === current.focusedPaneId ? null : current.focusedPaneId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [workspaceId]);
  useEffect(() => {
    if (!activeDrag) return;
    const cancelOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !contentRef.current?.contains(event.target)) useDragSplitStore.getState().endDrag();
    };
    const cancel = () => useDragSplitStore.getState().endDrag();
    document.addEventListener('pointerup', cancelOutside);
    document.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      document.removeEventListener('pointerup', cancelOutside);
      document.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, [activeDrag]);
  const onMove = useCallback((e: React.PointerEvent) => {
    const { active } = useDragSplitStore.getState();
    if (!active) return;
    const state = useDragSplitStore.getState();
    const rect = contentRef.current?.getBoundingClientRect();
    const rootEdge = active.toolId === 'chat' && rect ? resolveRootDrop(rect, e.clientX, e.clientY) : null;
    state.setRootHover(rootEdge);
    if (rootEdge) {
      state.setTabHover(null, null);
      state.setHover(null, null, new Set());
      return;
    }
    const candidate = active.toolId === 'chat' && !active.sourcePaneId ? null : resolveTabDrop(contentRef.current, e.clientX, e.clientY);
    const target = candidate ? findPane(useRightWorkspaceStore.getState().bySession[workspaceId]?.root ?? null, candidate.paneId) : null;
    const tab = candidate && target && (active.toolId === 'chat' ? target.tools.every(isChatRef) : !target.tools.some(isChatRef)) ? candidate : null;
    if (tab) {
      state.setTabHover(tab.paneId, tab.index);
      state.setHover(null, null, new Set());
    } else {
      state.setTabHover(null, null);
      const root = useRightWorkspaceStore.getState().bySession[workspaceId]?.root ?? null;
      const hit = resolvePointerToPane(contentRef.current, root, e.clientX, e.clientY, active);
      state.setHover(hit?.paneId ?? null, hit?.zone ?? null, hit?.disabled ?? new Set());
    }
  }, [workspaceId]);
  const onUp = useCallback((e: React.PointerEvent) => {
    const { active } = useDragSplitStore.getState();
    if (!active) return;
    const sidebarChat = active.toolId === 'chat' && !active.sourcePaneId;
    if (sidebarChat && (!projectScoped || !projectId || active.projectId !== projectId)) {
      useDragSplitStore.getState().endDrag();
      return;
    }
    if (!active.sourcePaneId && !sidebarChat) { useDragSplitStore.getState().endDrag(); return; }
    const rect = contentRef.current?.getBoundingClientRect();
    const rootEdge = active.toolId === 'chat' && rect ? resolveRootDrop(rect, e.clientX, e.clientY) : null;
    if (rootEdge) {
      const result = projectScoped && projectId && active.instanceKey
        ? moveProjectChatToEdge(projectId, active.instanceKey, rootEdge)
        : moveScopedChatToEdge(workspaceId, sessionId, rootEdge);
      if (result.ok && syncSelection && projectScoped && active.instanceKey) useProjectStore.getState().selectSession(active.instanceKey, projectId);
      useDragSplitStore.getState().endDrag();
      return;
    }
    const store = useRightWorkspaceStore.getState();
    const root = store.bySession[workspaceId]?.root ?? null;
    const candidate = active.toolId === 'chat' && !active.sourcePaneId ? null : resolveTabDrop(contentRef.current, e.clientX, e.clientY);
    const target = candidate ? findPane(useRightWorkspaceStore.getState().bySession[workspaceId]?.root ?? null, candidate.paneId) : null;
    const tab = candidate && target && (active.toolId === 'chat' ? target.tools.every(isChatRef) : !target.tools.some(isChatRef)) ? candidate : null;
    if (tab) {
      if (active.toolId === 'chat' && projectScoped && projectId && active.instanceKey) {
        const result = moveProjectChatToTab(projectId, active.instanceKey, tab.paneId, tab.index);
        if (result.ok && syncSelection) useProjectStore.getState().selectSession(active.instanceKey, projectId);
      } else if (canDrop(root, tab.paneId, 'center', active).allowed) {
        const source = active.sourcePaneId ? findPane(root, active.sourcePaneId) : null;
        const sourceIndex = source?.tools.findIndex(ref => ref.toolId === active.toolId && ref.instanceKey === active.instanceKey) ?? -1;
        if (active.sourcePaneId === tab.paneId && sourceIndex >= 0) store.reorderTab(workspaceId, tab.paneId, sourceIndex, tab.index > sourceIndex ? tab.index - 1 : tab.index);
        else if (active.sourcePaneId) store.moveTab(workspaceId, active.sourcePaneId, tab.paneId, active.toolId, active.instanceKey, tab.index);
      }
    } else {
      const hit = resolvePointerToPane(contentRef.current, root, e.clientX, e.clientY, active);
      if (hit && canDrop(root, hit.paneId, hit.zone, active).allowed) {
        if (hit.zone === 'center' && active.sourcePaneId) store.moveTab(workspaceId, active.sourcePaneId, hit.paneId, active.toolId, active.instanceKey);
        else if (active.toolId === 'chat' && projectScoped && projectId && active.instanceKey) {
          const result = moveProjectChatToEdge(projectId, active.instanceKey, hit.zone as WorkspaceEdge, hit.paneId);
          if (result.ok && syncSelection) useProjectStore.getState().selectSession(active.instanceKey, projectId);
        }
        else if (active.toolId === 'chat') moveScopedChatToEdge(workspaceId, sessionId, hit.zone as WorkspaceEdge, hit.paneId);
        else if (active.sourcePaneId) store.moveTabToEdge(workspaceId, active.sourcePaneId, hit.paneId, active.toolId, active.instanceKey, hit.zone as WorkspaceEdge);
      }
    }
    useDragSplitStore.getState().endDrag();
  }, [workspaceId, projectId, projectScoped, sessionId, syncSelection]);
  if (!hydrated || !ready) return <div className="flex-1 min-w-0" aria-busy="true" />;
  return (
    <WorkspaceNavigationContext.Provider value={navigation}>
      <div ref={contentRef} className="relative flex-1 min-w-0 min-h-0" onPointerMove={onMove} onPointerUp={onUp} data-session-workspace>
        <FlatWorkspaceView chatComponent={ChatPane} sessionId={workspaceId} collapsed={collapsed} projectScoped={projectScoped} chatSessionId={sessionId} projectId={projectId} projectRoot={projectRoot} workingDirectory={workingDirectory}
          emptyState={!collapsed && !pruneChat(ws.root) ? <RightSidebarEmptyState sessionId={sessionId} projectId={projectId} projectRoot={projectRoot} branchName={branchName} /> : undefined} />
        {hoverRootEdge && <div data-root-drop={hoverRootEdge} className={`pointer-events-none absolute z-30 bg-primary/30 ${
          hoverRootEdge === 'left' ? 'inset-y-0 left-0 w-2' : hoverRootEdge === 'right' ? 'inset-y-0 right-0 w-2' :
          hoverRootEdge === 'top' ? 'inset-x-0 top-0 h-2' : 'inset-x-0 bottom-0 h-2'
        }`} />}
      </div>
    </WorkspaceNavigationContext.Provider>
  );
}
