// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { activatePanel, deactivatePanel, isPanelActive, usePanelIsActive } from '../openPanel';
import { usePluginStore } from '../../stores/pluginStore';
import { useBottomPanelStore } from '../../stores/bottomPanelStore';
import { useRightWorkspaceStore } from '../../stores/rightWorkspaceStore';
import { useProjectStore } from '../../stores/projectStore';
import { useServerStore } from '../../stores/serverStore';
import { useRightSidebarStore } from '../../stores/rightSidebarStore';

const SESSION_ID = 'sess-1';
const PROJECT_ID = 'proj-1';
const BACKEND_ID = 'be-1';

function registerPanel(id: string, defaultPlacement?: 'bottom' | 'right', visible = true) {
  usePluginStore.getState().registerPanel({
    id,
    pluginId: `com.test.${id}`,
    type: 'panel',
    label: id,
    defaultPlacement,
    visible,
    order: 0,
  });
}

/** Seed project/server stores so activatePanel right-path has a session context. */
function seedSessionCtx() {
  useProjectStore.setState({
    selectedSessionId: SESSION_ID,
    sessions: [{ id: SESSION_ID, projectId: PROJECT_ID } as any],
  } as any);
  useServerStore.setState({ activeServerId: BACKEND_ID } as any);
}

describe('openPanel utility', () => {
  beforeEach(() => {
    usePluginStore.setState({ panels: [], panelPlacements: {} });
    useBottomPanelStore.setState({ activeTab: '' });
    useRightWorkspaceStore.setState({ bySession: {}, order: [] });
    useRightSidebarStore.setState({ collapsed: false, unread: false });
    // Default: no active session — right-path returns early when sessionId is null
    useProjectStore.setState({ selectedSessionId: null, sessions: [] } as any);
    useServerStore.setState({ activeServerId: null } as any);
  });

  describe('activatePanel', () => {
    it('routes bottom-placed panels to bottomPanelStore', () => {
      registerPanel('foo', 'bottom');
      activatePanel('foo');
      expect(useBottomPanelStore.getState().activeTab).toBe('foo');
      // workspace untouched for bottom path
      expect(useRightWorkspaceStore.getState().bySession[SESSION_ID]).toBeUndefined();
    });

    it('routes right-placed panels into the session workspace on desktop', () => {
      seedSessionCtx();
      registerPanel('foo', 'right');
      activatePanel('foo');
      const ws = useRightWorkspaceStore.getState().bySession[SESSION_ID];
      expect(ws).toBeDefined();
      expect((ws!.root as any)?.activeToolId).toBe('foo');
      // bottom store must remain untouched
      expect(useBottomPanelStore.getState().activeTab).toBe('');
    });

    it('uses user override over defaultPlacement (bottom→right routes to workspace)', () => {
      seedSessionCtx();
      registerPanel('foo', 'bottom');
      usePluginStore.setState({ panelPlacements: { foo: 'right' } });
      activatePanel('foo');
      const ws = useRightWorkspaceStore.getState().bySession[SESSION_ID];
      expect((ws!.root as any)?.activeToolId).toBe('foo');
    });

    it('defaults to right (workspace) when no defaultPlacement is set', () => {
      seedSessionCtx();
      registerPanel('foo');
      activatePanel('foo');
      const ws = useRightWorkspaceStore.getState().bySession[SESSION_ID];
      expect((ws!.root as any)?.activeToolId).toBe('foo');
      expect(useBottomPanelStore.getState().activeTab).toBe('');
    });

    it('is a no-op when there is no selected session (no crash, no workspace entry)', () => {
      // no seedSessionCtx — selectedSessionId remains null
      registerPanel('foo', 'right');
      activatePanel('foo');
      expect(useRightWorkspaceStore.getState().bySession).toEqual({});
    });

    it('routes right-placed panels to the bottom store on mobile', () => {
      const orig = window.matchMedia;
      window.matchMedia = ((query: string) => ({
        matches: true, media: query, onchange: null,
        addEventListener() {}, removeEventListener() {},
        addListener() {}, removeListener() {}, dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
      try {
        registerPanel('foo', 'right');
        activatePanel('foo');
        expect(useBottomPanelStore.getState().activeTab).toBe('foo');
        // workspace must NOT be touched on mobile path
        expect(useRightWorkspaceStore.getState().bySession[SESSION_ID]).toBeUndefined();
      } finally {
        window.matchMedia = orig;
      }
    });

    it('uncollapes the sidebar when opening a right panel (via openToolInWorkspace)', () => {
      seedSessionCtx();
      useRightSidebarStore.setState({ collapsed: true });
      registerPanel('foo', 'right');
      activatePanel('foo');
      // openToolInWorkspace calls setCollapsed(false)
      expect(useRightSidebarStore.getState().collapsed).toBe(false);
    });
  });

  describe('deactivatePanel', () => {
    it('clears bottomPanelStore activeTab when matching', () => {
      registerPanel('foo', 'bottom');
      useBottomPanelStore.setState({ activeTab: 'foo' });
      deactivatePanel('foo');
      expect(useBottomPanelStore.getState().activeTab).toBe('');
    });

    it('does not clear bottomPanelStore activeTab when different', () => {
      registerPanel('foo', 'bottom');
      useBottomPanelStore.setState({ activeTab: 'bar' });
      deactivatePanel('foo');
      expect(useBottomPanelStore.getState().activeTab).toBe('bar');
    });

    it('closes the tool pane in the session workspace for right-placed panels', () => {
      seedSessionCtx();
      registerPanel('foo', 'right');
      // First open it so the workspace has the tool
      activatePanel('foo');
      const wsBefore = useRightWorkspaceStore.getState().bySession[SESSION_ID];
      expect(wsBefore?.root).not.toBeNull();
      // Now deactivate
      deactivatePanel('foo');
      const wsAfter = useRightWorkspaceStore.getState().bySession[SESSION_ID];
      expect(wsAfter?.root).toBeNull();
    });

    it('is a no-op when there is no selected session', () => {
      // no seedSessionCtx — selectedSessionId is null
      registerPanel('foo', 'right');
      // Should not throw
      expect(() => deactivatePanel('foo')).not.toThrow();
    });
  });

  describe('isPanelActive', () => {
    it('uses bottom active tab for bottom-placed panels', () => {
      registerPanel('foo', 'bottom');
      useBottomPanelStore.setState({ activeTab: 'foo' });
      expect(isPanelActive('foo')).toBe(true);
    });

    it('returns false for bottom-placed panel when not active', () => {
      registerPanel('foo', 'bottom');
      useBottomPanelStore.setState({ activeTab: 'bar' });
      expect(isPanelActive('foo')).toBe(false);
    });

    it('uses workspace presence for right-placed panels', () => {
      seedSessionCtx();
      registerPanel('foo', 'right');
      // Not yet in workspace
      expect(isPanelActive('foo')).toBe(false);
      // Open it
      activatePanel('foo');
      expect(isPanelActive('foo')).toBe(true);
    });

    it('returns false for right-placed panel when no session selected', () => {
      registerPanel('foo', 'right');
      // No session → no workspace → false
      expect(isPanelActive('foo')).toBe(false);
    });

    it('returns false when the panel is hidden', () => {
      seedSessionCtx();
      registerPanel('foo', 'right', false);
      activatePanel('foo');
      expect(isPanelActive('foo')).toBe(false);
    });
  });

  describe('usePanelIsActive', () => {
    it('returns false when panel is not registered', () => {
      const { result } = renderHook(() => usePanelIsActive('missing'));
      expect(result.current).toBe(false);
    });

    it('returns true when bottom-placed panel is visible AND active tab', () => {
      registerPanel('foo', 'bottom', true);
      useBottomPanelStore.setState({ activeTab: 'foo' });
      const { result } = renderHook(() => usePanelIsActive('foo'));
      expect(result.current).toBe(true);
    });

    it('returns false when bottom panel is visible but not active tab', () => {
      registerPanel('foo', 'bottom', true);
      useBottomPanelStore.setState({ activeTab: 'bar' });
      const { result } = renderHook(() => usePanelIsActive('foo'));
      expect(result.current).toBe(false);
    });

    it('returns false when bottom panel is active but not visible', () => {
      registerPanel('foo', 'bottom', false);
      useBottomPanelStore.setState({ activeTab: 'foo' });
      const { result } = renderHook(() => usePanelIsActive('foo'));
      expect(result.current).toBe(false);
    });

    it('returns true when right-placed panel is visible AND present in workspace', () => {
      seedSessionCtx();
      registerPanel('foo', 'right', true);
      // Seed workspace with 'foo' in it
      activatePanel('foo');
      const { result } = renderHook(() => usePanelIsActive('foo'));
      expect(result.current).toBe(true);
    });

    it('returns false when right-placed panel is visible but not in workspace', () => {
      seedSessionCtx();
      registerPanel('foo', 'right', true);
      // Workspace is empty — not opened
      const { result } = renderHook(() => usePanelIsActive('foo'));
      expect(result.current).toBe(false);
    });

    it('returns false when right panel is hidden', () => {
      seedSessionCtx();
      registerPanel('foo', 'right', false);
      activatePanel('foo');
      const { result } = renderHook(() => usePanelIsActive('foo'));
      expect(result.current).toBe(false);
    });
  });
});
