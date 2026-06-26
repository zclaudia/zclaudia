import { useState, useRef, useEffect } from 'react';
import { X, Plus } from 'lucide-react';
import { useRightWorkspaceStore, type PaneNode, type ToolRef } from '../../stores/rightWorkspaceStore';
import { usePluginStore } from '../../stores/pluginStore';
import { iconForPanel } from '../rightSidebarToolIcons';
import { closeTabInWorkspace } from '../../utils/workspaceActions';
import { ToolLauncherMenu } from './ToolLauncherMenu';

interface PaneTabsProps {
  sessionId: string;
  pane: PaneNode;
  focused: boolean;
  projectId?: string;
}

export function PaneTabs({ sessionId, pane, focused, projectId }: PaneTabsProps) {
  const panels = usePluginStore((s) => s.panels);
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
          <div
            key={`${ref.toolId}:${ref.instanceKey ?? ''}`}
            data-tab-index={index}
            data-active={isActive ? 'true' : 'false'}
            onClick={() => onActivate(ref)}
            className={`group flex items-center gap-1.5 px-2 my-1 rounded-md cursor-pointer max-w-[140px] ${
              isActive ? 'bg-card text-foreground ring-1 ring-inset ring-border' : 'text-muted-foreground hover:bg-secondary'
            }`}
            title={label}
          >
            <Icon className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
            <span className="text-xs truncate">{label}</span>
            <button
              aria-label={`Close ${label}`}
              onClick={(e) => onClose(e, ref)}
              className="ml-0.5 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-background hover:text-foreground flex-shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}

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
    </div>
  );
}
