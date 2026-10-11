/**
 * Window Router — detects URL params to render standalone windows
 * (file viewer, automation, workflow editor, session chat, terminal,
 * draft editor, plugin).
 * Falls through to the main AppContent if no standalone param is found.
 */
import { useEffect, type ReactNode } from 'react';
import { initBuiltinPanels } from '../plugins/builtinPanels';
import { WindowShell } from './windows/WindowShell';
import { resolveStandaloneWindowRoute } from './windows/windowRoutes';

/** Main entry component — passed as children when no standalone window is detected. */
export function WindowRouter({ children }: { children: ReactNode }) {
  // Every native window has its own store, including routes that bypass AppContent.
  useEffect(() => {
    initBuiltinPanels();
  }, []);
  const params = new URLSearchParams(window.location.search);
  const standaloneRoute = resolveStandaloneWindowRoute(params);
  if (standaloneRoute) return standaloneRoute.element;

  // Default: main app
  return (
    <WindowShell label="App" connection>
      {children}
    </WindowShell>
  );
}
