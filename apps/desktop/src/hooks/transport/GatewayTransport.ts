/**
 * Gateway WebSocket Transport (Client-Only Peer)
 *
 * Implements the gateway sync protocol for desktop/mobile client.
 * Features:
 * - Epoch-bound routing
 * - Snapshot-based registry sync
 * - Backend subscription model for backend interaction
 * - Content catch-up for disconnect recovery
 */

import type { ClientMessage, ServerMessage } from '@zclaudia/shared/wire/messages/index';
import type {
  BackendPresenceV4 as BackendPresence,
  BackendServerMessage,
  ChannelClosedMessage,
  ChannelReadyMessage,
  GatewayErrorV4 as GatewayErrorMessage,
  PeerHelloV4 as PeerHelloMessage,
  PeerReadyV4 as PeerReadyMessage,
  RegistrySnapshotV4 as RegistrySnapshotMessage,
  TopicMessage,
  TopicSubscribedMessage,
  TopicUnsubscribedMessage,
} from '@zclaudia/gateway-protocol';
import { GATEWAY_PROTOCOL_V4 } from '@zclaudia/gateway-protocol';
import type {
  BackendResourceEventMessage,
  BackendResourceSnapshotMessage,
  CatchUpContentMessage,
  ContentPatchErrorMessage,
  ContentPatchMessage,
} from '@zclaudia/protocol/sync';
import {
  MESSAGE_CHANNEL_KIND,
  RESOURCES_TOPIC,
  ZCLAUDIA_NAMESPACE,
} from '@zclaudia/protocol/transport';
import type { ProjectItem, SessionItem, SessionMessage } from '@zclaudia/protocol/zclaudia';

/** Max frames queued per backend while its message channel (re)opens. */
const MAX_PENDING_CHANNEL_FRAMES = 100;
const CHANNEL_OPEN_TIMEOUT_MS = 10_000;
const DATA_CHANNEL_OPEN_TIMEOUT_MS = 10_000;
const DATA_CHANNEL_IDLE_TIMEOUT_MS = 90_000;
const CONTROL_CONNECT_TIMEOUT_MS = 15_000;
const CONTROL_HANDSHAKE_TIMEOUT_MS = 10_000;

// ============================================================================
// Config & Callbacks
// ============================================================================

export interface GatewayTransportConfig {
  url: string;
  gatewaySecret: string;
  deviceId: string;
  instanceId: string;

  onConnected: (peerSessionId: string, recoveryToken: string) => void;
  onDisconnected: () => void;
  onError: (error: Event | string) => void;
  onRegistryChanged: (items: BackendPresence[]) => void;
  onBackendDataSnapshot: (
    backendId: string,
    sessions: SessionItem[],
    projects: ProjectItem[]
  ) => void;
  onBackendDataEvent: (backendId: string, event: BackendResourceEventMessage) => void;
  onBackendSubscribed: (backendId: string, epoch: number, capabilities: string[]) => void;
  onBackendUnsubscribed: (backendId: string, reason: string) => void;
  onBackendServerMessage: (backendId: string, message: ServerMessage) => void;
  onContentPatch: (
    backendId: string,
    sessionId: string,
    messages: SessionMessage[],
    latestOffset: number
  ) => void;
  onContentPatchError: (
    backendId: string,
    sessionId: string,
    afterOffset: number,
    error: string
  ) => void;
  onBackendsRemoved?: (backendIds: string[]) => void;
}

// ============================================================================
// Transport
// ============================================================================

export class GatewayTransport {
  private ws: WebSocket | null = null;
  private config: GatewayTransportConfig;
  private expectedCloseWs: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private reconnectAttempt = 0;
  private healthProbeTimeout: ReturnType<typeof setTimeout> | null = null;
  private controlPhaseTimer: ReturnType<typeof setTimeout> | null = null;

  private peerSessionId: string | null = null;
  private recoveryToken: string | null = null;
  private authenticated = false;

  private registryItems = new Map<string, BackendPresence>();

  private resolvedUrl: string | null = null;

  /** Set of backendIds we are currently subscribed to. */
  subscribedBackends = new Set<string>();

  // --- Protocol v4 message channels (per-backend dedicated pipe) ---
  /** backendId → open data socket. Targeted messages prefer this pipe. */
  private messageChannels = new Map<string, { channelId: string; ws: WebSocket }>();
  /**
   * channel_ready carries no request correlation, so opens run one at a
   * time and are matched FIFO (same contract as the SDK client).
   */
  private pendingChannelOpens: string[] = [];
  private channelOpenInFlight = false;
  private channelOpenTimer: ReturnType<typeof setTimeout> | null = null;
  private controlGeneration = 0;
  private dialingChannels = new Map<
    WebSocket,
    { backendId: string; generation: number; timer: ReturnType<typeof setTimeout> }
  >();
  private dataChannelIdleTimers = new Map<WebSocket, ReturnType<typeof setTimeout>>();
  private pendingBackendReady = new Map<string, { epoch: number; capabilities: string[] }>();
  private pendingResourceMessages = new Map<
    string,
    Array<BackendResourceSnapshotMessage | BackendResourceEventMessage>
  >();
  /**
   * Frames waiting for the backend's channel to (re)open. The channel is
   * the only targeted path in the v4 data plane, so setup/reopen gaps queue
   * instead of dropping (bounded, oldest dropped first).
   */
  private pendingChannelFrames = new Map<string, string[]>();

  constructor(config: GatewayTransportConfig) {
    this.config = config;
  }

  connect(): void {
    this.intentionalClose = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearControlPhaseTimer();
    this.controlGeneration++;
    this.closeAllMessageChannels();
    if (this.ws) {
      this.expectedCloseWs = this.ws;
      this.ws.close();
    }
    this.authenticated = false;
    this.subscribedBackends.clear();
    // Normalize URL: ensure ws:// or wss:// protocol for WebSocket
    let wsUrl = this.config.url;
    if (wsUrl.startsWith('https://')) {
      wsUrl = 'wss://' + wsUrl.slice(8);
    } else if (wsUrl.startsWith('http://')) {
      wsUrl = 'ws://' + wsUrl.slice(7);
    } else if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
      wsUrl = 'ws://' + wsUrl;
    }
    // Append /ws path if not already present
    if (!wsUrl.endsWith('/ws') && !wsUrl.includes('/ws?')) {
      wsUrl = wsUrl.replace(/\/?$/, '/ws');
    }
    this.resolvedUrl = wsUrl;
    console.log(`[GatewayTransport] Connecting to: ${wsUrl} (original: ${this.config.url})`);
    this.ws = new WebSocket(wsUrl);
    this.setupWebSocket(this.ws);
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearControlPhaseTimer();
    if (this.ws) {
      this.expectedCloseWs = this.ws;
      this.ws.close();
      this.ws = null;
    }
    this.controlGeneration++;
    this.cleanup();
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.authenticated;
  }

  // --- Backend Subscription (v4: resources topic + message channel) ---
  subscribe(backendId: string): void {
    if (this.subscribedBackends.has(backendId)) return;
    if (!this.isV4Backend(backendId)) {
      console.warn(
        '[GatewayTransport] Backend does not speak protocol v4, cannot subscribe:',
        backendId
      );
      return;
    }
    this.send({ type: 'topic_subscribe', backendId, topic: RESOURCES_TOPIC });
  }

  unsubscribe(backendId: string): void {
    this.send({ type: 'topic_unsubscribe', backendId, topic: RESOURCES_TOPIC });
    this.closeMessageChannel(backendId);
  }

  sendToBackend(backendId: string, message: ClientMessage): void {
    if (!this.subscribedBackends.has(backendId)) {
      console.error('[GatewayTransport] Cannot send: not subscribed to backend', backendId);
      return;
    }
    this.sendChannelFrame(backendId, message);
  }

  /**
   * Send a frame over the backend's message channel, queueing while the
   * channel (re)opens — it is the only targeted path in the v4 data plane.
   */
  private sendChannelFrame(backendId: string, frame: unknown): void {
    const serialized = JSON.stringify(frame);
    const channel = this.messageChannels.get(backendId);
    if (channel && channel.ws.readyState === WebSocket.OPEN) {
      channel.ws.send(serialized);
      return;
    }
    let queue = this.pendingChannelFrames.get(backendId);
    if (!queue) {
      queue = [];
      this.pendingChannelFrames.set(backendId, queue);
    }
    if (queue.length >= MAX_PENDING_CHANNEL_FRAMES) queue.shift();
    queue.push(serialized);
    this.maybeOpenMessageChannel(backendId);
  }

  isBackendSubscribed(backendId: string): boolean {
    return this.subscribedBackends.has(backendId);
  }

  // --- Content ---
  catchUpContent(backendId: string, sessionId: string, afterOffset: number): void {
    // v4: catch-up is served in-band on the message channel; the patch
    // comes back over the same channel.
    this.sendChannelFrame(backendId, {
      type: 'catch_up_content',
      backendId,
      contentStreamId: sessionId,
      afterOffset,
    } satisfies CatchUpContentMessage);
  }

  // --- Reconnect & Health ---

  /** Force an immediate reconnect, bypassing exponential backoff. */
  forceReconnect(): void {
    console.log('[GatewayTransport] Force reconnect requested');
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearHealthProbe();
    this.reconnectAttempt = 0;
    this.intentionalClose = false;
    this.connect();
  }

  /** Send an application-level ping to detect half-dead connections. */
  probeHealth(): void {
    if (!this.isConnected()) return;
    if (this.healthProbeTimeout) return; // Probe already in-flight
    this.send({ type: 'ping', ts: Date.now() });
    this.healthProbeTimeout = setTimeout(() => {
      this.healthProbeTimeout = null;
      console.warn('[GatewayTransport] Health probe timeout — closing stale connection');
      this.restartControlConnection('health probe timeout');
    }, 10_000);
  }

  private clearHealthProbe(): void {
    if (this.healthProbeTimeout) {
      clearTimeout(this.healthProbeTimeout);
      this.healthProbeTimeout = null;
    }
  }

  // --- Accessors ---
  getRegistryItems(): Map<string, BackendPresence> {
    return this.registryItems;
  }
  getPeerSessionId(): string | null {
    return this.peerSessionId;
  }
  getRecoveryToken(): string | null {
    return this.recoveryToken;
  }
  /** The actual WebSocket URL used in the last connect() call (after normalization). */
  getResolvedUrl(): string | null {
    return this.resolvedUrl;
  }

  /** Request an immediate full registry snapshot from the gateway (e.g. on mobile resume). */
  requestRegistrySnapshot(): void {
    this.send({ type: 'request_registry_snapshot' });
  }

  // ==========================================================================
  // Internal — WebSocket Setup
  // ==========================================================================

  private setupWebSocket(ws: WebSocket): void {
    const currentWs = ws;
    const generation = this.controlGeneration;
    this.armControlPhaseTimer(
      currentWs,
      generation,
      'control connect timeout',
      CONTROL_CONNECT_TIMEOUT_MS
    );
    ws.onopen = () => {
      console.log('[GatewayTransport] WebSocket opened');
      if (this.ws !== currentWs || generation !== this.controlGeneration) return;
      this.armControlPhaseTimer(
        currentWs,
        generation,
        'peer_ready handshake timeout',
        CONTROL_HANDSHAKE_TIMEOUT_MS
      );
      this.sendPeerHello();
    };
    ws.onclose = event => {
      console.log(
        `[GatewayTransport] WebSocket closed: code=${event.code} reason=${event.reason} wasClean=${event.wasClean}`
      );
      const expectedClose = this.expectedCloseWs === currentWs;
      if (expectedClose) {
        this.expectedCloseWs = null;
      }
      if (this.ws !== currentWs || generation !== this.controlGeneration) return;
      this.clearControlPhaseTimer();
      this.clearHealthProbe();
      this.ws = null;
      this.authenticated = false;
      this.closeAllMessageChannels();
      if (!expectedClose) {
        this.config.onDisconnected();
        this.subscribedBackends.clear();
        this.scheduleReconnect();
      } else {
        this.subscribedBackends.clear();
      }
    };
    ws.onerror = error => {
      if (this.ws !== currentWs || generation !== this.controlGeneration) return;
      console.error('[GatewayTransport] WebSocket error:', error);
      this.config.onError(error);
    };
    ws.onmessage = (event: MessageEvent) => {
      if (this.ws !== currentWs || generation !== this.controlGeneration) return;
      try {
        this.handleMessage(JSON.parse(event.data));
      } catch (error) {
        console.error('[GatewayTransport] Failed to parse message:', error);
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.intentionalClose) return;
    const base = 1000;
    const max = 30_000;
    const delay = Math.min(base * Math.pow(2, this.reconnectAttempt), max);
    // Add jitter: ±25% to prevent thundering herd
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    const finalDelay = Math.max(500, delay + jitter);
    this.reconnectAttempt++;
    console.log(
      `[GatewayTransport] Reconnecting in ${Math.round(finalDelay)}ms (attempt ${this.reconnectAttempt})`
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.intentionalClose && !this.ws) {
        this.connect();
      }
    }, finalDelay);
  }

  private sendPeerHello(): void {
    const msg: PeerHelloMessage = {
      type: 'peer_hello',
      protocolVersion: GATEWAY_PROTOCOL_V4,
      namespace: ZCLAUDIA_NAMESPACE,
      clientProtocolVersion: 1,
      peerType: 'client-only',
      gatewaySecret: this.config.gatewaySecret,
      identity: { deviceId: this.config.deviceId, instanceId: this.config.instanceId },
    };
    this.ws?.send(JSON.stringify(msg));
  }

  // ==========================================================================
  // Internal — Message Router
  // ==========================================================================

  private handleMessage(message: any): void {
    switch (message.type) {
      case 'peer_ready':
        this.handlePeerReady(message);
        break;
      case 'registry_snapshot':
        this.handleRegistrySnapshot(message);
        break;
      case 'topic_subscribed':
        this.handleTopicSubscribed(message);
        break;
      case 'topic_unsubscribed':
        this.handleTopicUnsubscribed(message);
        break;
      case 'topic_message':
        this.handleTopicMessage(message);
        break;
      // Fallback targeted path (used while a message channel reopens);
      // legacy gateway peers may still send these; v4 resource data and
      // content patches use topics/channels.
      case 'backend_server_message':
        this.handleBackendServerMessage(message);
        break;
      case 'channel_ready':
        this.handleChannelReady(message);
        break;
      case 'channel_closed':
        this.handleChannelClosed(message);
        break;
      case 'pong':
        this.handlePong(message);
        break;
      case 'gateway_error':
        this.handleGatewayError(message);
        break;
      default:
        console.warn('[GatewayTransport] Unknown message type:', message.type);
    }
  }

  // --- Handshake ---
  private handlePeerReady(msg: PeerReadyMessage): void {
    this.clearControlPhaseTimer();
    this.reconnectAttempt = 0;
    this.authenticated = true;
    this.peerSessionId = msg.peerSessionId;
    this.recoveryToken = msg.recoveryToken;
    this.applyRegistrySync(msg.registrySync);
    this.config.onConnected(msg.peerSessionId, msg.recoveryToken);
  }

  // --- Registry ---
  private applyRegistrySync(sync: PeerReadyMessage['registrySync']): void {
    this.applyRegistryItems(sync.items);
  }

  private handleRegistrySnapshot(msg: RegistrySnapshotMessage): void {
    this.applyRegistryItems(msg.items);
  }

  private applyRegistryItems(items: BackendPresence[]): void {
    // Detect removed backends, but keep business-store cleanup outside the transport layer.
    const newIds = new Set(items.map(i => i.backendId));
    const removedBackendIds: string[] = [];
    for (const [backendId] of this.registryItems) {
      if (!newIds.has(backendId)) {
        this.subscribedBackends.delete(backendId);
        this.closeMessageChannel(backendId);
        removedBackendIds.push(backendId);
      }
    }
    this.registryItems.clear();
    for (const item of items) this.registryItems.set(item.backendId, item);
    this.config.onRegistryChanged(Array.from(this.registryItems.values()));
    if (removedBackendIds.length > 0) {
      this.config.onBackendsRemoved?.(removedBackendIds);
    }
  }

  // --- Backend Data ---
  private handleBackendDataSnapshot(
    msg: BackendResourceSnapshotMessage & { backendId?: string }
  ): void {
    const backendId = msg.backendId;
    if (!backendId) {
      console.warn(
        '[GatewayTransport] Received backend_resource_snapshot without backendId, ignoring'
      );
      return;
    }
    const sessions = msg.resources
      .filter(resource => resource.resourceType === 'session')
      .map(resource => resource.resource as SessionItem);
    const projects = msg.resources
      .filter(resource => resource.resourceType === 'project')
      .map(resource => resource.resource as ProjectItem);
    this.config.onBackendDataSnapshot(backendId, sessions, projects);
  }

  private handleBackendDataEvent(msg: BackendResourceEventMessage & { backendId?: string }): void {
    const backendId = msg.backendId;
    if (!backendId) {
      console.warn(
        '[GatewayTransport] Received backend_resource_event without backendId, ignoring'
      );
      return;
    }
    this.config.onBackendDataEvent(backendId, msg);
  }

  // --- Backend Subscription (synthesized from topic + presence) ---
  private handleTopicSubscribed(msg: TopicSubscribedMessage): void {
    if (msg.topic !== RESOURCES_TOPIC) return;
    this.subscribedBackends.add(msg.backendId);
    const presence = this.registryItems.get(msg.backendId);
    this.pendingBackendReady.set(msg.backendId, {
      epoch: presence?.epoch ?? 0,
      capabilities: presence?.capabilities ?? [],
    });
    // The dedicated message channel opens alongside the subscription
    if (this.messageChannels.get(msg.backendId)?.ws.readyState === WebSocket.OPEN) {
      this.finishBackendSubscription(msg.backendId);
    } else {
      this.maybeOpenMessageChannel(msg.backendId);
    }
  }

  private handleTopicUnsubscribed(msg: TopicUnsubscribedMessage): void {
    if (msg.topic !== RESOURCES_TOPIC) return;
    this.subscribedBackends.delete(msg.backendId);
    this.closeMessageChannel(msg.backendId);
    this.config.onBackendUnsubscribed(msg.backendId, 'client_unsubscribed');
  }

  private handleTopicMessage(msg: TopicMessage): void {
    if (msg.topic !== RESOURCES_TOPIC) return;
    // Payloads are the exact v3 resource message shapes (see server-side
    // GatewayBackendDataPublisher); the authoritative backendId comes from
    // the topic envelope.
    const payload = msg.payload as { type?: string } | undefined;
    if (!payload) return;
    if (this.subscribedBackends.has(msg.backendId) && !this.backendChannelIsOpen(msg.backendId)) {
      let queue = this.pendingResourceMessages.get(msg.backendId);
      if (!queue) {
        queue = [];
        this.pendingResourceMessages.set(msg.backendId, queue);
      }
      if (queue.length >= MAX_PENDING_CHANNEL_FRAMES) {
        this.restartControlConnection(
          `resource messages overflow while channel opens: ${msg.backendId}`
        );
        return;
      }
      queue.push(payload as BackendResourceSnapshotMessage | BackendResourceEventMessage);
      return;
    }
    this.dispatchResourcePayload(msg.backendId, payload);
  }

  private dispatchResourcePayload(backendId: string, payload: { type?: string }): void {
    if (payload.type === 'backend_resource_snapshot') {
      this.handleBackendDataSnapshot({
        ...(payload as BackendResourceSnapshotMessage),
        backendId,
      });
    } else if (payload.type === 'backend_resource_event') {
      this.handleBackendDataEvent({
        ...(payload as BackendResourceEventMessage),
        backendId,
      });
    }
  }

  private handleBackendServerMessage(msg: BackendServerMessage): void {
    if (!this.subscribedBackends.has(msg.backendId)) return;
    this.config.onBackendServerMessage(msg.backendId, msg.message as ServerMessage);
  }

  // --- Protocol v4 message channels ---

  private isV4Backend(backendId: string): boolean {
    return this.registryItems.get(backendId)?.gatewayProtocolVersion === 4;
  }

  private maybeOpenMessageChannel(backendId: string): void {
    if (!this.isV4Backend(backendId)) return;
    if (this.messageChannels.has(backendId)) return;
    if ([...this.dialingChannels.values()].some(dialing => dialing.backendId === backendId)) return;
    if (this.pendingChannelOpens.includes(backendId)) return;
    this.pendingChannelOpens.push(backendId);
    this.pumpChannelOpens();
  }

  private pumpChannelOpens(): void {
    if (this.channelOpenInFlight || this.pendingChannelOpens.length === 0) return;
    if (!this.isConnected()) {
      this.pendingChannelOpens = [];
      return;
    }
    this.channelOpenInFlight = true;
    const backendId = this.pendingChannelOpens[0];
    this.send({ type: 'channel_open', target: backendId, kind: MESSAGE_CHANNEL_KIND });
    // channel_ready has no request id. Reset this control generation on timeout
    // so a delayed reply cannot be mistaken for the next backend's response.
    this.channelOpenTimer = setTimeout(
      () => this.restartControlConnection('channel_open timeout'),
      CHANNEL_OPEN_TIMEOUT_MS
    );
  }

  /** Consume the FIFO head after its channel_ready response. */
  private settleChannelOpen(): string | undefined {
    if (this.channelOpenTimer) {
      clearTimeout(this.channelOpenTimer);
      this.channelOpenTimer = null;
    }
    const backendId = this.pendingChannelOpens.shift();
    this.channelOpenInFlight = false;
    queueMicrotask(() => this.pumpChannelOpens());
    return backendId;
  }

  private handleChannelReady(msg: ChannelReadyMessage): void {
    const backendId = this.settleChannelOpen();
    if (!backendId) return;
    const base = (this.resolvedUrl ?? '').replace(/\/ws$/, '');
    const dataWs = new WebSocket(`${base}${msg.dataPath}?ticket=${encodeURIComponent(msg.ticket)}`);
    const generation = this.controlGeneration;
    const dialTimer = setTimeout(() => {
      if (this.dialingChannels.has(dataWs) && generation === this.controlGeneration) {
        this.restartControlConnection(`data channel open timeout: ${backendId}`);
      }
    }, DATA_CHANNEL_OPEN_TIMEOUT_MS);
    this.dialingChannels.set(dataWs, { backendId, generation, timer: dialTimer });
    dataWs.onopen = () => {
      const dialing = this.dialingChannels.get(dataWs);
      if (
        !dialing ||
        dialing.generation !== this.controlGeneration ||
        generation !== this.controlGeneration
      ) {
        dataWs.close();
        return;
      }
      clearTimeout(dialing.timer);
      this.dialingChannels.delete(dataWs);
      // The backend may have gone away while dialing
      if (!this.subscribedBackends.has(backendId)) {
        dataWs.close();
        return;
      }
      this.messageChannels.set(backendId, { channelId: msg.channelId, ws: dataWs });
      this.armDataChannelIdleTimeout(backendId, dataWs, generation);
      // Older backends register an incoming channel on its first business
      // frame. This harmless ping initializes them even for read-only users.
      dataWs.send(JSON.stringify({ type: 'ping' } satisfies ClientMessage));
      this.finishBackendSubscription(backendId);
      // Flush frames queued while the channel was (re)opening
      const queued = this.pendingChannelFrames.get(backendId);
      if (queued) {
        this.pendingChannelFrames.delete(backendId);
        for (const frame of queued) dataWs.send(frame);
      }
    };
    dataWs.onmessage = (event: MessageEvent) => {
      if (
        generation !== this.controlGeneration ||
        this.messageChannels.get(backendId)?.ws !== dataWs ||
        !this.subscribedBackends.has(backendId)
      )
        return;
      this.armDataChannelIdleTimeout(backendId, dataWs, generation);
      if (typeof event.data !== 'string') return;
      try {
        this.routeChannelFrame(backendId, JSON.parse(event.data));
      } catch (error) {
        console.error('[GatewayTransport] Failed to parse channel message:', error);
      }
    };
    dataWs.onclose = () => {
      const dialing = this.dialingChannels.get(dataWs);
      if (dialing) {
        clearTimeout(dialing.timer);
        this.dialingChannels.delete(dataWs);
        if (generation === this.controlGeneration && this.subscribedBackends.has(backendId)) {
          this.restartControlConnection(`data channel closed while dialing: ${backendId}`);
        }
        return;
      }
      const current = this.messageChannels.get(backendId);
      if (current?.ws === dataWs && generation === this.controlGeneration) {
        this.clearDataChannelIdleTimeout(dataWs);
        this.messageChannels.delete(backendId);
        if (this.subscribedBackends.has(backendId)) {
          this.restartControlConnection(`data channel closed: ${backendId}`);
        }
      }
    };
    dataWs.onerror = () => {
      // onclose follows; nothing to do here
    };
  }

  /** Route an inbound message-channel frame: catch-up replies to the content
   *  callbacks, everything else is a backend server message. */
  private routeChannelFrame(backendId: string, frame: { type?: string }): void {
    if (frame.type === 'content_patch') {
      const patch = frame as ContentPatchMessage;
      this.config.onContentPatch(
        backendId,
        patch.contentStreamId,
        patch.patches as SessionMessage[],
        patch.latestOffset
      );
      return;
    }
    if (frame.type === 'content_patch_error') {
      const err = frame as ContentPatchErrorMessage;
      this.config.onContentPatchError(backendId, err.contentStreamId, err.afterOffset, err.message);
      return;
    }
    this.config.onBackendServerMessage(backendId, frame as ServerMessage);
  }

  private handleChannelClosed(msg: ChannelClosedMessage): void {
    for (const [backendId, channel] of this.messageChannels) {
      if (channel.channelId === msg.channelId) {
        this.messageChannels.delete(backendId);
        channel.ws.close();
        if (this.subscribedBackends.has(backendId)) {
          this.restartControlConnection(`gateway closed data channel: ${backendId}`);
        }
        break;
      }
    }
  }

  private closeMessageChannel(backendId: string): void {
    const channel = this.messageChannels.get(backendId);
    if (channel) {
      this.messageChannels.delete(backendId);
      this.clearDataChannelIdleTimeout(channel.ws);
      channel.ws.close();
    }
    for (const [ws, dialing] of this.dialingChannels) {
      if (dialing.backendId !== backendId) continue;
      clearTimeout(dialing.timer);
      this.dialingChannels.delete(ws);
      ws.close();
    }
    if (this.channelOpenInFlight && this.pendingChannelOpens[0] === backendId) {
      this.restartControlConnection(`channel_open cancelled: ${backendId}`);
      return;
    }
    this.pendingChannelOpens = this.pendingChannelOpens.filter(id => id !== backendId);
    this.pendingChannelFrames.delete(backendId);
    this.pendingBackendReady.delete(backendId);
    this.pendingResourceMessages.delete(backendId);
  }

  private closeAllMessageChannels(): void {
    for (const channel of this.messageChannels.values()) {
      this.clearDataChannelIdleTimeout(channel.ws);
      channel.ws.close();
    }
    this.messageChannels.clear();
    for (const [ws, dialing] of this.dialingChannels) {
      clearTimeout(dialing.timer);
      ws.close();
    }
    this.dialingChannels.clear();
    this.pendingChannelOpens = [];
    this.pendingChannelFrames.clear();
    this.pendingBackendReady.clear();
    this.pendingResourceMessages.clear();
    this.channelOpenInFlight = false;
    if (this.channelOpenTimer) {
      clearTimeout(this.channelOpenTimer);
      this.channelOpenTimer = null;
    }
  }

  // --- Pong ---
  private handlePong(_msg: { ts: number }): void {
    this.clearHealthProbe();
  }

  // --- Error ---
  private handleGatewayError(msg: GatewayErrorMessage): void {
    console.error(`[GatewayTransport] Error: ${msg.code} — ${msg.message}`);
    // A failed channel_open answers with BACKEND_OFFLINE / RATE_LIMITED and
    // no request id, so reset the connection to keep the FIFO response mapping
    // unambiguous for the next channel_open.
    if (
      this.channelOpenInFlight &&
      (msg.code === 'BACKEND_OFFLINE' || msg.code === 'RATE_LIMITED')
    ) {
      this.restartControlConnection(`channel_open failed: ${msg.code}`);
      return;
    }
    if (msg.recovery) {
      switch (msg.recovery) {
        case 'resubscribe': {
          const staleBackends = [...this.subscribedBackends];
          this.subscribedBackends.clear();
          for (const backendId of staleBackends) {
            this.subscribe(backendId);
          }
          break;
        }
        case 'reconnect':
          this.ws?.close();
          break;
      }
      // Recovery action was taken — don't escalate to a connection-level error.
      // Only log it for diagnostics.
      return;
    }
    this.config.onError(`${msg.code}: ${msg.message}`);
  }

  // --- Helpers ---
  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
  private cleanup(): void {
    this.clearControlPhaseTimer();
    this.authenticated = false;
    this.peerSessionId = null;
    this.recoveryToken = null;
    this.subscribedBackends.clear();
    this.closeAllMessageChannels();
    this.clearHealthProbe();
  }

  private backendChannelIsOpen(backendId: string): boolean {
    return this.messageChannels.get(backendId)?.ws.readyState === WebSocket.OPEN;
  }

  private finishBackendSubscription(backendId: string): void {
    if (!this.backendChannelIsOpen(backendId)) return;
    const ready = this.pendingBackendReady.get(backendId);
    if (ready) {
      this.pendingBackendReady.delete(backendId);
      this.config.onBackendSubscribed(backendId, ready.epoch, ready.capabilities);
    }
    const queued = this.pendingResourceMessages.get(backendId);
    if (queued) {
      this.pendingResourceMessages.delete(backendId);
      for (const payload of queued) this.dispatchResourcePayload(backendId, payload);
    }
  }

  private armDataChannelIdleTimeout(backendId: string, ws: WebSocket, generation: number): void {
    this.clearDataChannelIdleTimeout(ws);
    this.dataChannelIdleTimers.set(
      ws,
      setTimeout(() => {
        this.dataChannelIdleTimers.delete(ws);
        if (
          generation === this.controlGeneration &&
          this.messageChannels.get(backendId)?.ws === ws &&
          this.subscribedBackends.has(backendId)
        ) {
          this.restartControlConnection(`data channel idle timeout: ${backendId}`);
        }
      }, DATA_CHANNEL_IDLE_TIMEOUT_MS)
    );
  }

  private clearDataChannelIdleTimeout(ws: WebSocket): void {
    const timer = this.dataChannelIdleTimers.get(ws);
    if (timer) clearTimeout(timer);
    this.dataChannelIdleTimers.delete(ws);
  }

  private armControlPhaseTimer(
    ws: WebSocket,
    generation: number,
    reason: string,
    timeoutMs: number
  ): void {
    this.clearControlPhaseTimer();
    this.controlPhaseTimer = setTimeout(() => {
      this.controlPhaseTimer = null;
      if (this.ws === ws && generation === this.controlGeneration) {
        this.restartControlConnection(reason);
      }
    }, timeoutMs);
  }

  private clearControlPhaseTimer(): void {
    if (this.controlPhaseTimer) clearTimeout(this.controlPhaseTimer);
    this.controlPhaseTimer = null;
  }

  /** Invalidate this control generation immediately, then use the normal
   * reconnect backoff so channel failures cannot create a retry hot loop. */
  private restartControlConnection(reason: string): void {
    const ws = this.ws;
    if (!ws || this.intentionalClose) return;
    console.warn(`[GatewayTransport] Resetting control connection: ${reason}`);
    this.expectedCloseWs = ws;
    this.ws = null;
    this.controlGeneration++;
    this.clearControlPhaseTimer();
    this.clearHealthProbe();
    this.authenticated = false;
    this.peerSessionId = null;
    this.recoveryToken = null;
    this.closeAllMessageChannels();
    this.config.onDisconnected();
    this.subscribedBackends.clear();
    ws.close(4001, reason);
    this.scheduleReconnect();
  }
}
