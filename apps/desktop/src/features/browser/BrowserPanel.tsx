import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnection } from '../../contexts/ConnectionContext';
import { useSelectionStore } from '../../stores/selectionStore';
import { isTauri } from '../../utils/platform';
import { useBrowserStore } from './browserStore';
import { BrowserToolbar } from './BrowserToolbar';
import { BrowserViewportView } from './BrowserViewportView';
import { BrowserEngineGate } from './BrowserEngineGate';
import type { BrowserInputEvent } from '@zclaudia/shared';

const RESIZE_DEBOUNCE_MS = 200;

export function BrowserPanel(_props: { projectId?: string; projectRoot?: string; workingDirectory?: string; panelId?: string }) {
  const { sendMessage } = useConnection();
  const sessionId = useSelectionStore((s) => s.selectedSessionId);
  const engine = useBrowserStore((s) => s.engine);
  const view = useBrowserStore((s) => (sessionId ? s.sessions[sessionId] : undefined));
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1024, height: 768 });

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return null;
    return {
      width: Math.max(1, Math.round(el.clientWidth)),
      height: Math.max(1, Math.round(el.clientHeight)),
      dpr: window.devicePixelRatio || 1,
    };
  }, []);

  // Open + attach on mount / session change; detach on unmount.
  useEffect(() => {
    if (!sessionId) return;
    sendMessage({ type: 'browser_open', sessionId });
    const vp = measure() ?? { width: 1024, height: 768, dpr: 1 };
    setViewport({ width: vp.width, height: vp.height });
    sendMessage({ type: 'browser_attach', sessionId, viewport: vp });
    return () => {
      sendMessage({ type: 'browser_detach', sessionId });
    };
  }, [sessionId, sendMessage, measure]);

  // Debounced resize → browser_resize.
  useEffect(() => {
    if (!sessionId || !containerRef.current) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const vp = measure();
        if (vp) {
          setViewport({ width: vp.width, height: vp.height });
          sendMessage({ type: 'browser_resize', sessionId, viewport: vp });
        }
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(containerRef.current);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, [sessionId, sendMessage, measure]);

  const onInput = useCallback(
    (event: BrowserInputEvent) => {
      if (sessionId) sendMessage({ type: 'browser_input', sessionId, event });
    },
    [sessionId, sendMessage]
  );

  const openExternal = useCallback(() => {
    const url = view?.state?.url;
    if (!url) return;
    // Match the codebase's existing plugin-shell convention (see fileDownload.ts,
    // CodexOAuthLoginModal.tsx, ClientLogsSection.tsx): guard with isTauri() and
    // dynamic-import the plugin rather than a top-level import (desktop-only dep).
    if (isTauri()) {
      void import('@tauri-apps/plugin-shell')
        .then(({ open }) => open(url))
        .catch((err) => console.error('[BrowserPanel] Failed to open external browser:', err));
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, [view?.state?.url]);

  const gateNeeded = engine.status === 'missing' || engine.status === 'downloading' || (engine.status === 'error' && !view?.state);

  if (!sessionId) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">No active session</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <BrowserToolbar
        state={view?.state ?? null}
        agentActive={view?.agentActive ?? false}
        onNavigate={(url) => sendMessage({ type: 'browser_navigate', sessionId, url })}
        onHistory={(direction) => sendMessage({ type: 'browser_history', sessionId, direction })}
        onReload={() => sendMessage({ type: 'browser_reload', sessionId })}
        onStop={() => sendMessage({ type: 'browser_stop', sessionId })}
        onOpenExternal={openExternal}
      />
      {view?.error && (
        <div className="px-2 py-1 text-[11px] font-medium text-destructive border-b border-border">{view.error}</div>
      )}
      <div ref={containerRef} className="relative flex-1 min-h-0 overflow-hidden bg-background">
        {gateNeeded ? (
          <BrowserEngineGate engine={engine} onInstall={() => sendMessage({ type: 'browser_engine_install' })} />
        ) : view?.closedReason === 'crash' ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <div className="text-sm text-muted-foreground">Browser page crashed</div>
            <button
              className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90"
              onClick={() => {
                sendMessage({ type: 'browser_open', sessionId });
                const vp = measure();
                if (vp) sendMessage({ type: 'browser_attach', sessionId, viewport: vp });
              }}
            >
              Reopen
            </button>
          </div>
        ) : (
          <BrowserViewportView frame={view?.frame ?? null} viewport={viewport} onInput={onInput} />
        )}
      </div>
    </div>
  );
}
