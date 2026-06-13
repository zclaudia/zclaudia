import { ChevronsRight, Search, Bell, SquareStack } from 'lucide-react';
import { openWindowManagerWindow } from '../../utils/windowManagerWindow';
import { BrandMark } from '../../components/BrandMark';

interface SidebarRailProps {
  onExpand: () => void;
  onOpenSearch: () => void;
  onOpenNotifications?: () => void;
  notificationUnreadCount: number;
  disableNotifications?: boolean;
}

/**
 * Collapsed sidebar: a slim vertical icon rail (expand / search / notifications
 * / window manager) so the global controls stay reachable without the full
 * sidebar. Activity-bar pattern; keeps icons in a stable place across states.
 */
export function SidebarRail({
  onExpand,
  onOpenSearch,
  onOpenNotifications,
  notificationUnreadCount,
  disableNotifications = false,
}: SidebarRailProps) {
  const iconBtn =
    'flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground';

  return (
    <div className="flex w-12 flex-shrink-0 flex-col items-center border-r border-border/50 bg-[hsl(var(--sidebar))]">
      {/* Clears the macOS traffic lights overlaying the top; also draggable. */}
      <div className="h-7 w-full flex-shrink-0" data-tauri-drag-region />
      <button
        onClick={onExpand}
        className={iconBtn}
        title="Expand sidebar"
        aria-label="Expand sidebar"
      >
        <ChevronsRight size={18} strokeWidth={1.75} />
      </button>

      <div className="my-1.5 h-px w-5 bg-border/70" />

      <button
        onClick={onOpenSearch}
        className={iconBtn}
        title="Search messages"
        aria-label="Search messages"
      >
        <Search size={18} strokeWidth={1.75} />
      </button>

      {!disableNotifications && (
        <button
          onClick={onOpenNotifications}
          className={`relative ${iconBtn}`}
          title="Notifications"
          aria-label="Notifications"
        >
          <Bell size={18} strokeWidth={1.75} />
          {notificationUnreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium text-primary-foreground">
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
        <SquareStack size={18} strokeWidth={1.75} />
      </button>

      <div className="flex-1" />

      <div className="mb-3 flex h-6 w-6 items-center justify-center">
        <BrandMark className="h-[1.375rem] w-[1.375rem] object-contain pointer-events-none select-none opacity-80 drop-shadow-sm" />
      </div>
    </div>
  );
}
