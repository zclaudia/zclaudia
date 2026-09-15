import type { NotificationItem as NotificationItemData } from '@zclaudia/shared';
import { Bot, Clock, X, Zap, type LucideIcon } from 'lucide-react';
import { useNotificationFeedStore } from '../../stores/notificationFeedStore';
import { useConnection } from '../../contexts/ConnectionContext';
import { useSelectionCoordinator } from '../../hooks/useSelectionCoordinator';
import { IconButton } from '../ui/Button';
import { TONE_DOT } from '../ui/tone';
import { extractThinking } from '../../utils/messageContent';
import { notificationStatus, notificationSubject, notificationTime } from './presenter';

/* Only sources that tell the reader something get a glyph. `manual` is the
 * default for every run the user started themselves, so its icon would sit on
 * nearly every row carrying no information — the definition of chrome noise. */
const SOURCE_ICONS: Partial<Record<NotificationItemData['source'], LucideIcon>> = {
  trigger: Zap,
  scheduled: Clock,
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
  const { tone, label: statusLabel } = notificationStatus(item.status);
  const subject = notificationSubject(item);
  const SourceIcon = SOURCE_ICONS[item.source];
  const isUnread = !item.readAt;
  const summary = item.summary ? extractThinking(item.summary).content.trim() : '';

  const handleClick = () => {
    if (isUnread) {
      sendMessage({ type: 'mark_notifications_read', itemIds: [item.id] });
      useNotificationFeedStore.getState().markRead([item.id]);
    }
    if (item.sessionId) {
      selectSession(item.sessionId, { backendId: item.ownerBackendId });
      onAfterSelect?.();
    }
  };

  /* Unread is carried by ink weight and a filled dot; read rows dim the same
   * dot rather than dropping it, so a failure stays legible after it is read.
   * One indicator per row — two (unread marker plus status dot) read as a
   * smudge at this size and spend two semantic colors on every row. */
  const dotTone = `${TONE_DOT[tone]} ${isUnread ? '' : 'opacity-40'} ${
    item.status === 'running' ? 'animate-pulse' : ''
  }`;
  const subjectTone = subject.isOpaqueId
    ? isUnread
      ? 'text-muted-foreground'
      : 'text-muted-foreground/60'
    : isUnread
      ? 'text-foreground'
      : 'text-muted-foreground';

  return (
    <div className="group relative">
      <button
        onClick={handleClick}
        className="w-full select-none rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-secondary focus-visible:ring-1 focus-visible:ring-ring max-md:py-2.5"
      >
        <div className="flex items-start gap-2">
          {/* Fixed-height box centers the dot on the title's line box without
              magic offsets, and keeps it put when a second line appears. */}
          <span className="flex h-5 shrink-0 items-center">
            <span className={`h-1.5 w-1.5 rounded-full ${dotTone}`} aria-hidden="true" />
          </span>

          <div className={`min-w-0 flex-1 ${onDismiss ? 'max-md:pr-7' : ''}`}>
            <div className="flex items-center gap-1.5">
              {SourceIcon && (
                <SourceIcon
                  className="h-3 w-3 shrink-0 text-muted-foreground"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              )}
              <span
                className={`flex-1 truncate text-sm ${isUnread ? 'font-medium' : ''} ${subjectTone}`}
              >
                <span className="sr-only">{statusLabel}: </span>
                {subject.text}
              </span>
              <span
                className={`shrink-0 text-3xs tabular-nums text-muted-foreground/60 transition-opacity ${
                  onDismiss ? 'md:group-hover:opacity-0' : ''
                }`}
              >
                {notificationTime(item.createdAt)}
              </span>
            </div>

            {item.error ? (
              <p className="mt-0.5 line-clamp-2 text-2xs text-destructive">{item.error}</p>
            ) : (
              summary && (
                <p className="mt-0.5 line-clamp-1 text-2xs text-muted-foreground/60">{summary}</p>
              )
            )}
          </div>
        </div>
      </button>

      {/* Sibling, not a nested clickable span: a control inside a button is
          invalid and unreachable by keyboard. It takes over the timestamp's
          corner on hover so the two never overlap. The wrapper owns the
          positioning because IconButton's own `relative` would win over an
          `absolute` passed in via className (Tailwind orders position
          utilities in the stylesheet, not by class order). */}
      {onDismiss && (
        <span className="absolute right-1 top-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
          <IconButton
            size="sm"
            aria-label={`Dismiss notification: ${subject.text}`}
            onClick={() => onDismiss(item.id)}
          >
            <X className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        </span>
      )}
    </div>
  );
}
