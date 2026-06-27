import { useCallback } from 'react';
import { RefreshCw, ExternalLink } from 'lucide-react';
import { useTerminalStore } from '../../stores/terminalStore';
import { usePluginStore } from '../../stores/pluginStore';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useConnection } from '../../contexts/ConnectionContext';
import { useServerStore } from '../../stores/serverStore';
import { XTerminal } from './XTerminal';
import { terminalRegistry } from '../../services/terminal/TerminalRegistry';
import { isDesktopTauri } from '../../utils/platform';
import { openPopoutWindow, buildWindowTitle, getConnectionParams } from '../../utils/popoutWindow';

/** Quick-send keys for mobile toolbar */
const QUICK_KEYS: { label: string; data: string }[] = [
  { label: 'TAB', data: '\t' },
  { label: 'ESC', data: '\x1b' },
  { label: '\u2191', data: '\x1b[A' },   // Up arrow
  { label: '\u2193', data: '\x1b[B' },   // Down arrow
];

interface TerminalPanelProps {
  projectId: string;
  workingDirectory?: string;
}

async function openTerminalInNewWindow(terminalId: string, projectId: string) {
  const backendId = useServerStore.getState().activeServerId;
  const conn = getConnectionParams({ backendId });
  const label = await openPopoutWindow({
    type: 'terminal',
    params: { terminalWindow: terminalId, projectId },
    title: buildWindowTitle('Terminal', conn.serverName, projectId),
    width: 800,
    height: 500,
    connectionTarget: { backendId },
  });

  // Tell the main-window controller it has handed off ownership: dispose its xterm and emit
  // terminal_detach. The pop-out window will issue terminal_attach to claim the PTY.
  terminalRegistry.get(terminalId)?.release();

  // Track popped-out state and hide panel in main window
  useTerminalStore.getState().addPoppedOutTerminal(terminalId, label);
  usePluginStore.getState().updatePanelVisibility('terminal', false);
}

/** Terminal toolbar actions (reload + pop-out buttons) rendered in the shared BottomPanel header */
export function TerminalActions({ projectId }: { projectId: string }) {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const terminalId = useTerminalStore((s) => s.getTerminalId(projectId, activeServerId));
  const isPoppedOut = useTerminalStore((s) => terminalId ? !!s.poppedOutTerminals[terminalId] : false);

  // Match the file viewer's action buttons: roomy, centered, lucide icons. The
  // old hand-rolled SVGs at tight `p-1` made the reload read as oversized/heavy.
  const actionBtn =
    'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground flex-shrink-0';

  return (
    <div className="flex items-center gap-1">
      {/* Reload button — disabled while popped out so the main window can't kill the
          standalone window's PTY (terminal_close has no ownership check on the server). */}
      {!isPoppedOut && (
        <button
          onClick={() => {
            if (!terminalId) return;
            terminalRegistry.get(terminalId)?.close();
            useTerminalStore.getState().closeTerminal(terminalId);
            useTerminalStore.getState().openTerminal(projectId, activeServerId);
          }}
          className={actionBtn}
          title="Reload terminal"
          aria-label="Reload terminal"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}

      {/* Open in new window — kept rightmost to match the file viewer's layout. */}
      {isDesktopTauri() && terminalId && !isPoppedOut && (
        <button
          onClick={() => openTerminalInNewWindow(terminalId, projectId)}
          className={actionBtn}
          title="Open in new window"
          aria-label="Open in new window"
        >
          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Terminal content (renders inside the shared BottomPanel) */
export function TerminalPanel({ projectId, workingDirectory }: TerminalPanelProps) {
  const { ctrlActive, toggleCtrl } = useTerminalStore();
  const isMobile = useIsMobile();
  const activeServerId = useServerStore((s) => s.activeServerId);
  const terminalId = useTerminalStore((s) => s.getTerminalId(projectId, activeServerId));
  const isCtrl = !!(terminalId && ctrlActive[terminalId]);
  const { sendMessage } = useConnection();

  const sendKey = useCallback(
    (data: string) => {
      if (!terminalId) return;
      sendMessage({ type: 'terminal_input', terminalId, data });
    },
    [terminalId, sendMessage],
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Mobile shell helper buttons */}
      {isMobile && terminalId && (
        <div className="flex items-center gap-1 px-2 py-1 border-b border-border flex-shrink-0 overflow-x-auto">
          <button
            onClick={() => toggleCtrl(terminalId)}
            className={`px-2 py-0.5 rounded-md text-[11px] font-mono whitespace-nowrap flex-shrink-0 ${
              isCtrl
                ? 'bg-muted/60 text-foreground'
                : 'bg-secondary text-secondary-foreground'
            }`}
          >
            CTRL
          </button>
          {QUICK_KEYS.map((key) => (
            <button
              key={key.label}
              onClick={() => sendKey(key.data)}
              className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-secondary text-secondary-foreground active:bg-secondary active:text-foreground whitespace-nowrap flex-shrink-0"
            >
              {key.label}
            </button>
          ))}
        </div>
      )}

      {/* Terminal content */}
      <div className="flex-1 overflow-hidden">
        {terminalId ? (
          <XTerminal
            key={terminalId}
            terminalId={terminalId}
            projectId={projectId}
            workingDirectory={workingDirectory}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No terminal session
          </div>
        )}
      </div>
    </div>
  );
}
