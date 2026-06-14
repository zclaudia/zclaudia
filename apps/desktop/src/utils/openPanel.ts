import { usePluginStore, getEffectivePlacement } from '../stores/pluginStore';
import { useBottomPanelStore } from '../stores/bottomPanelStore';
import { useRightSidebarStore } from '../stores/rightSidebarStore';
import { useIsMobile, isMobileViewport } from '../hooks/useMediaQuery';

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
 * Activate a panel in its effective placement (bottom or right).
 *
 * Bottom: sets active tab in bottom panel.
 * Right: sets active tab in right sidebar.
 *
 * Does NOT change the panel's `visible` flag — caller is responsible for the
 * panel-specific "open" behavior (e.g. terminal drawer, file viewer state,
 * draft store). This utility only handles the placement routing.
 */
export function activatePanel(panelId: string): void {
  const placement = viewportPlacement(panelId);
  if (placement === 'right') {
    const store = useRightSidebarStore.getState();
    store.setActiveTab(panelId);
    // Opened while the sidebar is collapsed → surface a dot rather than popping it open.
    store.markUnread();
  } else {
    useBottomPanelStore.getState().setActiveTab(panelId);
  }
}

/**
 * Clear active-tab state for a panel that's being closed.
 *
 * Bottom: if this panel was the active tab, reset to empty.
 * Right: if this panel was the active tab, leave activeTab as-is (sidebar
 *        will collapse naturally when no visible right panels remain;
 *        preserving activeTab means the user's preferred tab restores when
 *        they reopen the panel later).
 */
export function deactivatePanel(panelId: string): void {
  const placement = viewportPlacement(panelId);
  if (placement === 'right') {
    // Right sidebar collapses automatically when no visible right panels remain.
    return;
  }
  const { activeTab, setActiveTab } = useBottomPanelStore.getState();
  if (activeTab === panelId) setActiveTab('');
}

/**
 * Reactive hook: is this panel currently shown to the user?
 *
 * "Shown" means: panel.visible !== false AND it is the active tab in its
 * effective container (bottom panel or right sidebar). Use this for trigger
 * button "active" indicators so they correctly reflect what the user sees.
 */
export function usePanelIsActive(panelId: string): boolean {
  const isMobile = useIsMobile();
  const placement = usePluginStore((s) => (isMobile ? 'bottom' : getEffectivePlacement(s, panelId)));
  const isVisible = usePluginStore((s) => {
    const panel = s.panels.find((p) => p.id === panelId);
    return panel ? panel.visible !== false : false;
  });
  const bottomMatches = useBottomPanelStore((s) => s.activeTab === panelId);
  const rightMatches = useRightSidebarStore((s) => s.activeTab === panelId);
  return isVisible && (placement === 'right' ? rightMatches : bottomMatches);
}
