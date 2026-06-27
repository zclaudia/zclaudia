import { useCallback } from 'react';
import { useRightWorkspaceStore, activeToolRef, type PaneNode } from '../../stores/rightWorkspaceStore';
import { usePluginStore, type UIExtension } from '../../stores/pluginStore';
import { PanelContent } from '../panels/PanelRenderer';
import { DropOverlay } from './DropOverlay';
import { PaneTabs } from './PaneTabs';

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

  const ref = activeToolRef(pane);
  const panel: UIExtension | undefined = ref ? panels.find((p) => p.id === ref.toolId) : undefined;

  if (!panel || !ref) {
    return (
      <div className="flex-1 min-w-0 min-h-0 flex items-center justify-center text-xs text-muted-foreground">
        Unavailable panel
      </div>
    );
  }

  const effectiveProjectId =
    ref.toolId === 'terminal' ? decodeTerminalProjectId(ref.instanceKey) ?? projectId : projectId;

  return (
    <div
      data-pane-id={paneId}
      data-focused={focused ? 'true' : 'false'}
      onPointerDown={onFocus}
      className={`flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden rounded-lg border bg-card transition-shadow ${
        focused
          ? 'border-primary/30 ring-1 ring-primary/30 shadow-md'
          : 'border-border shadow-sm'
      }`}
    >
      <PaneTabs sessionId={sessionId} pane={pane} focused={focused} projectId={effectiveProjectId} />
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <PanelContent panel={panel} projectId={effectiveProjectId} projectRoot={projectRoot} workingDirectory={workingDirectory} />
        <DropOverlay paneId={paneId} />
      </div>
    </div>
  );
}
