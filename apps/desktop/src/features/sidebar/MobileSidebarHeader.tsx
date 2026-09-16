import { Bell, Search, SquareStack, X } from 'lucide-react';
import type { MobileSidebarHeaderProps } from './types';
import { isDesktopTauri } from '../../utils/platform';
import { openWindowManagerWindow } from '../../utils/windowManagerWindow';

/** The drawer's one header-control recipe: a 44px ghost circle. */
const ACTION =
  'relative h-11 w-11 flex-shrink-0 flex items-center justify-center rounded-full transition-colors';
const ACTION_REST =
  'text-muted-foreground hover:text-foreground hover:bg-secondary active:bg-secondary';

export function MobileSidebarHeader({
  onClose,
  onOpenSearch,
  onOpenNotifications,
  isNotificationsOpen,
  notificationUnreadCount,
}: MobileSidebarHeaderProps) {
  return (
    <>
      {/* No wordmark: the drawer does not need to announce which app you are in.
          The content actions sit left so the search glyph's left edge lands on
          the drawer's left rail — px-2 plus the 44px button's 12px inset is the
          same x as every nav icon, backend dot and section label below. Close
          stays right because it dismisses the drawer rather than acting on
          anything inside it. */}
      <div className="h-14 flex-shrink-0 flex items-center justify-between px-2">
        <div className="flex min-w-0 items-center">
          <button
            onClick={onOpenSearch}
            className={`${ACTION} ${ACTION_REST}`}
            aria-label="Search messages"
          >
            <Search size={20} strokeWidth={1.75} />
          </button>
          <button
            onClick={() => {
              onOpenNotifications?.();
              onClose?.();
            }}
            className={`${ACTION} ${
              isNotificationsOpen ? 'bg-secondary text-foreground' : ACTION_REST
            }`}
            aria-label="Open notifications"
          >
            <Bell size={20} strokeWidth={1.75} />
            {notificationUnreadCount > 0 && !isNotificationsOpen && (
              // primary/primary-foreground is the only pair guaranteed to
              // contrast in every theme; muted/60 + primary-foreground was
              // dark-on-dark in all three dark themes.
              <span className="absolute right-0.5 top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-3xs font-semibold text-primary-foreground">
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
              className={`${ACTION} ${ACTION_REST}`}
              aria-label="Open window manager"
            >
              <SquareStack size={20} strokeWidth={1.75} />
            </button>
          )}
        </div>
        <button onClick={onClose} className={`${ACTION} ${ACTION_REST}`} aria-label="Close menu">
          <X size={20} strokeWidth={1.75} />
        </button>
      </div>
      {/* Inset divider — one rule language across header / nav / footer. */}
      <div className="mx-3 flex-shrink-0 border-t border-border" aria-hidden />
    </>
  );
}
