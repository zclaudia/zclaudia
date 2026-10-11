import { memo, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { activeToolRef, flattenPanes, findPane, pruneTools, type LayoutNode, type ToolRef, type PaneNode, type PlaceholderNode, useRightWorkspaceStore } from '../../stores/rightWorkspaceStore';
import { resolveToolBindingSession, useProjectWorkspaceStore } from '../../stores/projectWorkspaceStore';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useProjectStore } from '../../stores/projectStore';
import { focusProjectChat } from '../../actions/projectWorkspaceActions';
import { usePluginStore } from '../../stores/pluginStore';
import { useServerStore } from '../../stores/serverStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useRightSidebarStore } from '../../stores/rightSidebarStore';
import { PanelContent } from '../panels/PanelRenderer';
import { IconButton } from '../ui/Button';
import { PaneCard } from './PaneCard';
import { PaneTabs } from './PaneTabs';
import { DropOverlay } from './DropOverlay';
import { ResizeDivider } from './ResizeDivider';
import { ChatTabs } from './ChatTabs';
import { ToolBindingMenu } from './ToolBindingMenu';
import { WorkspacePlaceholder } from './WorkspacePlaceholder';
import { WorkspaceToolProvider } from './WorkspaceToolContext';
import { WorkspaceNavigationContext, WorkspacePaneContext, WorkspaceVisibilityContext } from './WorkspaceContext';
import { solveWorkspaceGeometry } from './workspaceGeometry';

export const toolRefKey = (ref: ToolRef) => JSON.stringify([ref.toolId, ref.instanceKey ?? null]);

interface Props {
  /** Feature composition supplies the stable chat content implementation. */
  chatComponent: ComponentType<{ sessionId: string }>;
  sessionId: string;
  chatSessionId?: string;
  projectScoped?: boolean;
  collapsed: boolean;
  projectId?: string;
  projectRoot?: string;
  workingDirectory?: string;
  emptyState?: ReactNode;
}

function terminalScope(instanceKey: string | undefined, projectId?: string) {
  const sep = instanceKey?.indexOf('::') ?? -1;
  return sep >= 0 && instanceKey ? { backendId: instanceKey.slice(0, sep), projectId: instanceKey.slice(sep + 2) } : { projectId };
}

function placeholders(root: LayoutNode | null): PlaceholderNode[] {
  if (!root || root.kind === 'pane') return [];
  return root.kind === 'placeholder' ? [root] : root.children.flatMap(placeholders);
}

const ToolContent = memo(function ToolContent({ toolId, projectId, projectRoot, workingDirectory }: {
  toolId: string; projectId?: string; projectRoot?: string; workingDirectory?: string;
}) {
  const panel = usePluginStore(s => s.panels.find(p => p.id === toolId));
  return panel ? <PanelContent panel={panel} projectId={projectId} projectRoot={projectRoot} workingDirectory={workingDirectory} /> : (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Unavailable panel</div>
  );
});

const ChatHost = memo(function ChatHost({ sessionId, workspaceId, paneId, projectId, chatComponent: ChatComponent }: {
  sessionId: string; workspaceId: string; paneId: string; projectId?: string; chatComponent: ComponentType<{ sessionId: string }>;
}) {
  const value = useMemo(() => ({ workspaceId, paneId, projectId, chatSessionId: sessionId }),
    [workspaceId, paneId, projectId, sessionId]);
  return <WorkspacePaneContext.Provider value={value}><ChatComponent sessionId={sessionId} /></WorkspacePaneContext.Provider>;
});

/** Kept outside ToolContent so showing a restored terminal can initialize it once. */
function ToolHost({ tool, visible, projectId, projectRoot, workingDirectory, workspaceId, children, projectScoped, chatSessionId }: {
  tool: ToolRef; visible: boolean; projectId?: string; projectRoot?: string; workingDirectory?: string; workspaceId: string; children?: ReactNode; projectScoped: boolean; chatSessionId?: string;
}) {
  const activeServerId = useServerStore(s => s.activeServerId);
  useProjectWorkspaceStore(s => projectScoped && projectId ? s.byProject[projectId] : undefined);
  const boundSessionId = projectScoped && projectId ? resolveToolBindingSession(projectId, tool, chatSessionId ?? workspaceId) ?? chatSessionId ?? workspaceId : chatSessionId ?? workspaceId;
  const boundSession = useProjectStore(s => s.sessions.find(session => session.id === boundSessionId));
  const boundProject = useProjectStore(s => s.projects.find(project => project.id === (boundSession?.projectId ?? projectId)));
  const boundRoot = boundSession?.workingDirectory || boundProject?.rootPath || projectRoot;
  const boundDirectory = boundSession?.workingDirectory ?? workingDirectory;
  const scope = terminalScope(tool.instanceKey, projectId);
  const ownerBackendId = useOwnershipStore(s => s.getSessionBackendId(boundSessionId) ?? s.getProjectBackendId(boundSession?.projectId ?? projectId));
  const backendId = scope.backendId ?? ownerBackendId ?? activeServerId;
  const effectiveProjectId = tool.toolId === 'terminal' ? scope.projectId : projectId;
  useEffect(() => {
    if (children || !visible || tool.toolId !== 'terminal' || !effectiveProjectId) return;
    const state = useTerminalStore.getState();
    if (!state.getTerminalId(effectiveProjectId, backendId)) state.openTerminal(effectiveProjectId, backendId);
  }, [visible, tool.toolId, effectiveProjectId, backendId, children]);
  return <WorkspaceToolProvider sessionId={boundSessionId} projectId={effectiveProjectId} projectRoot={boundRoot}
    workingDirectory={boundDirectory} backendId={backendId ?? undefined} toolId={tool.toolId} visible={visible}>
    {children ?? <ToolContent toolId={tool.toolId} projectId={effectiveProjectId} projectRoot={boundRoot} workingDirectory={boundDirectory} />}
  </WorkspaceToolProvider>;
}

/** Outer cards and ref-keyed content are siblings: moving a ref never changes its parent. */
export function FlatWorkspaceView({ sessionId, chatSessionId, chatComponent, projectScoped = true, collapsed, projectId, projectRoot, workingDirectory, emptyState }: Props) {
  const { syncSelection = true } = useContext(WorkspaceNavigationContext);
  const ws = useRightWorkspaceStore(s => s.bySession[sessionId]);
  const root = ws?.root ?? null;
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const hasRoot = !!root;
  const emptyFraction = useRightSidebarStore(s => s.widthFraction);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const update = () => setSize({ width: Math.max(0, el.clientWidth - 16), height: Math.max(0, el.clientHeight - 16) });
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasRoot]);
  const panes = useMemo(() => flattenPanes(root), [root]);
  if (!root) return null;
  const maximized = ws?.maximizedPaneId ? findPane(root, ws.maximizedPaneId) : null;
  const showEmpty = !!emptyState && !maximized && !collapsed && !!root;
  const visibleRoot: LayoutNode | null = maximized && (!collapsed || maximized.tools.some(ref => ref.toolId === 'chat')) ? maximized : collapsed ? pruneTools(root) : (showEmpty ? {
    id: 'virtual-empty-split', kind: 'group', dir: 'row', ratio: 1 - emptyFraction,
    children: [root, { id: 'virtual-empty-pane', kind: 'pane', tools: [{ toolId: 'virtual-empty' }], activeToolId: 'virtual-empty' }],
  } : root);
  const geometry = solveWorkspaceGeometry(visibleRoot, size);
  const maximize = (id: string) => {
    useRightSidebarStore.getState().setCollapsed(false);
    useRightWorkspaceStore.getState().setMaximizedPane(sessionId, ws?.maximizedPaneId === id ? null : id);
  };
  const refs = panes.flatMap(pane => pane.tools.map(tool => ({ pane, tool })));
  const focus = (pane: PaneNode, tool = activeToolRef(pane)) => {
    if (tool.toolId === 'chat' && projectScoped && projectId && tool.instanceKey) {
      focusProjectChat(projectId, tool.instanceKey);
      if (syncSelection) useProjectStore.getState().selectSession(tool.instanceKey, projectId);
    } else useRightWorkspaceStore.getState().focusPane(sessionId, pane.id);
  };
  return (
    <div ref={container} className="absolute inset-0 overflow-auto p-2" data-flat-workspace>
      <div className="relative" style={{ width: geometry.width, height: geometry.height }}>
        {panes.map(pane => {
          const rect = geometry.panes.get(pane.id);
          const chat = pane.tools.some(t => t.toolId === 'chat');
          return (
            <PaneCard
              key={pane.id}
              data-pane-id={pane.id}
              focused={ws?.focusedPaneId === pane.id}
              hidden={!rect}
              inert={!rect || undefined}
              className="absolute"
              style={rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : { display: 'none' }}
              onPointerDown={() => focus(pane)}
              onDoubleClick={e => {
                if ((e.target as HTMLElement).closest('[data-tab-strip]')) maximize(pane.id);
              }}
            >
              {chat && pane.tools.length > 1 && projectScoped && projectId && <ChatTabs workspaceId={sessionId} projectId={projectId} pane={pane} />}
              {!chat && (
                <div className="flex h-8 min-w-0 items-center border-b border-border/50">
                  <div className="min-w-0 flex-1"><ToolHost tool={activeToolRef(pane)} visible={!!rect} projectId={projectId} projectRoot={projectRoot} workingDirectory={workingDirectory} workspaceId={sessionId} projectScoped={projectScoped} chatSessionId={chatSessionId}><PaneTabs sessionId={sessionId} pane={pane} focused={ws?.focusedPaneId === pane.id} projectId={projectId} /></ToolHost></div>
                  {projectScoped && projectId && <ToolBindingMenu projectId={projectId} tool={activeToolRef(pane)} />}
                  <IconButton className="shrink-0" size="sm" aria-label={ws?.maximizedPaneId === pane.id ? 'Restore tool pane' : 'Maximize tool pane'} onClick={() => maximize(pane.id)}>
                    {ws?.maximizedPaneId === pane.id ? <Minimize2 size={14} strokeWidth={1.75} /> : <Maximize2 size={14} strokeWidth={1.75} />}
                  </IconButton>
                </div>
              )}
            </PaneCard>
          );
        })}
        {placeholders(root).map(node => {
          const rect = geometry.panes.get(node.id);
          return rect && projectScoped && projectId ? <PaneCard key={node.id} className="absolute" data-placeholder-id={node.id}
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
            <WorkspacePlaceholder node={node} projectId={projectId} />
          </PaneCard> : null;
        })}
        {showEmpty && (() => {
          const rect = geometry.panes.get('virtual-empty-pane');
          return rect ? <PaneCard className="absolute" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>{emptyState}</PaneCard> : null;
        })()}
        {refs.map(({ pane, tool }) => {
          const rect = geometry.panes.get(pane.id);
          const active = activeToolRef(pane);
          const visible = !!rect && toolRefKey(active) === toolRefKey(tool);
          const chat = tool.toolId === 'chat';
          const headerHeight = chat && pane.tools.length === 1 ? 1 : 33;
          const style: CSSProperties = rect ? {
            left: rect.left + 1, top: rect.top + headerHeight, width: rect.width - 2,
            height: Math.max(0, rect.height - headerHeight - 1), display: visible ? undefined : 'none',
          } : { display: 'none' };
          return (
            <div key={toolRefKey(tool)} data-content-ref={toolRefKey(tool)} className={`absolute flex min-h-0 min-w-0 flex-col overflow-hidden ${chat ? 'rounded-lg' : 'rounded-b-lg'}`}
              style={style} hidden={!visible} inert={!visible || undefined}
              onPointerDown={() => focus(pane, tool)}>
              <WorkspaceVisibilityContext.Provider value={visible}>
                {chat ? (
                  <ChatHost sessionId={tool.instanceKey ?? sessionId} chatComponent={chatComponent} workspaceId={sessionId} paneId={pane.id} projectId={projectScoped ? projectId : undefined} />
                ) : <ToolHost tool={tool} visible={visible} projectId={projectId} projectRoot={projectRoot} workingDirectory={workingDirectory} workspaceId={sessionId} projectScoped={projectScoped} chatSessionId={chatSessionId} />}
              </WorkspaceVisibilityContext.Provider>
            </div>
          );
        })}
        {panes.map(pane => {
          const rect = geometry.panes.get(pane.id);
          return rect ? <div key={`overlay-${pane.id}`} className="absolute pointer-events-none" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}><DropOverlay paneId={pane.id} /></div> : null;
        })}
        {geometry.dividers.map(divider => (
          <ResizeDivider key={divider.groupId} groupId={divider.groupId} dir={divider.dir}
            containerSize={divider.axisSize} style={{ position: 'absolute', ...divider.rect }}
            onDrag={delta => {
              const ratio = Math.max(divider.minRatio, Math.min(divider.maxRatio, divider.ratio + delta));
              if (divider.groupId === 'virtual-empty-split') useRightSidebarStore.getState().setWidthFraction(1 - ratio);
              else useRightWorkspaceStore.getState().setRatio(sessionId, divider.groupId, ratio);
            }} />
        ))}
      </div>
    </div>
  );
}
