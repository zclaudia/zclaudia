import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnection } from '../../contexts/ConnectionContext';
import { useSelectionStore } from '../../stores/selectionStore';
import { isTauri } from '../../utils/platform';
import { useBrowserStore } from './browserStore';
import { BrowserToolbar } from './BrowserToolbar';
import { BrowserViewportView } from './BrowserViewportView';
import { BrowserEngineGate } from './BrowserEngineGate';
import { DeviceBar } from './DeviceBar';
import { ConsoleStrip } from './ConsoleStrip';
import { NetworkStrip } from './NetworkStrip';
import { DEFAULT_PRESET_ID, DEVICE_PRESETS, toEmulation } from './devicePresets';
import type { BrowserDeviceEmulation, BrowserInputEvent } from '@zclaudia/shared';

const RESIZE_DEBOUNCE_MS = 200;

export function BrowserPanel(_props: { projectId?: string; projectRoot?: string; workingDirectory?: string; panelId?: string }) {
  const { sendMessage, isConnected } = useConnection();
  const sessionId = useSelectionStore((s) => s.selectedSessionId);
  const engine = useBrowserStore((s) => s.engine);
  const view = useBrowserStore((s) => (sessionId ? s.sessions[sessionId] : undefined));
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1024, height: 768 });
  const emulation = view?.emulation ?? null;
  // Remember the last device so the toolbar toggle is one click both ways.
  const lastPresetRef = useRef(DEFAULT_PRESET_ID);
  useEffect(() => {
    if (emulation) lastPresetRef.current = emulation.presetId;
  }, [emulation]);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return null;
    return {
      width: Math.max(1, Math.round(el.clientWidth)),
      height: Math.max(1, Math.round(el.clientHeight)),
      dpr: window.devicePixelRatio || 1,
    };
  }, []);

  // Open + attach for the current session. Idempotent server-side, so it's safe
  // to call again on reconnect / engine-ready without tearing anything down first.
  const openAndAttach = useCallback(
    (targetSessionId: string) => {
      sendMessage({ type: 'browser_open', sessionId: targetSessionId });
      const vp = measure() ?? { width: 1024, height: 768, dpr: 1 };
      setViewport({ width: vp.width, height: vp.height });
      sendMessage({ type: 'browser_attach', sessionId: targetSessionId, viewport: vp });
    },
    [sendMessage, measure]
  );

  // Open + attach on mount / session change; detach on unmount.
  useEffect(() => {
    if (!sessionId) return;
    openAndAttach(sessionId);
    return () => {
      sendMessage({ type: 'browser_detach', sessionId });
    };
  }, [sessionId, sendMessage, openAndAttach]);

  // Re-open + attach once the engine transitions into 'ready' (e.g. after the
  // download flow completes) — the initial mount-time open no-ops server-side
  // while the engine is missing, so we need to retry once it becomes available.
  const prevEngineStatusRef = useRef(engine.status);
  useEffect(() => {
    const prevStatus = prevEngineStatusRef.current;
    prevEngineStatusRef.current = engine.status;
    if (prevStatus !== 'ready' && engine.status === 'ready' && sessionId) {
      openAndAttach(sessionId);
    }
  }, [engine.status, sessionId, openAndAttach]);

  // Re-open + attach after a WS reconnect: the server-side session/attachment
  // state is gone from this client's perspective once the socket drops.
  const prevConnectedRef = useRef(isConnected);
  useEffect(() => {
    const prevConnected = prevConnectedRef.current;
    prevConnectedRef.current = isConnected;
    if (!prevConnected && isConnected && sessionId) {
      openAndAttach(sessionId);
    }
  }, [isConnected, sessionId, openAndAttach]);

  // Debounced resize → browser_resize. While device emulation is active the
  // logical viewport is pinned by the preset, so panel resizes are not sent
  // (the server ignores them too); checked at fire time via getState() so the
  // observer doesn't resubscribe on every emulation change.
  useEffect(() => {
    if (!sessionId || !containerRef.current) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const vp = measure();
        const emulated = useBrowserStore.getState().sessions[sessionId]?.emulation != null;
        if (vp && !emulated) {
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

  const applyEmulation = useCallback(
    (emu: BrowserDeviceEmulation | null) => {
      if (!sessionId) return;
      const vp = measure() ?? { width: 1024, height: 768, dpr: 1 };
      sendMessage({ type: 'browser_set_emulation', sessionId, emulation: emu, viewport: vp });
    },
    [sessionId, sendMessage, measure]
  );

  const pickActive = view?.pickActive ?? false;
  const setPick = useCallback(
    (active: boolean) => {
      if (!sessionId) return;
      useBrowserStore.getState().patchSession(sessionId, { pickActive: active });
      sendMessage({ type: 'browser_pick_element', sessionId, active });
    },
    [sessionId, sendMessage]
  );

  const toggleEmulation = useCallback(() => {
    if (emulation) {
      applyEmulation(null);
    } else {
      const preset = DEVICE_PRESETS.find((p) => p.id === lastPresetRef.current) ?? DEVICE_PRESETS[0];
      applyEmulation(toEmulation(preset));
    }
  }, [emulation, applyEmulation]);

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
        emulationActive={emulation !== null}
        onNavigate={(url) => sendMessage({ type: 'browser_navigate', sessionId, url })}
        onHistory={(direction) => sendMessage({ type: 'browser_history', sessionId, direction })}
        onReload={() => sendMessage({ type: 'browser_reload', sessionId })}
        onStop={() => sendMessage({ type: 'browser_stop', sessionId })}
        pickActive={pickActive}
        onToggleEmulation={toggleEmulation}
        onTogglePick={() => setPick(!pickActive)}
        onOpenExternal={openExternal}
      />
      {emulation && <DeviceBar emulation={emulation} onChange={applyEmulation} />}
      {view?.error && (
        <div className="px-2 py-1 text-[11px] font-medium text-destructive border-b border-border">{view.error}</div>
      )}
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 overflow-hidden bg-background"
        onKeyDownCapture={(e) => {
          // Escape cancels element-pick mode before the canvas forwards it to the page.
          if (pickActive && e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setPick(false);
          }
        }}
      >
        {gateNeeded ? (
          <BrowserEngineGate engine={engine} onInstall={() => sendMessage({ type: 'browser_engine_install' })} />
        ) : view?.closedReason === 'crash' ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <div className="text-sm text-muted-foreground">Browser page crashed</div>
            <button
              className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90"
              onClick={() => openAndAttach(sessionId)}
            >
              Reopen
            </button>
          </div>
        ) : (
          <BrowserViewportView
            frame={view?.frame ?? null}
            viewport={emulation ? { width: emulation.width, height: emulation.height } : viewport}
            onInput={onInput}
          />
        )}
      </div>
      {!gateNeeded && <NetworkStrip entries={view?.network ?? []} />}
      {!gateNeeded && <ConsoleStrip entries={view?.console ?? []} />}
    </div>
  );
}
