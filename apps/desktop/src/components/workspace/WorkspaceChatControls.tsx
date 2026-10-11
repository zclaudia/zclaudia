import { useContext } from 'react';
import { Columns2, GripVertical, Maximize2, Minimize2, X } from 'lucide-react';
import { flattenPanes, useRightWorkspaceStore } from '../../stores/rightWorkspaceStore';
import { useRightSidebarStore } from '../../stores/rightSidebarStore';
import { useProjectStore } from '../../stores/projectStore';
import { useProjectWorkspaceStore } from '../../stores/projectWorkspaceStore';
import { closeChatRef, selectProjectChat } from '../../actions/projectWorkspaceActions';
import { DropdownMenu } from '../ui/DropdownMenu';
import { LayoutMenu } from './LayoutMenu';
import { IconButton } from '../ui/Button';
import { useWorkspacePane, WorkspaceNavigationContext } from './WorkspaceContext';
import { useDragSplitStore } from './dragSplit';

export function WorkspaceChatControls() {
  const { syncSelection = true } = useContext(WorkspaceNavigationContext);
  const pane = useWorkspacePane();
  const projectId = pane?.projectId;
  const maximized = useRightWorkspaceStore(s =>
    pane ? s.bySession[pane.workspaceId]?.maximizedPaneId === pane.paneId : false
  );
  const sessions = useProjectStore(s => s.sessions);
  const root = useRightWorkspaceStore(s => pane ? s.bySession[pane.workspaceId]?.root : null);
  const chatCount = new Set(flattenPanes(root ?? null).flatMap(p => p.tools.filter(t => t.toolId === 'chat').map(t => t.instanceKey))).size;
  if (!pane) return null;
  return (
    <div className="flex shrink-0 items-center gap-0.5" data-workspace-chat-controls>
      <IconButton
        size="sm"
        aria-label="Move chat pane"
        className="cursor-grab active:cursor-grabbing"
        onPointerDown={e => {
          if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) return;
          const node = useRightWorkspaceStore.getState().bySession[pane.workspaceId]?.root;
          const ref = flattenPanes(node ?? null).find(p => p.id === pane.paneId)?.tools.find(t => t.toolId === 'chat');
          useDragSplitStore.getState().startDrag({
            toolId: 'chat', instanceKey: pane.chatSessionId ?? ref?.instanceKey, sourcePaneId: pane.paneId, multiInstance: true,
          }, { x: e.clientX, y: e.clientY });
        }}
      >
        <GripVertical size={14} strokeWidth={1.75} />
      </IconButton>
      {projectId && <>
        <LayoutMenu projectId={projectId} />
        <DropdownMenu ariaLabel="Compare with" align="end" entries={sessions.filter(s => s.projectId === projectId && s.id !== pane.chatSessionId && !s.archivedAt).map(s => ({
          key: s.id, label: s.name || s.autoTitle || 'Untitled Session', onSelect: () => {
            if (selectProjectChat(projectId, s.id, { beside: true, targetPaneId: pane.paneId }).ok && syncSelection) useProjectStore.getState().selectSession(s.id, projectId);
          },
        }))} trigger={({ ref, props }) => <IconButton ref={ref} {...props} size="sm" aria-label="Compare with"><Columns2 size={14} strokeWidth={1.75} /></IconButton>} />
        <IconButton size="sm" aria-label="Close chat pane" disabled={chatCount <= 1} onClick={() => {
          if (!pane.chatSessionId || !closeChatRef(projectId, pane.chatSessionId).ok) return;
          const next = useProjectWorkspaceStore.getState().byProject[projectId]?.focusedChatSessionId;
          if (next && syncSelection) useProjectStore.getState().selectSession(next, projectId);
        }}><X size={14} strokeWidth={1.75} /></IconButton>
      </>}
      <IconButton
        size="sm"
        aria-label={maximized ? 'Restore chat pane' : 'Maximize chat pane'}
        onClick={() => {
          useRightSidebarStore.getState().setCollapsed(false);
          useRightWorkspaceStore.getState().setMaximizedPane(pane.workspaceId, maximized ? null : pane.paneId);
        }}
      >
        {maximized ? <Minimize2 size={14} strokeWidth={1.75} /> : <Maximize2 size={14} strokeWidth={1.75} />}
      </IconButton>
    </div>
  );
}
