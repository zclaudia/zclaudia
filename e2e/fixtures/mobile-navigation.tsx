import React, { useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { useMobileDrawer } from '../../apps/desktop/src/app/useMobileDrawer';
import { useMobileNavigationGesture, type MobileNavigationAdapter } from '../../apps/desktop/src/app/useMobileNavigationGesture';

declare global {
  interface Window {
    mobileNavigation: {
      ready: boolean;
      open(): void;
      close(): void;
      toggleWidth(): void;
      snapshot(): {
        position: number; width: number; x: number; present: boolean; targetOpen: boolean;
        phase: string; modalActive: boolean; claudiaStarts: number; backgroundClicks: number;
        trustedTouchStarts: number;
      };
    };
  }
}

function Fixture() {
  const shell = useRef<HTMLDivElement>(null);
  const drawer = useMobileDrawer({
    isMobile: true, gestureActive: true, isAgentExpanded: false, isFeedOpen: false, isFileViewerFullscreen: false,
  });
  const counters = useRef({ claudiaStarts: 0, backgroundClicks: 0, trustedTouchStarts: 0 });
  const claudia = useRef<MobileNavigationAdapter>({
    getGestureState: () => ({ present: false, targetOpen: false }),
    beginDrag: () => { counters.current.claudiaStarts += 1; return true; },
    updateDrag: () => {}, endDrag: () => {}, cancelDrag: () => {},
  });
  useMobileNavigationGesture({ target: shell, enabled: true, drawer, claudia: claudia.current });
  useLayoutEffect(() => {
    window.mobileNavigation = {
      ready: true, open: () => drawer.setSidebarOpen(true), close: () => drawer.setSidebarOpen(false),
      toggleWidth: drawer.toggleWidth,
      snapshot: () => {
        const panel = drawer.drawerPanelRef.current;
        if (!panel) throw new Error('Drawer fixture panel is not mounted');
        return {
          position: drawer.drawerPosition.get(), width: panel.getBoundingClientRect().width,
          x: panel.getBoundingClientRect().x,
          ...drawer.getGestureState(), modalActive: drawer.sidebarOpen, ...counters.current,
        };
      },
    };
  });
  return <div ref={shell} data-mobile-navigation-shell id="navigation-shell"
    onTouchStart={event => { if (event.isTrusted) counters.current.trustedTouchStarts += 1; }}>
    <main id="content">
      <button id="background-button" onClick={() => { counters.current.backgroundClicks += 1; }}>Content action</button>
      <div id="horizontal-scroll"><div id="wide-content">A horizontally scrolling code example</div></div>
      <div id="long-content">{Array.from({ length: 100 }, (_, index) => <p key={index}>Chat message {index}</p>)}</div>
    </main>
    <div ref={drawer.drawerBackdropRef} id="backdrop" data-mobile-drawer-surface
      onClick={() => drawer.setSidebarOpen(false)} />
    <div ref={drawer.drawerPanelRef} id="drawer" data-mobile-drawer-surface>
      <button id="wide-button" onClick={drawer.toggleWidth}>Toggle reading width</button>
      <button id="close-button" onClick={() => drawer.setSidebarOpen(false)}>Close</button>
      <p>Sidebar content remains mounted.</p>
    </div>
  </div>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Drawer fixture root is missing');
createRoot(root).render(<Fixture />);
