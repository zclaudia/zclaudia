// Notification Feed protocol messages

import type {
  NotificationItem,
  NotificationUnreadCountsByTab,
} from '../../features/notification-feed.js';

// Client → Server messages

export interface GetNotificationsMessage {
  type: 'get_notifications';
  limit?: number;
  before?: number;
  unreadOnly?: boolean;
}

export interface MarkNotificationsReadMessage {
  type: 'mark_notifications_read';
  itemIds: string[];
}

export interface MarkAllNotificationsReadMessage {
  type: 'mark_all_notifications_read';
}

export interface DismissNotificationsMessage {
  type: 'dismiss_notifications';
  itemIds: string[];
}

export interface ClearReadNotificationsMessage {
  type: 'clear_read_notifications';
}

// Server → Client messages

export interface NotificationUpdateMessage {
  type: 'notification_update';
  item: NotificationItem;
}

export interface NotificationListMessage {
  type: 'notification_list';
  items: NotificationItem[];
  hasMore: boolean;
  unreadCount: number;
  unreadCountsByTab: NotificationUnreadCountsByTab;
  append?: boolean;
}

export interface NotificationReadMessage {
  type: 'notification_read';
  itemIds: string[];
  readAt: number;
  unreadCount: number;
  unreadCountsByTab: NotificationUnreadCountsByTab;
}

export type NotificationFeedClientMessage =
  | GetNotificationsMessage
  | MarkNotificationsReadMessage
  | MarkAllNotificationsReadMessage
  | DismissNotificationsMessage
  | ClearReadNotificationsMessage;

export type NotificationFeedServerMessage =
  | NotificationUpdateMessage
  | NotificationListMessage
  | NotificationReadMessage;
