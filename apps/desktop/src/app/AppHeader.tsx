import { SquareStack, ChevronsRight, ChevronsLeft, ChevronLeft, Menu, Bell } from 'lucide-react';
import { emit as emitTauri } from '@tauri-apps/api/event';
import { NOTCH_EVENT } from '../services/notchBridge';
import { openWindowManagerWindow } from '../utils/windowManagerWindow';
import { ServerSelector } from '../features/settings/ServerSelector';
import { BrandMark } from '../components/BrandMark';
import { IconButton } from '../components/ui/Button';
import { Tooltip } from '../components/ui/Tooltip';
import { PluginWindowButtons } from './PluginDock';

interface AppHeaderProps {
  isMobile: boolean;
  isAgentExpanded: boolean;
  sidebarCollapsed: boolean;
  notificationUnreadCount: number;
  disableNotifications: boolean;
  onToggleSidebar: () => void;
  onOpenSidebar: () => void;
  onCloseAgent: () => void;
}

export function AppHeader({
  isMobile,
  isAgentExpanded,
  sidebarCollapsed,
  notificationUnreadCount,
  disableNotifications,
  onToggleSidebar,
  onOpenSidebar,
  onCloseAgent,
}: AppHeaderProps) {
  return (
    <header
      className={`h-12 md:h-14 border-b border-border flex items-center px-2 md:px-4 bg-card flex-shrink-0 ${isMobile && !isAgentExpanded ? 'hidden' : ''}`}
      data-tauri-drag-region
    >
      {/* Left section: Logo and app name */}
      <div className="flex items-center gap-2 md:gap-3 flex-shrink-0" data-tauri-drag-region>
        {/* Mobile buttons keep the larger touch target (p-2) instead of IconButton's 28px. */}
        {isMobile && isAgentExpanded ? (
          <button
            onClick={onCloseAgent}
            className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground flex-shrink-0"
            aria-label="Close agent"
          >
            <ChevronLeft size={20} strokeWidth={1.75} />
          </button>
        ) : isMobile ? (
          <button
            onClick={onOpenSidebar}
            className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground flex-shrink-0"
            aria-label="Open menu"
          >
            <Menu size={20} strokeWidth={1.75} />
          </button>
        ) : null}

        <div className="hidden md:flex items-center gap-2" data-tauri-drag-region>
          <div className="w-7 h-7 rounded-xl border border-border/70 bg-card/80 shadow-apple-sm backdrop-blur-sm flex items-center justify-center flex-shrink-0">
            <BrandMark className="w-[1.625rem] h-[1.625rem] object-contain pointer-events-none select-none drop-shadow-sm" />
          </div>
          <span
            className="font-semibold text-sm text-foreground leading-tight"
            data-tauri-drag-region
          >
            ZClaudia
          </span>
        </div>

        {!isMobile && (
          <Tooltip content={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <IconButton
              onClick={onToggleSidebar}
              className="ml-2"
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? (
                <ChevronsRight size={16} strokeWidth={1.75} />
              ) : (
                <ChevronsLeft size={16} strokeWidth={1.75} />
              )}
            </IconButton>
          </Tooltip>
        )}
      </div>

      {/* Center section: Server selector + Feed */}
      <div className="flex-1 flex items-center justify-start ml-2 md:ml-4 min-w-0 gap-2">
        {isMobile && isAgentExpanded ? (
          <span className="font-semibold text-sm text-foreground">Claudia</span>
        ) : isMobile ? null : (
          <>
            <ServerSelector />
            {!disableNotifications && (
              <Tooltip content="Notifications">
                <IconButton
                  onClick={() => {
                    void emitTauri(NOTCH_EVENT.toggle, {});
                  }}
                  className="relative"
                  aria-label="Notifications"
                >
                  <Bell size={16} strokeWidth={1.75} />
                  {notificationUnreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center bg-primary text-primary-foreground text-[10px] font-medium rounded-full px-0.5">
                      {notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}
                    </span>
                  )}
                </IconButton>
              </Tooltip>
            )}
            <Tooltip content="Windows">
              <IconButton
                onClick={() => {
                  void openWindowManagerWindow();
                }}
                aria-label="Open window manager"
              >
                <SquareStack size={16} strokeWidth={1.75} />
              </IconButton>
            </Tooltip>
          </>
        )}
      </div>

      <PluginWindowButtons />
    </header>
  );
}
