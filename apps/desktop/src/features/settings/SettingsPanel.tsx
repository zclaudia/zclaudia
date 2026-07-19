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
import { useConnection } from '../../contexts/ConnectionContext';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useAndroidBack } from '../../hooks/useAndroidBack';
import { useSidebarWidthStore, SIDEBAR_WIDTH_LIMITS } from '../../stores/sidebarWidthStore';
import { ServerGatewayConfig } from './ServerGatewayConfig';
import { usePluginStore, selectPluginSettingsTabs } from '../../stores/pluginStore';
import { AgentSettings } from './AgentSettings';
import { PermissionSettings } from './PermissionSettings';
import { NotificationSettingsInline } from './NotificationSettings';
import { MobileGatewayConfig } from './MobileGatewayConfig';
import { DebugSettings } from './DebugSettings';
import { GeneralSettings } from './GeneralSettings';
import { AboutSettings } from './AboutSettings';
import { type SettingsTab, type SettingsTabDef, getSettingsTabs } from './settingsTabDefs';

import { isMobileBackendUsable } from '../../services/mobileConnectionState';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
}

export function SettingsPanel({ isOpen, onClose, initialTab }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? 'general');
  const [mobileShowContent, setMobileShowContent] = useState(false);
  const [navQuery, setNavQuery] = useState('');
  const isMobile = useIsMobile();
  const pluginSettingsTabs = usePluginStore(selectPluginSettingsTabs);

  // Settings always show/edit this device's local backend; backend switching
  // lives in the app header's ServerSelector, not in this panel.
  const activeServerId = useServerStore(s => s.activeServerId);
  const { sendMessage, embeddedServerStatus } = useConnection();

  const facadeBackends = useFacadeStore(s => s.backends);
  const facadeConnectionState = useFacadeStore(s => s.connectionState);
  const isConnected = isMobileBackendUsable({
    backendId: activeServerId,
    connectionState: facadeConnectionState,
    backends: facadeBackends,
  });

  const tabs = getSettingsTabs({ isMobile: !!isMobile, pluginSettingsTabs });
  const sidebarWidth = useSidebarWidthStore(s => s.widthPx);
  const setSidebarWidth = useSidebarWidthStore(s => s.setWidth);
  const resizeDragging = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  const navQ = navQuery.trim().toLowerCase();
  const visibleTabs = navQ ? tabs.filter(t => t.label.toLowerCase().includes(navQ)) : tabs;

  useEffect(() => {
    if (isOpen && initialTab) setActiveTab(initialTab);
  }, [isOpen, initialTab]);

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
                ? tabs.find(t => t.id === activeTab)?.label || 'Settings'
                : 'Settings'}
            </h2>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* Mobile: Tab list */}
        {isMobile && !mobileShowContent && (
          <div className="flex-1 overflow-y-auto p-2">{tabs.map(renderMobileTabItem)}</div>
        )}

        {/* Desktop: Tabs vertical sidebar */}
        {!isMobile && (
          <div
            data-testid="settings-sidebar"
            className="relative flex flex-col bg-card p-1.5 shrink-0"
            style={{ width: clampedSettingsSidebarWidth }}
          >
            <div
              data-testid="settings-sidebar-resize-handle"
              className="absolute top-0 right-0 z-20 h-full w-1 cursor-ew-resize hover:bg-muted"
              onMouseDown={onResizeStart}
              onTouchStart={onResizeStart}
              aria-hidden
            />
            <div
              data-testid="settings-sidebar-card"
              className="flex flex-1 flex-col min-h-0 overflow-hidden rounded-lg border border-border/50 bg-[hsl(var(--sidebar))] shadow-sm"
            >
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

                {visibleTabs.map(renderTabButton)}
              </div>
            </div>
          </div>
        )}

        {/* Content area */}
        {(!isMobile || mobileShowContent) && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {!isMobile && <div className="h-9 flex-shrink-0" data-tauri-drag-region />}
            <div className="flex-1 overflow-y-auto">
              <div className={isMobile ? 'p-3' : 'max-w-[640px] mx-auto px-8 pt-2 pb-10'}>
                {activeTab === 'general' && <GeneralSettings />}

                {activeTab === 'agent' && <AgentSettings />}
                {activeTab === 'permissions' && <PermissionSettings />}

                {activeTab === 'notifications' && <NotificationSettingsInline />}

                {activeTab === 'gateway' && (
                  <div className="space-y-6">
                    {isMobile ? <MobileGatewayConfig /> : <ServerGatewayConfig />}
                  </div>
                )}

                {activeTab === 'debug' && (
                  <DebugSettings
                    isConnected={isConnected}
                    sendMessage={sendMessage}
                    embeddedServerStatus={embeddedServerStatus}
                  />
                )}

                {activeTab === 'about' && <AboutSettings isOpen={isOpen} />}

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
