/**
 * Builtin Plugin Panels
 *
 * Registers frontend React components for built-in server plugins
 * and core UI panels (Terminal, File Viewer).
 *
 * Called once on app startup so plugin commands that trigger showPanel()
 * have a component ready to render in the bottom panel area.
 */
import { usePluginStore } from '../stores/pluginStore';
import { TerminalPanel, TerminalActions } from '../components/terminal/TerminalPanel';
import { FileViewerPanel, FileViewerActions } from '../components/fileviewer/FileViewerPanel';
import { DraftPanel } from '../components/draft/DraftPanel';
import { DraftActions } from '../components/draft/DraftActions';
import { NotificationsPanel } from '../components/notifications/NotificationsPanel';
import { ChangesPanel } from '../features/changes/ChangesPanel';
import { MemoryPanel } from '../features/memory/MemoryPanel';
import { LineagePanel } from '../features/lineage/LineagePanel';
import { GitSidebarPanel } from '../features/git/components/GitSidebarPanel';
import { useTerminalStore } from '../stores/terminalStore';
import { useFileViewerStore } from '../stores/fileViewerStore';
import { useDraftEditorStore } from '../stores/draftEditorStore';


export function initBuiltinPanels() {
  const { registerPanel } = usePluginStore.getState();

  // --- Core panels ---

  // Terminal: always mounted to preserve xterm WebGL state, visibility toggled by user
  registerPanel({
    id: 'terminal',
    pluginId: 'com.claudia.terminal',
    type: 'panel',
    label: 'Terminal',
    icon: 'Terminal',
    component: TerminalPanel,
    actions: TerminalActions,
    order: 0,
    platforms: ['desktop', 'mobile'],
    defaultPlacement: 'right',
    openMode: 'dedicated',
    alwaysMount: true,
    visible: false,
    onOpen: ({ projectId, backendId }) => {
      // Create a terminal session so a freshly-opened pane is live instead of
      // showing "No terminal session". No-op if one already exists for this scope.
      if (projectId) useTerminalStore.getState().openTerminal(projectId, backendId);
    },
    onClose: () => {
      // Close all open terminal drawers across backend/project scopes.
      const { drawerOpen } = useTerminalStore.getState();
      for (const scopeKey of Object.keys(drawerOpen)) {
        if (!drawerOpen[scopeKey]) continue;
        const separatorIndex = scopeKey.indexOf('::');
        const projectId = separatorIndex >= 0 ? scopeKey.slice(separatorIndex + 2) : scopeKey;
        const backendId = separatorIndex >= 0 ? scopeKey.slice(0, separatorIndex) : undefined;
        useTerminalStore.getState().setDrawerOpen(projectId, false, backendId === 'no-backend' ? null : backendId);
      }
    },
  });

  // File Viewer: dynamically registered/unregistered by fileViewerStore open/close
  // Register here as hidden so it's ready; fileViewerStore.openFile will make it visible
  registerPanel({
    id: 'file-viewer',
    pluginId: 'com.claudia.file-viewer',
    type: 'panel',
    label: 'File',
    icon: 'File',
    component: FileViewerPanel,
    actions: FileViewerActions,
    order: 1,
    platforms: ['desktop', 'mobile'],
    defaultPlacement: 'right',
    openMode: 'shared',
    alwaysMount: false,
    visible: false,
    onClose: () => {
      useFileViewerStore.getState().close();
    },
  });

  // Draft Editor: dynamically shown when a draft is opened, hidden on close
  registerPanel({
    id: 'draft',
    pluginId: 'com.claudia.draft',
    type: 'panel',
    label: 'Draft',
    icon: 'FileEdit',
    component: DraftPanel,
    actions: DraftActions,
    order: 2,
    platforms: ['desktop', 'mobile'],
    defaultPlacement: 'right',
    openMode: 'shared',
    alwaysMount: false,
    visible: false,
    onClose: () => {
      useDraftEditorStore.getState().closeEditor();
    },
  });

  // Changes: per-session view of files modified since a chosen user message
  registerPanel({
    id: 'session-changes',
    pluginId: 'com.claudia.changes',
    type: 'panel',
    label: 'Changes',
    icon: 'FileDiff',
    component: ChangesPanel,
    order: 3,
    platforms: ['desktop', 'mobile'],
    defaultPlacement: 'right',
    openMode: 'shared',
    alwaysMount: false,
    visible: false,
    onClose: () => {
      usePluginStore.getState().updatePanelVisibility('session-changes', false);
    },
  });

  // Memory: read-only view of per-project memory files written by the agent
  registerPanel({
    id: 'memory',
    pluginId: 'com.claudia.memory',
    type: 'panel',
    label: 'Memory',
    icon: 'Brain',
    component: MemoryPanel,
    order: 4,
    platforms: ['desktop', 'mobile'],
    defaultPlacement: 'right',
    openMode: 'shared',
    alwaysMount: false,
    visible: false,
    onClose: () => {
      usePluginStore.getState().updatePanelVisibility('memory', false);
    },
  });

  registerPanel({
    id: 'notifications',
    pluginId: 'com.claudia.notifications',
    type: 'panel',
    label: 'Notifications',
    icon: 'Activity',
    component: NotificationsPanel,
    order: 5,
    platforms: ['desktop', 'mobile'],
    defaultPlacement: 'right',
    openMode: 'dedicated',
    alwaysMount: false,
    visible: false,
    // Opened via the sidebar bell modal, not the workspace launcher.
    hideFromLauncher: true,
    onClose: () => {
      usePluginStore.getState().updatePanelVisibility('notifications', false);
    },
  });

  registerPanel({
    id: 'lineage',
    pluginId: 'com.claudia.lineage',
    type: 'panel',
    label: 'Lineage',
    icon: 'GitFork',
    component: LineagePanel,
    order: 6,
    platforms: ['desktop'],
    defaultPlacement: 'right',
    openMode: 'dedicated',
    alwaysMount: false,
    visible: false,
    onClose: () => {
      usePluginStore.getState().updatePanelVisibility('lineage', false);
    },
  });

  registerPanel({
    id: 'git',
    pluginId: 'com.zclaudia.git',
    type: 'panel',
    label: 'Git',
    icon: 'GitBranch',
    component: GitSidebarPanel,
    order: 7,
    platforms: ['desktop'],
    defaultPlacement: 'right',
    openMode: 'shared',
    alwaysMount: false,
    visible: false,
    onClose: () => {
      usePluginStore.getState().updatePanelVisibility('git', false);
    },
  });

  // Server plugin panels (system-monitor, notes-board, etc.) are registered
  // dynamically via `plugin_panel_registered` messages from the backend.
}
