import { Fragment, useState, useRef, useEffect } from 'react';
import { X, Plus } from 'lucide-react';
import { useRightWorkspaceStore, type PaneNode, type ToolRef } from '../../stores/rightWorkspaceStore';
import { usePluginStore } from '../../stores/pluginStore';
import { iconForPanel } from '../rightSidebarToolIcons';
import { closeTabInWorkspace } from '../../utils/workspaceActions';
import { ToolLauncherMenu } from './ToolLauncherMenu';
import { useDragSplitStore } from './dragSplit';
import { MULTI_INSTANCE_PANELS } from '../../stores/panelInstance';

interface PaneTabsProps {
  sessionId: string;
  pane: PaneNode;
  focused: boolean;
  projectId?: string;
}

export function PaneTabs({ sessionId, pane, focused, projectId }: PaneTabsProps) {
  const panels = usePluginStore((s) => s.panels);
  const hoverTabPaneId = useDragSplitStore((s) => s.hoverTabPaneId);
  const hoverTabIndex = useDragSplitStore((s) => s.hoverTabIndex);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const launcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!launcherOpen) return;
    const handler = (e: MouseEvent) => {
      if (launcherRef.current && !launcherRef.current.contains(e.target as Node)) setLauncherOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [launcherOpen]);

  const onActivate = (ref: ToolRef) =>
    useRightWorkspaceStore.getState().setActiveTool(sessionId, pane.id, ref.toolId, ref.instanceKey);

  const onClose = (e: React.MouseEvent, ref: ToolRef) => {
    e.stopPropagation();
    closeTabInWorkspace(sessionId, pane.id, ref.toolId, ref.instanceKey);
  };

  return (
    <div
      data-tab-strip
      data-pane-id={pane.id}
      className={`flex items-stretch gap-0.5 px-1 h-8 border-b border-border flex-shrink-0 select-none overflow-x-auto ${focused ? '' : 'opacity-90'}`}
    >
      {pane.tools.map((ref, index) => {
        const panel = panels.find((p) => p.id === ref.toolId);
        const Icon = iconForPanel(ref.toolId);
        const isActive = ref.toolId === pane.activeToolId && ref.instanceKey === pane.activeInstanceKey;
        const label = panel?.label ?? ref.toolId;
        return (
          <Fragment key={`${ref.toolId}:${ref.instanceKey ?? ''}`}>
            {hoverTabPaneId === pane.id && hoverTabIndex === index && (
              <div className="w-0.5 my-1.5 rounded bg-foreground/60 flex-shrink-0" />
            )}
            <div
              data-tab-index={index}
              data-active={isActive ? 'true' : 'false'}
              onClick={() => onActivate(ref)}
              onPointerDown={(e) => {
                if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) return;
                useDragSplitStore.getState().startDrag({
                  toolId: ref.toolId,
                  instanceKey: ref.instanceKey,
                  multiInstance: MULTI_INSTANCE_PANELS.has(ref.toolId),
                  sourcePaneId: pane.id,
                  sourceIndex: index,
                });
              }}
              className={`group flex items-center gap-1.5 px-2.5 cursor-pointer max-w-[140px] ${
                isActive
                  ? 'text-foreground shadow-[inset_0_-2px_0_hsl(var(--primary))]'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title={label}
            >
              <Icon className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
              <span className="text-xs truncate">{label}</span>
              <button
                aria-label={`Close ${label}`}
                onClick={(e) => onClose(e, ref)}
                onPointerDown={(e) => e.stopPropagation()}
                className="ml-0.5 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-background hover:text-foreground flex-shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </Fragment>
        );
      })}
      {hoverTabPaneId === pane.id && hoverTabIndex === pane.tools.length && (
        <div className="w-0.5 my-1.5 rounded bg-foreground/60 flex-shrink-0" />
      )}

      <div className="relative flex items-center" ref={launcherRef}>
        <button
          aria-label="Add tool"
          title="Add tool"
          onClick={() => {
            useRightWorkspaceStore.getState().focusPane(sessionId, pane.id);
            setLauncherOpen((v) => !v);
          }}
          className="p-1 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground flex-shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        {launcherOpen && (
          <ToolLauncherMenu sessionId={sessionId} projectId={projectId} onPick={() => setLauncherOpen(false)} />
        )}
      </div>

      {/* Trailing empty area: drags the OS window (the strip is now the topmost row). */}
      <div className="flex-1 self-stretch" data-tauri-drag-region />
    </div>
  );
}
