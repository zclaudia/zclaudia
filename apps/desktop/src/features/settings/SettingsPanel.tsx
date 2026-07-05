import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { useServerStore } from '../../stores/serverStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useGatewayStore } from '../../stores/gatewayStore';
import { useConnection } from '../../contexts/ConnectionContext';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useAndroidBack } from '../../hooks/useAndroidBack';
import { useSidebarWidthStore, SIDEBAR_WIDTH_LIMITS } from '../../stores/sidebarWidthStore';
import { LlmProfileManager } from './LlmProfileManager';
import { ServerGatewayConfig } from './ServerGatewayConfig';
import { PluginSettings } from './PluginSettings';
import { usePluginStore, selectPluginSettingsTabs } from '../../stores/pluginStore';
import type { BackendConnectionState, BackendSnapshot, GatewayBackendInfo } from '@zclaudia/shared';
import { AgentSettings } from './AgentSettings';
import { PermissionSettings } from './PermissionSettings';
import { NotificationSettingsInline } from './NotificationSettings';
import { MobileGatewayConfig } from './MobileGatewayConfig';
import { DebugSettings } from './DebugSettings';
import { GeneralSettings } from './GeneralSettings';
import { WebSearchSettings } from './WebSearchSettings';
import {
  type SettingsTab,
  type SettingsTabDef,
  getAppTabs,
  getServerTabs,
} from './settingsTabDefs';

import {
  getMobileBackendViewState,
  getVisibleMobileBackends,
  isMobileBackendUsable,
  type MobileBackendViewState,
} from '../../services/mobileConnectionState';

function getViewStateLabel(viewState: MobileBackendViewState): string | null {
  switch (viewState) {
    case 'transport_reconnecting':
      return 'Reconnecting';
    case 'backend_subscribing':
      return 'Connecting';
    case 'backend_visible':
      return 'Idle';
    case 'error':
      return 'Error';
    case 'offline':
      return 'Offline';
    default:
      return null;
  }
}

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
}

export function SettingsPanel({ isOpen, onClose, initialTab }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? 'general');
  const [serverPickerOpen, setServerPickerOpen] = useState(false);
  const [mobileShowContent, setMobileShowContent] = useState(false);
  const [navQuery, setNavQuery] = useState('');
  const isMobile = useIsMobile();
  const pluginSettingsTabs = usePluginStore(selectPluginSettingsTabs);

  const activeServerId = useServerStore(s => s.activeServerId);
  const setActiveServer = useServerStore(s => s.setActiveServer);
  const { isConnected: isGatewayConnected, showLocalBackend } = useGatewayStore();
  const { sendMessage, connectServer, embeddedServerStatus, embeddedServerPort } = useConnection();

  const facadeBackends = useFacadeStore(s => s.backends);
  const facadeConnectionState = useFacadeStore(s => s.connectionState);
  const localBackendId = useFacadeStore(s => s.localBackendId);
  const currentInstanceId = useFacadeStore(s => s.currentInstanceId);
  const activeServer = facadeBackends.find(b => b.backendId === activeServerId) ?? null;
  const isConnected = isMobileBackendUsable({
    backendId: activeServerId,
    connectionState: facadeConnectionState,
    backends: facadeBackends,
  });
  const isActiveLocalBackend =
    !!activeServerId &&
    (activeServerId === localBackendId || activeServer?.isThisInstance === true);

  const isActiveRemote = !!activeServerId && !!localBackendId && activeServerId !== localBackendId;
  const effectiveShowLocal = showLocalBackend || isActiveRemote;
  const visibleGatewayBackends = getVisibleMobileBackends(
    facadeBackends,
    currentInstanceId,
    effectiveShowLocal
  );

  const appTabs = getAppTabs(!!isMobile);
  const serverTabs = getServerTabs({ isActiveLocalBackend, pluginSettingsTabs });
  const sidebarWidth = useSidebarWidthStore(s => s.widthPx);
  const setSidebarWidth = useSidebarWidthStore(s => s.setWidth);
  const resizeDragging = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  const navQ = navQuery.trim().toLowerCase();
  const filterTabs = (tabs: SettingsTabDef[]) =>
    navQ ? tabs.filter(t => t.label.toLowerCase().includes(navQ)) : tabs;
  const visibleAppTabs = filterTabs(appTabs);
  const visibleServerTabs = filterTabs(serverTabs);

  useEffect(() => {
    if (isOpen && initialTab) setActiveTab(initialTab);
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isActiveLocalBackend && !isMobile && activeTab === 'gateway') {
      setActiveTab('agent');
    }
  }, [activeTab, isActiveLocalBackend, isMobile]);

  const handleBackendSwitch = (backend: GatewayBackendInfo) => {
    const viewState = getMobileBackendViewState(
      backend.backendId,
      facadeConnectionState,
      facadeBackends
    );
    if (viewState === 'offline') return;
    setActiveServer(backend.backendId);
    connectServer(backend.backendId);
    setServerPickerOpen(false);
  };

  const handleSwipeBack = useCallback(() => {
    if (mobileShowContent) {
      setMobileShowContent(false);
    } else {
      onClose();
    }
  }, [mobileShowContent, onClose]);

  useAndroidBack(handleSwipeBack, isMobile && isOpen, mobileShowContent ? 30 : 20);

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  const onResizeStart = useCallback(
    (e: ReactMouseEvent | ReactTouchEvent) => {
      e.preventDefault();
      resizeDragging.current = true;
      resizeStartX.current = 'touches' in e ? e.touches[0].clientX : e.clientX;
      resizeStartWidth.current = useSidebarWidthStore.getState().widthPx;

      const onMove = (ev: MouseEvent | TouchEvent) => {
        if (!resizeDragging.current) return;
        const clientX = 'touches' in ev ? ev.touches[0].clientX : ev.clientX;
        setSidebarWidth(resizeStartWidth.current + (clientX - resizeStartX.current));
      };

      const cleanup = () => {
        resizeDragging.current = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        resizeCleanupRef.current = null;
      };

      const onUp = () => cleanup();
      resizeCleanupRef.current = cleanup;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove);
      document.addEventListener('touchend', onUp);
    },
    [setSidebarWidth]
  );

  if (!isOpen) return null;

  const clampedSettingsSidebarWidth = Math.max(
    SIDEBAR_WIDTH_LIMITS.MIN_WIDTH_PX,
    Math.min(
      (typeof window !== 'undefined' ? window.innerWidth : 1920) *
        (SIDEBAR_WIDTH_LIMITS.MAX_WIDTH_VW / 100),
      sidebarWidth
    )
  );

  const renderTabButton = (tab: SettingsTabDef) => (
    <button
      key={tab.id}
      onClick={() => setActiveTab(tab.id)}
      data-testid={`${tab.id}-tab`}
      className={`flex-shrink-0 px-3 py-2.5 rounded-md text-sm flex items-center gap-2.5 transition-colors ${
        activeTab === tab.id
          ? 'bg-muted/60 text-foreground'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
      }`}
    >
      {tab.icon}
      <span className="whitespace-nowrap">{tab.label}</span>
    </button>
  );

  const renderMobileTabItem = (tab: SettingsTabDef) => (
    <button
      key={tab.id}
      onClick={() => {
        setActiveTab(tab.id);
        setMobileShowContent(true);
      }}
      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-secondary/50 active:bg-secondary transition-colors"
    >
      <span className="text-muted-foreground">{tab.icon}</span>
      <span className="flex-1 text-sm text-left">{tab.label}</span>
      <svg
        className="w-4 h-4 text-muted-foreground"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );

  return (
    <div
      data-testid="settings-panel"
      className={`relative bg-card flex flex-col w-full h-full min-h-0 ${
        isMobile ? 'safe-top-pad safe-bottom-pad' : ''
      }`}
    >
      {/* Mobile header */}
      {isMobile && (
        <div className="flex items-center justify-between px-3 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (mobileShowContent) {
                  setMobileShowContent(false);
                } else {
                  onClose();
                }
              }}
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <h2 className="text-lg font-semibold">
              {mobileShowContent
                ? [...appTabs, ...serverTabs].find(t => t.id === activeTab)?.label || 'Settings'
                : 'Settings'}
            </h2>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* Mobile: Tab list */}
        {isMobile && !mobileShowContent && (
          <div className="flex-1 overflow-y-auto p-2">
            <div className="px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              App
            </div>
            {appTabs.map(renderMobileTabItem)}

            <div className="px-3 py-2 mt-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-t border-border">
              {activeServer?.name || 'Server'}
            </div>
            {serverTabs.map(renderMobileTabItem)}
          </div>
        )}

        {/* Desktop: Tabs vertical sidebar */}
        {!isMobile && (
          <div
            data-testid="settings-sidebar"
            className="relative flex flex-col border-r border-border bg-[hsl(var(--sidebar))] shrink-0"
            style={{ width: clampedSettingsSidebarWidth }}
          >
            <div
              data-testid="settings-sidebar-resize-handle"
              className="absolute top-0 right-0 z-20 h-full w-1 cursor-ew-resize hover:bg-muted"
              onMouseDown={onResizeStart}
              onTouchStart={onResizeStart}
              aria-hidden
            />
            <div className="flex h-full flex-col px-3 pb-3 gap-0.5 overflow-y-auto">
              <div className="h-9 -mx-3 flex-shrink-0" data-tauri-drag-region />
              <button
                onClick={onClose}
                className="flex items-center gap-1.5 mt-1 mb-2 px-3 py-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
                <span className="text-sm">Back to app</span>
              </button>
              <div className="relative mb-2">
                <svg
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z"
                  />
                </svg>
                <input
                  type="text"
                  value={navQuery}
                  onChange={e => setNavQuery(e.target.value)}
                  placeholder="Search settings…"
                  className="w-full pl-8 pr-2 py-1.5 text-sm bg-secondary/50 rounded-md placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-border"
                />
              </div>

              {visibleAppTabs.length > 0 && (
                <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  App
                </div>
              )}
              {visibleAppTabs.map(renderTabButton)}

              {visibleServerTabs.length > 0 && (
                <div className="relative border-t border-border mt-2">
                  <button
                    onClick={() => setServerPickerOpen(!serverPickerOpen)}
                    className="w-full px-3 pt-3 pb-1.5 flex items-center justify-between group"
                  >
                    <span
                      className="text-xs font-semibold text-muted-foreground uppercase tracking-wider truncate"
                      title={activeServer?.name || 'Server'}
                    >
                      {activeServer?.name || 'Server'}
                    </span>
                    <svg
                      className={`w-3 h-3 text-muted-foreground group-hover:text-foreground transition-transform ${serverPickerOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>

                  {serverPickerOpen && (
                    <ServerPickerDropdown
                      isGatewayConnected={isGatewayConnected}
                      visibleGatewayBackends={visibleGatewayBackends}
                      activeServerId={activeServerId}
                      facadeConnectionState={facadeConnectionState}
                      facadeBackends={facadeBackends}
                      onClose={() => setServerPickerOpen(false)}
                      onSwitch={handleBackendSwitch}
                    />
                  )}
                </div>
              )}

              {visibleServerTabs.map(renderTabButton)}
            </div>
          </div>
        )}

        {/* Content area */}
        {(!isMobile || mobileShowContent) && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {!isMobile && <div className="h-9 flex-shrink-0" data-tauri-drag-region />}
            <div className="flex-1 overflow-y-auto">
              <div className={isMobile ? 'p-3' : 'max-w-[640px] mx-auto px-8 pt-2 pb-10'}>
                {activeTab === 'general' && (
                  <GeneralSettings
                    isOpen={isOpen}
                    activeServerExists={!!activeServer}
                    embeddedServerPort={embeddedServerPort}
                  />
                )}

                {activeTab === 'agent' && <AgentSettings />}
                {activeTab === 'permissions' && <PermissionSettings />}

                {activeTab === 'providers' && (
                  <div className="space-y-4">
                    {!isActiveLocalBackend && activeServer && (
                      <RemoteServerBanner
                        serverName={activeServer.name}
                        label="Viewing providers"
                      />
                    )}
                    <p className="text-sm text-muted-foreground">
                      {isActiveLocalBackend
                        ? 'Manage AI providers for your projects on this server. Each provider can have different CLI paths and environment variables.'
                        : 'AI providers configured on this server.'}
                    </p>
                    <LlmProfileManagerInline
                      key={activeServerId || 'none'}
                      readOnly={!isActiveLocalBackend}
                    />
                  </div>
                )}

                {activeTab === 'notifications' && <NotificationSettingsInline />}

                {activeTab === 'gateway' && (
                  <div className="space-y-6">
                    {isMobile ? <MobileGatewayConfig /> : <ServerGatewayConfig />}
                  </div>
                )}

                {activeTab === 'plugins' && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">Plugins</h3>
                    <p className="text-sm text-muted-foreground">
                      Manage installed plugins and their settings. Plugins extend the functionality
                      of Claudia.
                    </p>
                    <PluginSettings />
                  </div>
                )}

                {activeTab === 'web-search' && (
                  <div className="space-y-4">
                    {!isActiveLocalBackend && activeServer && (
                      <RemoteServerBanner
                        serverName={activeServer.name}
                        label="Viewing Web Search settings"
                      />
                    )}
                    <WebSearchSettings readOnly={!isActiveLocalBackend} />
                  </div>
                )}

                {activeTab === 'debug' && (
                  <DebugSettings
                    isConnected={isConnected}
                    sendMessage={sendMessage}
                    embeddedServerStatus={embeddedServerStatus}
                  />
                )}

                {typeof activeTab === 'string' &&
                  activeTab.startsWith('plugin:') &&
                  (() => {
                    const tabId = activeTab.slice(7);
                    const tab = pluginSettingsTabs.find(t => t.id === tabId);
                    if (!tab) return null;
                    const Component = tab.component as React.ComponentType | undefined;
                    return (
                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold">{tab.label}</h3>
                        {Component ? (
                          <Component />
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            No settings UI available for this plugin.
                          </p>
                        )}
                      </div>
                    );
                  })()}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Small inline helpers ---

function RemoteServerBanner({ serverName, label }: { serverName: string; label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-muted/60 border border-primary/20 rounded-lg text-sm">
      <svg
        className="w-4 h-4 text-primary shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span>
        {label} on <strong>{serverName}</strong> (read-only)
      </span>
    </div>
  );
}

function LlmProfileManagerInline({ readOnly }: { readOnly?: boolean }) {
  return <LlmProfileManager isOpen={true} onClose={() => {}} inline={true} readOnly={readOnly} />;
}

function ServerPickerDropdown({
  isGatewayConnected,
  visibleGatewayBackends,
  activeServerId,
  facadeConnectionState,
  facadeBackends,
  onClose,
  onSwitch,
}: {
  isGatewayConnected: boolean;
  visibleGatewayBackends: GatewayBackendInfo[];
  activeServerId: string | null;
  facadeConnectionState: BackendConnectionState;
  facadeBackends: BackendSnapshot[];
  onClose: () => void;
  onSwitch: (backend: GatewayBackendInfo) => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-1 right-1 top-full bg-card border border-border rounded-xl shadow-lg z-50 max-h-60 overflow-y-auto">
        {isGatewayConnected && visibleGatewayBackends.length > 0 && (
          <>
            <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-secondary/50 border-t border-border">
              Via Gateway
            </div>
            {visibleGatewayBackends.map(backend => {
              const gwId = backend.backendId;
              const isActive = activeServerId === gwId;
              const viewState = getMobileBackendViewState(
                gwId,
                facadeConnectionState,
                facadeBackends
              );
              const isReachable = viewState !== 'offline';
              const statusColor =
                viewState === 'ready'
                  ? 'bg-success'
                  : viewState === 'transport_reconnecting' || viewState === 'backend_subscribing'
                    ? 'bg-warning animate-pulse'
                    : viewState === 'backend_visible'
                      ? 'bg-warning'
                      : viewState === 'error'
                        ? 'bg-destructive'
                        : 'bg-muted-foreground';
              const statusLabel = getViewStateLabel(viewState);

              return (
                <button
                  key={backend.backendId}
                  onClick={() => onSwitch(backend)}
                  disabled={!isReachable}
                  className={`w-full px-3 py-2 text-left hover:bg-muted flex items-center gap-2 text-sm ${
                    isActive ? 'bg-muted' : ''
                  } ${!isReachable ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
                  <span className="truncate flex-1" title={backend.name}>
                    {backend.name}
                  </span>
                  {isActive && (
                    <span className="px-1.5 py-0.5 bg-muted text-primary text-[10px] rounded-md flex-shrink-0">
                      Active
                    </span>
                  )}
                  {!isReachable && statusLabel && (
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">
                      {statusLabel}
                    </span>
                  )}
                </button>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}
