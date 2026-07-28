import { usePluginStore, getEffectivePlacement } from '../stores/pluginStore';
import { useBottomPanelStore } from '../stores/bottomPanelStore';
import { useIsMobile, isMobileViewport } from '../hooks/useMediaQuery';
import { useProjectStore } from '../stores/projectStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useServerStore } from '../stores/serverStore';
import { useRightWorkspaceStore, findPaneWithTool } from '../stores/rightWorkspaceStore';
import { openToolInWorkspace, closeToolInWorkspace } from './workspaceActions';

/**
 * Effective placement, viewport-aware: mobile renders every panel through the
 * BottomPanel overlay regardless of desktop placement (see usePanelRegion), so
 * tab routing must target the bottom store on mobile.
 */
function viewportPlacement(panelId: string): 'bottom' | 'right' {
  if (isMobileViewport()) return 'bottom';
  return getEffectivePlacement(usePluginStore.getState(), panelId);
}

/**
 * Resolve current session context for workspace routing.
 */
function currentSessionCtx() {
  const { selectedSessionId } = useSelectionStore.getState();
  const { sessions } = useProjectStore.getState();
  const session = selectedSessionId ? sessions.find(s => s.id === selectedSessionId) : undefined;
  return {
    sessionId: selectedSessionId,
    projectId: session?.projectId,
    backendId: useServerStore.getState().activeServerId,
  };
}

/**
 * Activate a panel in its effective placement (bottom or right).
 *
 * Bottom (mobile): sets active tab in bottom panel.
 * Right (desktop): opens the tool in the session workspace (rightWorkspaceStore).
 *
 * Does NOT change the panel's `visible` flag — caller is responsible for the
 * panel-specific "open" behavior (e.g. terminal drawer, file viewer state,
 * draft store). This utility only handles the placement routing.
 */
export function activatePanel(panelId: string): void {
  const placement = viewportPlacement(panelId);
  if (placement === 'right') {
    const ctx = currentSessionCtx();
    if (!ctx.sessionId) return;
    openToolInWorkspace(ctx.sessionId, panelId, {
      projectId: ctx.projectId,
      backendId: ctx.backendId,
    });
  } else {
    useBottomPanelStore.getState().setActiveTab(panelId);
  }
}

/**
 * Non-reactive check: is this panel registered and usable on the current
 * platform/surface (desktop vs. mobile) and not disabled? This does NOT
 * reflect whether the panel is currently shown — use isPanelActive() for
 * that. Intended for event handlers that need to decide whether opening a
 * panel is even possible before doing so (e.g. ChatLink deciding whether to
 * intercept a click before the browser panel exists on this platform).
 */
export function isPanelAvailable(panelId: string): boolean {
  const pluginState = usePluginStore.getState();
  const panel = pluginState.panels.find(p => p.id === panelId);
  if (!panel) return false;

  const platform = isMobileViewport() ? 'mobile' : 'desktop';
  if (!(panel.platforms ?? ['desktop']).includes(platform)) return false;
  if (pluginState.disabledBuiltinPanels.includes(panelId)) return false;
  return true;
}

/**
 * Non-reactive check for event handlers and stores that need the same
 * placement-aware active-tab semantics as usePanelIsActive().
 */
export function isPanelActive(panelId: string): boolean {
  if (!isPanelAvailable(panelId)) return false;
  const pluginState = usePluginStore.getState();
  const panel = pluginState.panels.find(p => p.id === panelId);
  if (!panel || panel.visible === false) return false;

  const placement = viewportPlacement(panelId);
  if (placement === 'right') {
    const sid = useSelectionStore.getState().selectedSessionId;
    if (!sid) return false;
    const root = useRightWorkspaceStore.getState().bySession[sid]?.root ?? null;
    return findPaneWithTool(root, panelId, undefined, true) !== null;
  }
  return useBottomPanelStore.getState().activeTab === panelId;
}

/**
 * Close a panel in its effective placement.
 *
 * Bottom (mobile): if this panel was the active tab, reset to empty.
 * Right (desktop): close the tool's pane in the session workspace.
 */
export function deactivatePanel(panelId: string): void {
  const placement = viewportPlacement(panelId);
  if (placement === 'right') {
    const ctx = currentSessionCtx();
    if (ctx.sessionId) closeToolInWorkspace(ctx.sessionId, panelId);
    return;
  }
  const { activeTab, setActiveTab } = useBottomPanelStore.getState();
  if (activeTab === panelId) setActiveTab('');
}

/**
 * Reactive hook: is this panel currently shown to the user?
 *
 * "Shown" means: panel.visible !== false AND the tool is present in the current
 * session's workspace (right) or is the active tab (bottom). Use this for trigger
 * button "active" indicators so they correctly reflect what the user sees.
 */
export function usePanelIsActive(panelId: string): boolean {
  const isMobile = useIsMobile();
  const placement = usePluginStore(s => (isMobile ? 'bottom' : getEffectivePlacement(s, panelId)));
  const isVisible = usePluginStore(s => {
    const panel = s.panels.find(p => p.id === panelId);
    return panel ? panel.visible !== false : false;
  });
  const bottomMatches = useBottomPanelStore(s => s.activeTab === panelId);
  const sid = useSelectionStore(s => s.selectedSessionId);
  const rightMatches = useRightWorkspaceStore(s => {
    const root = sid ? (s.bySession[sid]?.root ?? null) : null;
    return findPaneWithTool(root, panelId, undefined, true) !== null;
  });
  return isVisible && (placement === 'right' ? rightMatches : bottomMatches);
}
