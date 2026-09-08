/**
 * Reserved contract for an optional external notification display plugin.
 * A connector can publish this API with PluginContext.exports and consumers
 * can discover it with getPluginAPI. The host does not provide a connector.
 * Transport, connection settings and display lifecycle belong to the plugin.
 */
export interface NotificationSinkChannel {
  id: string;
  label: string;
}

export interface NotificationSinkItem {
  /** Unique within a source. Business identifiers stay in the source adapter. */
  id: string;
  channelId: string;
  title: string;
  body?: string;
  createdAt: number;
  read: boolean;
  attention?: boolean;
  actions?: Array<{ id: string; label: string }>;
}

export interface NotificationSinkSnapshot {
  /** Identifies a producer and backend, so multiple backends cannot collide. */
  sourceId: string;
  sourceLabel: string;
  channels: NotificationSinkChannel[];
  items: NotificationSinkItem[];
  /** Total may exceed the number of items in this snapshot. */
  unreadCount: number;
}

export interface NotificationSinkAction {
  sourceId: string;
  itemId: string;
  /** Opaque ID supplied in the item's actions; interpreted by the producer. */
  actionId: string;
}

export interface NotificationSinkPluginAPI {
  readonly version: 1;
  /** Replace one source's state; also used to restore state after reconnect. */
  replaceSnapshot(snapshot: NotificationSinkSnapshot): Promise<void>;
  removeSource(sourceId: string): Promise<void>;
  /** The producer handles actions through its existing business APIs. */
  onAction(
    sourceId: string,
    handler: (action: NotificationSinkAction) => Promise<void>
  ): () => void;
}
