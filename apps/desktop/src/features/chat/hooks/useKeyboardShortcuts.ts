import { useEffect } from 'react';
import { useTerminalStore } from '../../../stores/terminalStore';
import { useFileViewerStore } from '../../../stores/fileViewerStore';
import { usePluginStore } from '../../../stores/pluginStore';
import { activatePanel, isPanelActive } from '../../../actions/openPanel';

interface UseKeyboardShortcutsOptions {
  projectId: string | undefined;
  projectRoot: string | undefined;
  /** Explicit pane context; omitted by legacy callers. */
  sessionId?: string;
  backendId?: string | null;
  enabled?: boolean;
}

export function useKeyboardShortcuts({ projectId, projectRoot, sessionId, backendId, enabled = true }: UseKeyboardShortcutsOptions) {
  // Ctrl+` keyboard shortcut to toggle terminal
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (
        e.ctrlKey &&
        e.key === '`' &&
        projectId &&
        !usePluginStore.getState().disabledBuiltinPanels.includes('terminal')
      ) {
        e.preventDefault();
        const store = useTerminalStore.getState();
        const context = sessionId !== undefined || backendId !== undefined ? { sessionId, projectId, backendId } : undefined;
        if (store.isDrawerOpen(projectId, backendId) && isPanelActive('terminal', context)) {
          store.setDrawerOpen(projectId, false, backendId);
        } else if (store.isDrawerOpen(projectId, backendId)) {
          activatePanel('terminal', context);
        } else {
          if (!store.getTerminalId(projectId, backendId)) {
            store.openTerminal(projectId, backendId);
          }
          store.setDrawerOpen(projectId, true, backendId);
          activatePanel('terminal', context);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [projectId, sessionId, backendId, enabled]);

  // Cmd+P / Ctrl+P keyboard shortcut to open file search
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key === 'p' &&
        projectRoot &&
        !usePluginStore.getState().disabledBuiltinPanels.includes('file-viewer')
      ) {
        e.preventDefault();
        const store = useFileViewerStore.getState();
        store.openSearch(projectRoot, backendId);
        const context = sessionId !== undefined || backendId !== undefined ? { sessionId, projectId, backendId } : undefined;
        activatePanel('file-viewer', context);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [projectRoot, projectId, sessionId, backendId, enabled]);
}
