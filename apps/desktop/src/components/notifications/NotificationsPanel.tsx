import { useEffect, useCallback } from 'react';
import { Inbox, X } from 'lucide-react';
import { useNotificationFeedStore } from '../../stores/notificationFeedStore';
import { useConnection } from '../../contexts/ConnectionContext';
import { Badge } from '../ui/Badge';
import { Button, IconButton } from '../ui/Button';
import { SECTION_LABEL } from '../ui/typography';
import { NotificationItem } from './NotificationItem';
import { groupNotificationsByDay } from './presenter';

interface NotificationsPanelProps {
  /** When provided, renders a close button and closes the panel on navigate. */
  onClose?: () => void;
}

/** Placeholder rows shaped like the real ones, so the list doesn't jump on load. */
function FeedSkeleton() {
  return (
    <div className="space-y-1 px-2 py-1.5" aria-hidden="true">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="flex items-center gap-2 px-2 py-1.5">
          <span data-skeleton className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
          <span
            data-skeleton
            className="h-3 animate-pulse rounded bg-muted"
            style={{ width: `${58 - i * 9}%` }}
          />
        </div>
      ))}
    </div>
  );
}

export function NotificationsPanel({ onClose }: NotificationsPanelProps = {}) {
  const { items, hasMore, loading, unreadCount, hydrated, setLoading, clearRead, removeItem } =
    useNotificationFeedStore();
  const { sendMessage } = useConnection();

  useEffect(() => {
    if (hydrated) return;
    setLoading(true);
    sendMessage({ type: 'get_notifications', limit: 50 });
  }, [hydrated, sendMessage, setLoading]);

  const loadMore = useCallback(() => {
    if (!hasMore || loading) return;
    const oldest = items[items.length - 1];
    if (oldest) {
      setLoading(true);
      sendMessage({ type: 'get_notifications', limit: 50, before: oldest.createdAt });
    }
  }, [hasMore, loading, items, sendMessage, setLoading]);

  const markAllRead = useCallback(() => {
    if (unreadCount > 0) {
      sendMessage({ type: 'mark_all_notifications_read' });
      useNotificationFeedStore.getState().markAllRead();
    }
  }, [sendMessage, unreadCount]);

  const handleClearRead = useCallback(() => {
    sendMessage({ type: 'clear_read_notifications' });
    clearRead();
  }, [clearRead, sendMessage]);

  const handleDismiss = useCallback(
    (id: string) => {
      sendMessage({ type: 'dismiss_notifications', itemIds: [id] });
      removeItem(id);
    },
    [removeItem, sendMessage]
  );

  const hasReadItems = items.some(i => i.readAt);
  const groups = groupNotificationsByDay(items);
  const isEmpty = items.length === 0 && !loading;

  return (
    <div className="flex h-full flex-col">
      {/* Wraps rather than truncates: at phone widths the actions drop to their
          own line instead of squeezing the title to "Notific…" and folding the
          badge in half. */}
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-foreground">Notifications</span>
          {unreadCount > 0 && (
            <span className="flex-shrink-0">
              <Badge label={`${unreadCount} unread`} />
            </span>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {unreadCount > 0 && (
            <Button size="sm" onClick={markAllRead}>
              Mark all read
            </Button>
          )}
          {hasReadItems && (
            <Button size="sm" onClick={handleClearRead}>
              Clear read
            </Button>
          )}
          {onClose && (
            <IconButton size="sm" aria-label="Close notifications" onClick={onClose}>
              <X size={15} strokeWidth={1.75} />
            </IconButton>
          )}
        </div>
      </div>

      {/* min-h-0 lets this flex child shrink so it scrolls inside the modal's capped height */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isEmpty && (
          <div className="flex flex-col items-center px-8 py-12 text-center">
            <Inbox
              className="mb-3 h-6 w-6 text-muted-foreground/60"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <p className="text-sm text-foreground">You're all caught up</p>
            <p className="mt-1 text-2xs text-muted-foreground">
              Finished runs, scheduled triggers, and plugin alerts land here.
            </p>
          </div>
        )}

        {items.length === 0 && loading && <FeedSkeleton />}

        {groups.map(group => (
          <section key={group.key}>
            {/* Sticky so the date stays legible while its own run scrolls past. */}
            <h3
              className={`${SECTION_LABEL} sticky top-0 z-10 bg-card px-4 pb-1 pt-2.5 max-md:pt-3`}
            >
              {group.label}
            </h3>
            <div className="space-y-px px-2 pb-1">
              {group.items.map(item => (
                <NotificationItem
                  key={item.id}
                  item={item}
                  onDismiss={handleDismiss}
                  onAfterSelect={onClose}
                />
              ))}
            </div>
          </section>
        ))}

        {hasMore && (
          <div className="px-2 pb-2 pt-1">
            <Button size="sm" onClick={loadMore} disabled={loading} className="w-full">
              {loading ? 'Loading…' : 'Load older'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
