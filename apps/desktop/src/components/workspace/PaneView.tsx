import { useCallback } from 'react';
import { X } from 'lucide-react';
import { useRightWorkspaceStore, findPane, activeToolRef, type PaneNode } from '../../stores/rightWorkspaceStore';
import { usePluginStore, type UIExtension } from '../../stores/pluginStore';
import { PanelContent, PanelActions } from '../panels/PanelRenderer';

interface PaneViewProps {
  sessionId: string;
  paneId: string;
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

export function PaneView({ sessionId, paneId, focused, projectId, projectRoot, workingDirectory }: PaneViewProps) {
  const root = useRightWorkspaceStore((s) => s.bySession[sessionId]?.root ?? null);
  const closePane = useRightWorkspaceStore((s) => s.closePane);
  const focusPane = useRightWorkspaceStore((s) => s.focusPane);

  const pane = findPane(root, paneId) as PaneNode | null;
  const panels = usePluginStore((s) => s.panels);
  const ref = pane ? activeToolRef(pane) : null;
  const panel: UIExtension | undefined = ref ? panels.find((p) => p.id === ref.toolId) : undefined;

  const onFocus = useCallback(() => focusPane(sessionId, paneId), [focusPane, sessionId, paneId]);
  const onClose = useCallback(() => closePane(sessionId, paneId), [closePane, sessionId, paneId]);

  if (!pane || !ref || !panel) {
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
      className={`flex flex-col min-w-0 min-h-0 bg-card ${focused ? 'ring-1 ring-inset ring-border' : ''}`}
    >
      <div className="flex items-center gap-1 px-2 h-8 border-b border-border flex-shrink-0 select-none min-w-0">
        <span className="text-xs font-medium text-foreground truncate">{panel.label}</span>
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
      </div>
    </div>
  );
}
