import { useContext } from 'react';
import { Plus, X, MessageSquare } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import {
  useRightWorkspaceStore,
  CHAT_TOOL_ID,
  isChatRef,
  type PaneNode,
} from '../../stores/rightWorkspaceStore';
import { useProjectWorkspaceStore } from '../../stores/projectWorkspaceStore';
import {
  closeChatRef,
  focusProjectChat,
  openSessionTab,
} from '../../actions/projectWorkspaceActions';
import { useSelectionCoordinator } from '../../hooks/useSelectionCoordinator';
import { DropdownMenu } from '../ui/DropdownMenu';
import { useDragSplitStore } from './dragSplit';
import { WorkspaceNavigationContext } from './WorkspaceContext';

/** Session tabs only change visibility; their content hosts keep stable ref keys. */
export function ChatTabs({
  workspaceId,
  projectId,
  pane,
}: {
  workspaceId: string;
  projectId: string;
  pane: PaneNode;
}) {
  const { syncSelection = true } = useContext(WorkspaceNavigationContext);
  const sessions = useProjectStore(s => s.sessions);
  const { selectSession } = useSelectionCoordinator();
  const activate = (sessionId: string) => {
    focusProjectChat(projectId, sessionId);
    useRightWorkspaceStore.getState().setActiveTool(workspaceId, pane.id, CHAT_TOOL_ID, sessionId);
    if (syncSelection) selectSession(sessionId);
  };
  return (
    <div
      data-tab-strip
      data-pane-id={pane.id}
      className="flex h-8 shrink-0 items-stretch border-b border-border/50 px-1 select-none"
    >
      <div
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto scrollbar-hidden"
        role="tablist"
        aria-label="Chat sessions"
      >
        {pane.tools.filter(isChatRef).map((ref, index) => {
          const sessionId = ref.instanceKey;
          if (!sessionId) return null;
          const session = sessions.find(item => item.id === sessionId);
          const title = session?.name || session?.autoTitle || 'Untitled Session';
          const active = pane.activeToolId === CHAT_TOOL_ID && pane.activeInstanceKey === sessionId;
          return (
            <div
              key={sessionId}
              data-tab-index={index}
              data-active={active ? 'true' : 'false'}
              className="group flex min-w-0 max-w-[180px] shrink-0 items-center"
            >
              <button
                role="tab"
                aria-selected={active}
                title={title}
                onClick={() => activate(sessionId)}
                onPointerDown={event => {
                  if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) return;
                  useDragSplitStore.getState().startDrag(
                    {
                      toolId: CHAT_TOOL_ID,
                      instanceKey: sessionId,
                      multiInstance: true,
                      sourcePaneId: pane.id,
                      sourceIndex: index,
                    },
                    { x: event.clientX, y: event.clientY }
                  );
                }}
                className={`flex min-w-0 items-center gap-1.5 px-2 text-xs ${active ? 'text-foreground shadow-[inset_0_-2px_0_hsl(var(--muted-foreground))]' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <MessageSquare size={13} className="shrink-0" />
                <span className="truncate">{title}</span>
              </button>
              <button
                aria-label={`Close ${title}`}
                onPointerDown={event => event.stopPropagation()}
                onClick={() => {
                  const result = closeChatRef(projectId, sessionId);
                  const next =
                    useProjectWorkspaceStore.getState().byProject[projectId]?.focusedChatSessionId;
                  if (result.ok && next && syncSelection) selectSession(next);
                }}
                className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-secondary group-hover:opacity-100 focus-visible:opacity-100"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <DropdownMenu
        ariaLabel="Add chat session"
        align="end"
        entries={sessions
          .filter(session => session.projectId === projectId && !session.archivedAt)
          .map(session => ({
            key: session.id,
            label: session.name || session.autoTitle || 'Untitled Session',
            onSelect: () => {
              if (openSessionTab(projectId, session.id, pane.id).ok && syncSelection)
                selectSession(session.id);
            },
          }))}
        trigger={({ ref, props }) => (
          <button
            ref={ref}
            {...props}
            aria-label="Add chat"
            title="Add chat"
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-secondary"
          >
            <Plus size={14} />
          </button>
        )}
      />
    </div>
  );
}
