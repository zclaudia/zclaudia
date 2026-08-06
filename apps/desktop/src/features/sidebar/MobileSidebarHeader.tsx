import { SquareStack, Bell } from 'lucide-react';
import { BrandMark } from '../../components/BrandMark';
import type { MobileSidebarHeaderProps } from './types';
import { isDesktopTauri } from '../../utils/platform';
import { openWindowManagerWindow } from '../../utils/windowManagerWindow';

export function MobileSidebarHeader({
  onClose,
  onOpenNotifications,
  isNotificationsOpen,
  notificationUnreadCount,
  isClaudiaExpanded,
  setClaudiaExpanded,
  hasClaudiaPermissionPending,
  hasClaudiaUnread,
  hasClaudiaRunning,
}: MobileSidebarHeaderProps) {
  return (
    <>
      {/* Single header band: title plus the drawer's global actions. Backends
          live in the tree below (which owns status and switching), so there is
          no separate picker row here. */}
      <div className="h-[72px] border-b border-border flex items-center gap-1 px-3">
        <h1 className="min-w-0 flex-1 truncate font-semibold text-lg">ZClaudia</h1>
        <button
          onClick={() => {
            onOpenNotifications?.();
            onClose?.();
          }}
          className={`relative h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-full transition-colors ${
            isNotificationsOpen
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
          }`}
          title="Notifications"
          aria-label="Open notifications"
        >
          <Bell size={18} strokeWidth={1.75} />
          {notificationUnreadCount > 0 && !isNotificationsOpen && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center bg-muted/60 text-primary-foreground text-[9px] font-medium rounded-full px-0.5">
              {notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}
            </span>
          )}
        </button>
        {isDesktopTauri() && (
          <button
            onClick={() => {
              void openWindowManagerWindow();
              onClose?.();
            }}
            className="relative h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-full transition-colors text-muted-foreground hover:text-foreground hover:bg-secondary"
            title="Windows"
            aria-label="Open window manager"
          >
            <SquareStack size={18} strokeWidth={1.75} />
          </button>
        )}
        <button
          onClick={() => {
            setClaudiaExpanded(true);
            onClose?.();
          }}
          className={`relative h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-full transition-colors ${
            isClaudiaExpanded
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
          }`}
          title="Open Claudia"
          aria-label="Open Claudia"
        >
          <BrandMark className="w-[18px] h-[18px] object-contain" />
          {(hasClaudiaPermissionPending || hasClaudiaUnread || hasClaudiaRunning) &&
            !isClaudiaExpanded && (
              <span
                className={`absolute top-1 right-1 w-2 h-2 rounded-full ${
                  hasClaudiaPermissionPending
                    ? 'bg-warning'
                    : hasClaudiaUnread
                      ? 'bg-primary animate-pulse'
                      : 'bg-warning animate-pulse'
                }`}
              />
            )}
        </button>
        <button
          onClick={onClose}
          className="h-10 w-10 flex-shrink-0 rounded-full hover:bg-secondary active:bg-secondary text-muted-foreground hover:text-foreground flex items-center justify-center"
          title="Close menu"
          aria-label="Close menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </>
  );
}
