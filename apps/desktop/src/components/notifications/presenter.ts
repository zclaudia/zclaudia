import type { NotificationItem, NotificationStatus } from '@zclaudia/shared';
import type { Tone } from '../ui/tone';

/**
 * Display logic for the notification feed, kept out of the components so the
 * rules below are readable and testable on their own.
 */

interface StatusPresentation {
  tone: Tone;
  /** Read by assistive tech: a colored dot on its own is a color-only signal. */
  label: string;
}

const STATUS: Record<NotificationStatus, StatusPresentation> = {
  running: { tone: 'warning', label: 'Running' },
  completed: { tone: 'success', label: 'Completed' },
  failed: { tone: 'destructive', label: 'Failed' },
};

export function notificationStatus(status: NotificationStatus): StatusPresentation {
  return STATUS[status] ?? { tone: 'neutral', label: 'Updated' };
}

/* Run notifications arrive titled "<status>: <session>" (the server's
 * run-terminal-notifications.ts). The row already renders status as a dot, so
 * the prefix is a duplicate that pushes the one part that identifies the row —
 * the session — past the truncation point of a narrow popover. */
const RUN_PREFIX = /^run (completed|failed|started|running)\s*:\s*/i;
const PREFIX_STATUS: Record<string, NotificationStatus> = {
  completed: 'completed',
  failed: 'failed',
  started: 'running',
  running: 'running',
};

/** Unnamed sessions fall back to their id, which is 36 characters of noise. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NotificationSubject {
  text: string;
  /** True when the subject is a shortened id, not a name anyone chose. */
  isOpaqueId: boolean;
}

/**
 * What the row shows as its title. The status prefix is stripped only when it
 * agrees with the item's own status — a title shape we don't recognize is shown
 * verbatim rather than guessed at.
 */
export function notificationSubject(
  item: Pick<NotificationItem, 'title' | 'status'>
): NotificationSubject {
  const title = item.title.trim();
  const match = RUN_PREFIX.exec(title);
  const stripped =
    match && PREFIX_STATUS[match[1].toLowerCase()] === item.status
      ? title.slice(match[0].length).trim()
      : title;
  const text = stripped || title;
  return SESSION_ID.test(text)
    ? { text: text.slice(0, 8), isOpaqueId: true }
    : { text, isOpaqueId: false };
}

/**
 * Time within the row's day group. Recent items stay relative because that is
 * what a notification feed is scanned for; everything older reads as a clock
 * time, since the group header already carries the date.
 */
export function notificationTime(timestamp: number, now = Date.now()): string {
  const diff = now - timestamp;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function dayLabel(day: number, today: number): string {
  if (day === today) return 'Today';
  // One millisecond before today's midnight lands in yesterday whatever the
  // day's length was (DST shifts make `today - 24h` unreliable).
  if (day === startOfDay(today - 1)) return 'Yesterday';
  const date = new Date(day);
  const sameYear = date.getFullYear() === new Date(today).getFullYear();
  return date.toLocaleDateString(
    undefined,
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { year: 'numeric', month: 'short', day: 'numeric' }
  );
}

export interface NotificationDayGroup {
  key: string;
  label: string;
  items: NotificationItem[];
}

/**
 * Split the feed into day runs. Grouping is contiguous rather than by lookup, so
 * the server's ordering is preserved exactly; an out-of-order item opens its own
 * group instead of being silently teleported up the list.
 */
export function groupNotificationsByDay(
  items: NotificationItem[],
  now = Date.now()
): NotificationDayGroup[] {
  const today = startOfDay(now);
  const groups: NotificationDayGroup[] = [];
  for (const item of items) {
    const key = String(startOfDay(item.createdAt));
    const current = groups[groups.length - 1];
    if (current?.key === key) {
      current.items.push(item);
      continue;
    }
    groups.push({ key, label: dayLabel(Number(key), today), items: [item] });
  }
  return groups;
}
