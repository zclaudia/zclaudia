import { useCallback } from 'react';
import { X } from 'lucide-react';
import { useSplitLayoutStore, findPane, type PaneNode } from '../../stores/splitLayoutStore';
import { usePluginStore, type UIExtension } from '../../stores/pluginStore';
import { PanelContent, PanelActions } from '../panels/PanelRenderer';
import { DropOverlay } from './DropOverlay';

interface PaneViewProps {
  paneId: string;
  focused: boolean;
  /** The active session/project context (used for non-terminal panels). */
  projectId?: string;
  projectRoot?: string;
  workingDirectory?: string;
}

/**
 * Decode a terminal pane's instanceKey (`${backendId}::${projectId}`) into the
 * projectId the TerminalPanel should bind to. Returns undefined for malformed keys.
 */
function decodeTerminalProjectId(instanceKey: string | undefined): string | undefined {
  if (!instanceKey) return undefined;
  const sep = instanceKey.indexOf('::');
  if (sep < 0) return undefined;
  const pid = instanceKey.slice(sep + 2);
  return pid || undefined;
}

export function PaneView({ paneId, focused, projectId, projectRoot, workingDirectory }: PaneViewProps) {
  const root = useSplitLayoutStore((s) => s.root);
  const closePane = useSplitLayoutStore((s) => s.closePane);
  const focusPane = useSplitLayoutStore((s) => s.focusPane);

  const pane = findPane(root, paneId) as PaneNode | null;
  const panels = usePluginStore((s) => s.panels);
  const panel: UIExtension | undefined = pane ? panels.find((p) => p.id === pane.panelId) : undefined;

  const onFocus = useCallback(() => focusPane(paneId), [focusPane, paneId]);
  const onClose = useCallback(() => closePane(paneId), [closePane, paneId]);

  if (!pane || !panel) {
    return (
      <div className="flex-1 min-w-0 min-h-0 flex items-center justify-center text-xs text-muted-foreground">
        Unavailable panel
      </div>
    );
  }

  // Terminal panes resolve their projectId from the scoped instanceKey; other
  // panels use the active session context.
  const effectiveProjectId =
    pane.panelId === 'terminal' ? decodeTerminalProjectId(pane.instanceKey) ?? projectId : projectId;

  return (
    <div
      data-pane-id={paneId}
      data-focused={focused ? 'true' : 'false'}
      onPointerDown={onFocus}
      className={`flex flex-col min-w-0 min-h-0 bg-card ${
        focused ? 'ring-1 ring-inset ring-border' : ''
      }`}
    >
      {/* Compact pane header */}
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

      {/* Panel content */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <PanelContent
          panel={panel}
          projectId={effectiveProjectId}
          projectRoot={projectRoot}
          workingDirectory={workingDirectory}
        />
        {/* Drop overlay shown while a panel drag hovers this pane */}
        <DropOverlay paneId={paneId} />
      </div>
    </div>
  );
}
