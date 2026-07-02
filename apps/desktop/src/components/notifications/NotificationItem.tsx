import type { NotificationItem as NotificationItemData } from '@zclaudia/shared';
import { Bot, Clock, HelpCircle, User, X, Zap, type LucideIcon } from 'lucide-react';
import { useNotificationFeedStore } from '../../stores/notificationFeedStore';
import { useConnection } from '../../contexts/ConnectionContext';
import { useSelectionCoordinator } from '../../hooks/useSelectionCoordinator';
import { timeAgo } from '../../utils/timeAgo';
import { extractThinking } from '../../utils/messageContent';

const STATUS_STYLES: Record<string, { dot: string }> = {
  running: { dot: 'bg-amber-500 animate-pulse' },
  completed: { dot: 'bg-green-500' },
  failed: { dot: 'bg-red-500' },
};

const SOURCE_ICONS: Record<string, LucideIcon> = {
  trigger: Zap,
  scheduled: Clock,
  manual: User,
  delegation: Bot,
};

interface NotificationItemProps {
  item: NotificationItemData;
  onDismiss?: (id: string) => void;
  /** Called after a click navigates to a session (used to close the popup). */
  onAfterSelect?: () => void;
}

export function NotificationItem({ item, onDismiss, onAfterSelect }: NotificationItemProps) {
  const { selectSession } = useSelectionCoordinator();
  const { sendMessage } = useConnection();
  const statusStyle = STATUS_STYLES[item.status] || STATUS_STYLES.running;
  const SourceIcon = SOURCE_ICONS[item.source] ?? HelpCircle;
  const isUnread = !item.readAt;

  const handleClick = () => {
    // Mark as read on click
    if (isUnread) {
      sendMessage({ type: 'mark_notifications_read', itemIds: [item.id] });
      useNotificationFeedStore.getState().markRead([item.id]);
    }
    if (item.sessionId) {
      selectSession(item.sessionId, { backendId: item.ownerBackendId });
      onAfterSelect?.();
    }
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDismiss?.(item.id);
  };

  return (
    <button
      onClick={handleClick}
      className={`group w-full text-left px-3 py-2.5 hover:bg-secondary/50 transition-colors relative ${
        isUnread ? 'border-l-2 border-primary' : 'border-l-2 border-transparent'
      }`}
    >
      {/* Dismiss button — visible on hover */}
      {onDismiss && (
        <span
          onClick={handleDismiss}
          className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-secondary opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
        >
          <X className="w-3 h-3" strokeWidth={1.75} aria-hidden="true" />
        </span>
      )}

      <div className="flex items-start gap-2">
        {/* Status dot */}
        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${statusStyle.dot}`} />

        <div className="flex-1 min-w-0 pr-4">
          {/* Title + source icon + time */}
          <div className="flex items-center gap-1.5">
            <span title={item.source} className="flex shrink-0">
              <SourceIcon
                className="h-3 w-3 text-muted-foreground"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </span>
            <span
              className={`text-xs truncate flex-1 ${isUnread ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
            >
              {item.title}
            </span>
            <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">
              {timeAgo(item.createdAt)}
            </span>
          </div>

          {/* Summary */}
          {item.summary && (
            <p className="text-[11px] text-muted-foreground/70 mt-0.5 line-clamp-1">
              {extractThinking(item.summary).content.trim()}
            </p>
          )}

          {/* Error */}
          {item.error && (
            <p className="text-[11px] text-destructive mt-0.5 line-clamp-1">{item.error}</p>
          )}
        </div>
      </div>
    </button>
  );
}
