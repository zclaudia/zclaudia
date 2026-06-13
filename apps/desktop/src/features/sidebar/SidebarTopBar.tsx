import { Search, Bell, SquareStack, ChevronsLeft } from 'lucide-react';
import { openWindowManagerWindow } from '../../utils/windowManagerWindow';
import { PluginWindowButtons } from '../../app/PluginDock';

interface SidebarTopBarProps {
  onToggle: () => void;
  onOpenSearch: () => void;
  isSearchOpen: boolean;
  onOpenNotifications?: () => void;
  isNotificationsOpen?: boolean;
  notificationUnreadCount: number;
  disableNotifications?: boolean;
}

/**
 * Desktop sidebar header: brand + global icon cluster (search / notifications /
 * window manager / collapse) on one row, with the server selector occupying the
 * row below. Replaces the former full-width AppHeader band so the three columns
 * run to the top, divided only by their vertical borders.
 */
export function SidebarTopBar({
  onToggle,
  onOpenSearch,
  isSearchOpen,
  onOpenNotifications,
  isNotificationsOpen = false,
  notificationUnreadCount,
  disableNotifications = false,
}: SidebarTopBarProps) {
  const iconBtn =
    'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground';

  return (
    <div className="flex-shrink-0">
      {/* pl clears the macOS traffic lights, which overlay the top-left. The
          icons sit left-aligned right after the lights; the remaining space is
          draggable for moving the window. */}
      <div className="flex h-9 items-center gap-1 pl-[76px] pr-2" data-tauri-drag-region>

        <button
          onClick={onOpenSearch}
          className={`${iconBtn} ${isSearchOpen ? 'bg-secondary text-foreground' : ''}`}
          title="Search messages"
          aria-label="Search messages"
          aria-expanded={isSearchOpen}
        >
          <Search size={16} strokeWidth={1.75} />
        </button>

        {!disableNotifications && (
          <button
            onClick={onOpenNotifications}
            className={`relative ${iconBtn} ${isNotificationsOpen ? 'bg-secondary text-foreground' : ''}`}
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

        {/* Spacer pushes the collapse toggle to the right, away from the
            search / notifications / window cluster. */}
        <div className="flex-1" data-tauri-drag-region />

        <button
          onClick={onToggle}
          className={iconBtn}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          <ChevronsLeft size={16} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
