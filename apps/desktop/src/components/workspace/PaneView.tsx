import { useCallback } from 'react';
import { X } from 'lucide-react';
import { useRightWorkspaceStore, activeToolRef, type PaneNode } from '../../stores/rightWorkspaceStore';
import { usePluginStore, type UIExtension } from '../../stores/pluginStore';
import { PanelContent, PanelActions } from '../panels/PanelRenderer';
import { useDragSplitStore } from './dragSplit';
import { DropOverlay } from './DropOverlay';
import { MULTI_INSTANCE_PANELS } from '../../stores/panelInstance';

interface PaneViewProps {
  sessionId: string;
  paneId: string;
  pane: PaneNode;
  focused: boolean;
  projectId?: string;
  projectRoot?: string;
  workingDirectory?: string;
}

/** Decode a terminal pane's instanceKey (`${backendId}::${projectId}`) into projectId. */
function decodeTerminalProjectId(instanceKey: string | undefined): string | undefined {
  if (!instanceKey) return undefined;
  const sep = instanceKey.indexOf('::');
  if (sep < 0) return undefined;
  return instanceKey.slice(sep + 2) || undefined;
}

export function PaneView({ sessionId, paneId, pane, focused, projectId, projectRoot, workingDirectory }: PaneViewProps) {
  const panels = usePluginStore((s) => s.panels);

  const onFocus = useCallback(
    () => useRightWorkspaceStore.getState().focusPane(sessionId, paneId),
    [sessionId, paneId],
  );
  const onClose = useCallback(
    () => useRightWorkspaceStore.getState().closePane(sessionId, paneId),
    [sessionId, paneId],
  );

  const ref = activeToolRef(pane);
  const panel: UIExtension | undefined = ref ? panels.find((p) => p.id === ref.toolId) : undefined;

  if (!panel || !ref) {
    return (
      <div className="flex-1 min-w-0 min-h-0 flex items-center justify-center text-xs text-muted-foreground">
        Unavailable panel
      </div>
    );
  }

  const onDragHandlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) return;
    e.stopPropagation();
    useDragSplitStore.getState().startDrag({
      toolId: ref.toolId,
      instanceKey: ref.instanceKey,
      multiInstance: MULTI_INSTANCE_PANELS.has(ref.toolId),
    });
  };

  const effectiveProjectId =
    ref.toolId === 'terminal' ? decodeTerminalProjectId(ref.instanceKey) ?? projectId : projectId;

  return (
    <div
      data-pane-id={paneId}
      data-focused={focused ? 'true' : 'false'}
      onPointerDown={onFocus}
      className={`flex flex-col min-w-0 min-h-0 bg-card ${focused ? 'ring-1 ring-inset ring-border' : ''}`}
    >
      <div className="flex items-center gap-1 px-2 h-8 border-b border-border flex-shrink-0 select-none min-w-0">
        <span
          className="text-xs font-medium text-foreground truncate cursor-grab active:cursor-grabbing"
          title={`Drag ${panel.label} to split`}
          onPointerDown={onDragHandlePointerDown}
        >
          {panel.label}
        </span>
        <div className="flex-1" />
        <PanelActions panel={panel} projectId={effectiveProjectId} />
        <button
          onClick={onClose}
          title="Close pane"
          className="p-1 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <PanelContent panel={panel} projectId={effectiveProjectId} projectRoot={projectRoot} workingDirectory={workingDirectory} />
        <DropOverlay paneId={paneId} />
      </div>
    </div>
  );
}
