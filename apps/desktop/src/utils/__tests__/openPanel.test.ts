// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { activatePanel, deactivatePanel, isPanelActive, usePanelIsActive } from '../openPanel';
import { usePluginStore } from '../../stores/pluginStore';
import { useBottomPanelStore } from '../../stores/bottomPanelStore';
import { useRightSidebarStore } from '../../stores/rightSidebarStore';

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

describe('openPanel utility', () => {
  beforeEach(() => {
    usePluginStore.setState({ panels: [], panelPlacements: {} });
    useBottomPanelStore.setState({ activeTab: '' });
    useRightSidebarStore.setState({ activeTab: null, widthFraction: 0.26, collapsed: false, unread: false });
  });

  describe('activatePanel', () => {
    it('routes bottom-placed panels to bottomPanelStore', () => {
      registerPanel('foo', 'bottom');
      activatePanel('foo');
      expect(useBottomPanelStore.getState().activeTab).toBe('foo');
      expect(useRightSidebarStore.getState().activeTab).toBeNull();
    });

    it('routes right-placed panels to rightSidebarStore', () => {
      registerPanel('foo', 'right');
      activatePanel('foo');
      expect(useRightSidebarStore.getState().activeTab).toBe('foo');
      expect(useBottomPanelStore.getState().activeTab).toBe('');
    });

    it('uses user override over defaultPlacement', () => {
      registerPanel('foo', 'bottom');
      usePluginStore.setState({ panelPlacements: { foo: 'right' } });
      activatePanel('foo');
      expect(useRightSidebarStore.getState().activeTab).toBe('foo');
    });

    it('defaults to bottom when no defaultPlacement is set', () => {
      registerPanel('foo');
      activatePanel('foo');
      expect(useBottomPanelStore.getState().activeTab).toBe('foo');
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
        expect(useRightSidebarStore.getState().activeTab).toBeNull();
      } finally {
        window.matchMedia = orig;
      }
    });

    it('marks the sidebar unread when activating a right panel while collapsed', () => {
      useRightSidebarStore.setState({ collapsed: true });
      registerPanel('foo', 'right');
      activatePanel('foo');
      expect(useRightSidebarStore.getState().unread).toBe(true);
    });

    it('does not mark unread when the sidebar is expanded', () => {
      registerPanel('foo', 'right');
      activatePanel('foo');
      expect(useRightSidebarStore.getState().unread).toBe(false);
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

    it('preserves rightSidebar activeTab even when deactivating', () => {
      registerPanel('foo', 'right');
      useRightSidebarStore.setState({ activeTab: 'foo' });
      deactivatePanel('foo');
      // rightSidebar collapses naturally via panel visibility, activeTab preserved
      expect(useRightSidebarStore.getState().activeTab).toBe('foo');
    });
  });

  describe('isPanelActive', () => {
    it('uses bottom active tab for bottom-placed panels', () => {
      registerPanel('foo', 'bottom');
      useBottomPanelStore.setState({ activeTab: 'foo' });
      expect(isPanelActive('foo')).toBe(true);
    });

    it('uses right sidebar active tab for right-placed panels', () => {
      registerPanel('foo', 'right');
      useRightSidebarStore.setState({ activeTab: 'foo' });
      expect(isPanelActive('foo')).toBe(true);
      expect(useBottomPanelStore.getState().activeTab).toBe('');
    });

    it('returns false when the panel is hidden', () => {
      registerPanel('foo', 'right', false);
      useRightSidebarStore.setState({ activeTab: 'foo' });
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

    it('returns true when right-placed panel is visible AND active in sidebar', () => {
      registerPanel('foo', 'right', true);
      useRightSidebarStore.setState({ activeTab: 'foo' });
      const { result } = renderHook(() => usePanelIsActive('foo'));
      expect(result.current).toBe(true);
    });

    it('returns false when right panel is hidden', () => {
      registerPanel('foo', 'right', false);
      useRightSidebarStore.setState({ activeTab: 'foo' });
      const { result } = renderHook(() => usePanelIsActive('foo'));
      expect(result.current).toBe(false);
    });
  });
});
