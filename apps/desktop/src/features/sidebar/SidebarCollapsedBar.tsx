import { PanelLeft, Search, Bell, SquareStack } from 'lucide-react';
import { openWindowManagerWindow } from '../../utils/windowManagerWindow';
import { PluginWindowButtons } from '../../app/PluginDock';

interface SidebarCollapsedBarProps {
  onExpand: () => void;
  onOpenSearch: () => void;
  onOpenNotifications?: () => void;
  notificationUnreadCount: number;
  disableNotifications?: boolean;
}

/**
 * Collapsed-sidebar chrome (Cursor-style): a thin full-width top bar that hosts
 * the global icons next to the macOS traffic lights. The sidebar itself is
 * hidden and the content fills the full width below this bar — so the traffic
 * lights always have room and never collide with a narrow rail.
 */
export function SidebarCollapsedBar({
  onExpand,
  onOpenSearch,
  onOpenNotifications,
  notificationUnreadCount,
  disableNotifications = false,
}: SidebarCollapsedBarProps) {
  const iconBtn =
    'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground';

  return (
    <div
      className="flex h-9 flex-shrink-0 items-center gap-1 bg-background pl-[76px] pr-2"
      data-tauri-drag-region
    >
      <button onClick={onExpand} className={iconBtn} title="Expand sidebar" aria-label="Expand sidebar">
        <PanelLeft size={16} strokeWidth={1.75} />
      </button>

      <button onClick={onOpenSearch} className={iconBtn} title="Search messages" aria-label="Search messages">
        <Search size={16} strokeWidth={1.75} />
      </button>

      {!disableNotifications && (
        <button
          onClick={onOpenNotifications}
          className={`relative ${iconBtn}`}
          title="Notifications"
          aria-label="Notifications"
        >
          <Bell size={16} strokeWidth={1.75} />
          {notificationUnreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium text-primary-foreground">
              {notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}
            </span>
          )}
        </button>
      )}

      <button
        onClick={() => { void openWindowManagerWindow(); }}
        className={iconBtn}
        title="Windows"
        aria-label="Open window manager"
      >
        <SquareStack size={16} strokeWidth={1.75} />
      </button>

      <PluginWindowButtons />

      <div className="flex-1" data-tauri-drag-region />
    </div>
  );
}
