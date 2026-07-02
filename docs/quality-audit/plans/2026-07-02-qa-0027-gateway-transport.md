# GatewayTransport Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the socket lifecycle + reconnect/backoff + offline send queue out of `GatewayClient` into a standalone, tested `GatewayTransport`, behaviour-preserving.

**Architecture:** New `gateway-transport.ts` owns the `ws`, reconnect/backoff timers, connect-timeout, and offline queue, using the injected-deps pattern (like `GatewayHeartbeat`). `GatewayClient` keeps `cleanup()`, `isConnected`, and handshake; it holds a `GatewayTransport` and collaborates through callbacks (`onOpen`/`onMessage`/`onDisconnect`) and queries (`isConnected`).

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import specifiers), Vitest with a mocked `ws` module.

## Global Constraints

- Behaviour-preserving refactor — no protocol/timing changes. Message send **ordering** must be preserved.
- Import specifiers use `.js` extension (e.g. `'./gateway-transport.js'`).
- Keep gates green: `prettier --write` touched files; `eslint` 0 errors on touched files; server `tsc --noEmit` clean.
- Verify with the project Node wrapper: `bash scripts/with-project-node.sh pnpm --filter @zclaudia/server exec …`.
- Work on branch `quality-audit/remaining-open`; one commit per task.
- No `cargo`/live gateway in this env; tests use the mocked `ws` module already present in the gateway test suite.

---

### Task 1: Create `GatewayTransport` module with tests

**Files:**
- Create: `server/src/infra/gateway/gateway-transport.ts`
- Test: `server/src/infra/gateway/__tests__/gateway-transport.test.ts`

**Interfaces:**
- Consumes: `ws` (mocked in tests), `socks-proxy-agent` type only.
- Produces (relied on by Task 2):
  - `interface GatewayTransportDeps { resolveWsUrl(): string; createAgent(): SocksProxyAgent | undefined; isConnected(): boolean; onOpen(): void; onMessage(parsed: Record<string, unknown>): void; onDisconnect(code: number | null): void; }`
  - `class GatewayTransport` with: `constructor(deps: GatewayTransportDeps)`, `connect(): void`, `disconnect(): void`, `send(data: unknown, queueIfOffline?: boolean): void`, `flushQueue(): void`, `notifyHandshakeComplete(): void`, `hasSocket(): boolean`.

- [ ] **Step 1: Write the failing test**

Create `server/src/infra/gateway/__tests__/gateway-transport.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { GatewayTransport, type GatewayTransportDeps } from '../gateway-transport.js';

vi.mock('ws', () => {
  const MockWebSocket = vi.fn().mockImplementation(function (this: any) {
    this.on = vi.fn();
    this.removeAllListeners = vi.fn();
    this.close = vi.fn();
    this.send = vi.fn();
    this.readyState = 1;
  });
  (MockWebSocket as any).OPEN = 1;
  (MockWebSocket as any).CLOSED = 0;
  return { default: MockWebSocket };
});

function makeDeps(overrides: Partial<GatewayTransportDeps> = {}): GatewayTransportDeps {
  return {
    resolveWsUrl: () => 'ws://gateway.example.com/ws',
    createAgent: () => undefined,
    isConnected: () => false,
    onOpen: vi.fn(),
    onMessage: vi.fn(),
    onDisconnect: vi.fn(),
    ...overrides,
  };
}

function handlerFor(ws: any, event: string): (...args: any[]) => void {
  return ws.on.mock.calls.find((c: any[]) => c[0] === event)?.[1];
}

describe('GatewayTransport', () => {
  let transport: GatewayTransport;

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('connect', () => {
    it('creates a WebSocket to the resolved url and wires handlers', () => {
      transport = new GatewayTransport(makeDeps());
      transport.connect();
      expect(WebSocket).toHaveBeenCalledWith('ws://gateway.example.com/ws', expect.any(Object));
      const ws = (transport as any).ws;
      expect(handlerFor(ws, 'open')).toBeTypeOf('function');
      expect(handlerFor(ws, 'message')).toBeTypeOf('function');
      expect(handlerFor(ws, 'close')).toBeTypeOf('function');
      expect(handlerFor(ws, 'error')).toBeTypeOf('function');
    });

    it('closes an existing socket before reconnecting', () => {
      transport = new GatewayTransport(makeDeps());
      const mockWs = { removeAllListeners: vi.fn(), close: vi.fn() };
      (transport as any).ws = mockWs;
      transport.connect();
      expect(mockWs.removeAllListeners).toHaveBeenCalled();
      expect(mockWs.close).toHaveBeenCalled();
    });

    it('invokes onOpen when the socket opens', () => {
      const onOpen = vi.fn();
      transport = new GatewayTransport(makeDeps({ onOpen }));
      transport.connect();
      handlerFor((transport as any).ws, 'open')();
      expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('parses and forwards messages to onMessage', () => {
      const onMessage = vi.fn();
      transport = new GatewayTransport(makeDeps({ onMessage }));
      transport.connect();
      handlerFor((transport as any).ws, 'message')(Buffer.from(JSON.stringify({ type: 'x' })));
      expect(onMessage).toHaveBeenCalledWith({ type: 'x' });
    });
  });

  describe('reconnect', () => {
    beforeEach(() => vi.useFakeTimers());

    it('schedules reconnect with an incremented attempt on close (code != 4000)', () => {
      const onDisconnect = vi.fn();
      transport = new GatewayTransport(makeDeps({ onDisconnect }));
      transport.connect();
      handlerFor((transport as any).ws, 'close')(1000);
      expect(onDisconnect).toHaveBeenCalledWith(1000);
      expect((transport as any).reconnectTimeout).not.toBeNull();
      expect((transport as any).reconnectAttempts).toBe(1);
    });

    it('does not reconnect on close code 4000', () => {
      transport = new GatewayTransport(makeDeps());
      transport.connect();
      handlerFor((transport as any).ws, 'close')(4000);
      expect((transport as any).reconnectTimeout).toBeNull();
    });

    it('schedules reconnect on error', () => {
      const onDisconnect = vi.fn();
      transport = new GatewayTransport(makeDeps({ onDisconnect }));
      transport.connect();
      handlerFor((transport as any).ws, 'error')(new Error('boom'));
      expect(onDisconnect).toHaveBeenCalledWith(null);
      expect((transport as any).reconnectTimeout).not.toBeNull();
    });

    it('aborts + reconnects on connect-timeout only when not connected', () => {
      transport = new GatewayTransport(makeDeps({ isConnected: () => false }));
      transport.connect();
      vi.advanceTimersByTime((transport as any).connectTimeoutMs);
      expect((transport as any).reconnectTimeout).not.toBeNull();
    });

    it('does not abort on connect-timeout when already connected', () => {
      transport = new GatewayTransport(makeDeps({ isConnected: () => true }));
      transport.connect();
      vi.advanceTimersByTime((transport as any).connectTimeoutMs);
      expect((transport as any).reconnectTimeout).toBeNull();
    });

    it('does not reconnect after intentional disconnect', () => {
      transport = new GatewayTransport(makeDeps());
      transport.connect();
      const close = handlerFor((transport as any).ws, 'close');
      transport.disconnect();
      close?.(1000);
      expect((transport as any).reconnectTimeout).toBeNull();
    });

    it('caps the backoff interval at the max', () => {
      transport = new GatewayTransport(makeDeps());
      (transport as any).reconnectAttempts = 10;
      (transport as any).scheduleReconnect();
      expect((transport as any).reconnectMaxInterval).toBe(60000);
    });
  });

  describe('disconnect', () => {
    it('sets intentional disconnect, notifies, and closes the socket', () => {
      const onDisconnect = vi.fn();
      transport = new GatewayTransport(makeDeps({ onDisconnect }));
      const mockWs = { removeAllListeners: vi.fn(), close: vi.fn() };
      (transport as any).ws = mockWs;
      transport.disconnect();
      expect((transport as any).intentionalDisconnect).toBe(true);
      expect(onDisconnect).toHaveBeenCalledWith(null);
      expect(mockWs.removeAllListeners).toHaveBeenCalled();
      expect(mockWs.close).toHaveBeenCalled();
    });
  });

  describe('send + queue', () => {
    it('sends immediately when the socket is OPEN', () => {
      transport = new GatewayTransport(makeDeps());
      transport.connect();
      const ws = (transport as any).ws;
      ws.readyState = 1;
      transport.send({ a: 1 });
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ a: 1 }));
    });

    it('drops the message when offline and not queueing', () => {
      transport = new GatewayTransport(makeDeps());
      transport.connect();
      const ws = (transport as any).ws;
      ws.readyState = 0;
      transport.send({ a: 1 });
      expect(ws.send).not.toHaveBeenCalled();
      expect((transport as any).pendingMessages).toHaveLength(0);
    });

    it('queues when offline with queueIfOffline and flushes on flushQueue', () => {
      transport = new GatewayTransport(makeDeps());
      transport.connect();
      const ws = (transport as any).ws;
      ws.readyState = 0;
      transport.send({ a: 1 }, true);
      expect((transport as any).pendingMessages).toHaveLength(1);
      ws.readyState = 1;
      transport.flushQueue();
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ a: 1 }));
      expect((transport as any).pendingMessages).toHaveLength(0);
    });

    it('drops the oldest queued message past the 200 cap', () => {
      transport = new GatewayTransport(makeDeps());
      transport.connect();
      (transport as any).ws.readyState = 0;
      for (let i = 0; i < 205; i++) transport.send({ i }, true);
      expect((transport as any).pendingMessages).toHaveLength(200);
      expect((transport as any).pendingMessages[0]).toBe(JSON.stringify({ i: 5 }));
    });
  });

  describe('notifyHandshakeComplete', () => {
    it('clears the connect timeout and resets reconnect attempts', () => {
      vi.useFakeTimers();
      transport = new GatewayTransport(makeDeps());
      transport.connect();
      (transport as any).reconnectAttempts = 3;
      transport.notifyHandshakeComplete();
      expect((transport as any).connectTimeout).toBeNull();
      expect((transport as any).reconnectAttempts).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/with-project-node.sh pnpm --filter @zclaudia/server exec vitest run src/infra/gateway/__tests__/gateway-transport.test.ts`
Expected: FAIL — cannot resolve `../gateway-transport.js`.

- [ ] **Step 3: Implement `gateway-transport.ts`**

Create `server/src/infra/gateway/gateway-transport.ts`:

```ts
// Socket lifecycle + reconnect/backoff + offline send queue for the gateway client.
// Extracted from GatewayClient (QA-0027) as a standalone, injected-deps unit; session
// teardown (cleanup), isConnected and handshake stay in GatewayClient and are reached
// through the callbacks/queries below.
import WebSocket from 'ws';
import type { SocksProxyAgent } from 'socks-proxy-agent';

export interface GatewayTransportDeps {
  /** Full ws URL to connect to, e.g. ws://host/ws. */
  resolveWsUrl: () => string;
  /** Optional SOCKS proxy agent for the socket. */
  createAgent: () => SocksProxyAgent | undefined;
  /** Handshake-complete flag; used by the connect-timeout guard. */
  isConnected: () => boolean;
  /** Fired when the socket opens (client sends peer hello). */
  onOpen: () => void;
  /** Fired for each parsed inbound message. */
  onMessage: (parsed: Record<string, unknown>) => void;
  /** Fired on close/error/timeout so the client can run session teardown. */
  onDisconnect: (code: number | null) => void;
}

export class GatewayTransport {
  private static readonly MAX_PENDING_MESSAGES = 200;

  private ws: WebSocket | null = null;
  private intentionalDisconnect = false;
  private reconnectAttempts = 0;
  private reconnectBaseInterval = 5000;
  private reconnectMaxInterval = 60000;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private connectTimeout: NodeJS.Timeout | null = null;
  private connectTimeoutMs = 15000;
  private pendingMessages: string[] = [];

  constructor(private readonly deps: GatewayTransportDeps) {}

  connect(): void {
    this.intentionalDisconnect = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.clearConnectTimeout();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    const wsUrl = this.deps.resolveWsUrl();
    console.log(`[Gateway] Connecting to ${wsUrl}...`);

    const wsOptions: { agent?: SocksProxyAgent } = {};
    const proxyAgent = this.deps.createAgent();
    if (proxyAgent) wsOptions.agent = proxyAgent;

    this.ws = new WebSocket(wsUrl, wsOptions);
    const currentWs = this.ws;

    this.connectTimeout = setTimeout(() => {
      if (this.ws !== currentWs || this.deps.isConnected()) return;
      console.warn(`[Gateway] Connection attempt timed out after ${this.connectTimeoutMs / 1000}s`);
      currentWs.removeAllListeners();
      currentWs.close();
      if (this.ws === currentWs) this.ws = null;
      this.deps.onDisconnect(null);
      this.scheduleReconnect();
    }, this.connectTimeoutMs);

    this.ws.on('open', () => {
      if (this.ws !== currentWs) return;
      this.deps.onOpen();
    });
    this.ws.on('message', (data: Buffer) => {
      if (this.ws !== currentWs) return;
      try {
        this.deps.onMessage(JSON.parse(data.toString()));
      } catch (error) {
        console.error('[Gateway] Failed to parse message:', error);
      }
    });
    this.ws.on('close', (code: number) => {
      if (this.ws !== currentWs) return;
      this.clearConnectTimeout();
      console.log(`[Gateway] Disconnected (code: ${code})`);
      this.deps.onDisconnect(code);
      if (code !== 4000) this.scheduleReconnect();
    });
    this.ws.on('error', error => {
      if (this.ws !== currentWs) return;
      this.clearConnectTimeout();
      console.error('[Gateway] Connection error:', error);
      this.deps.onDisconnect(null);
      this.scheduleReconnect();
    });
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.clearConnectTimeout();
    this.deps.onDisconnect(null);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  /** True when a socket object currently exists (mirrors the old `!!this.ws` guard). */
  hasSocket(): boolean {
    return this.ws !== null;
  }

  send(data: unknown, queueIfOffline = false): void {
    const json = JSON.stringify(data);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(json);
    } else if (queueIfOffline) {
      if (this.pendingMessages.length >= GatewayTransport.MAX_PENDING_MESSAGES) {
        this.pendingMessages.shift(); // drop oldest
      }
      this.pendingMessages.push(json);
    }
  }

  flushQueue(): void {
    if (this.pendingMessages.length === 0) return;
    const msgs = this.pendingMessages.splice(0);
    for (const json of msgs) {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(json);
      }
    }
  }

  /** Called after a successful handshake: stop the connect timeout and reset backoff. */
  notifyHandshakeComplete(): void {
    this.clearConnectTimeout();
    this.reconnectAttempts = 0;
  }

  private clearConnectTimeout(): void {
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionalDisconnect || this.reconnectTimeout) return;
    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectBaseInterval * Math.pow(2, this.reconnectAttempts - 1),
      this.reconnectMaxInterval
    );
    console.log(`[Gateway] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/with-project-node.sh pnpm --filter @zclaudia/server exec vitest run src/infra/gateway/__tests__/gateway-transport.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + gates**

Run:
```bash
bash scripts/with-project-node.sh pnpm --filter @zclaudia/server exec tsc --noEmit
bash scripts/with-project-node.sh pnpm exec prettier --write server/src/infra/gateway/gateway-transport.ts server/src/infra/gateway/__tests__/gateway-transport.test.ts
bash scripts/with-project-node.sh pnpm exec eslint server/src/infra/gateway/gateway-transport.ts
```
Expected: tsc clean; eslint 0 errors.

- [ ] **Step 6: Commit**

```bash
git add server/src/infra/gateway/gateway-transport.ts server/src/infra/gateway/__tests__/gateway-transport.test.ts
git commit -m "feat(gateway): add GatewayTransport (socket + reconnect + queue) (QA-0027)"
```

---

### Task 2: Wire `GatewayClient` to `GatewayTransport` and migrate tests

**Files:**
- Modify: `server/src/infra/gateway/gateway-client.ts`
- Modify: `server/src/infra/gateway/__tests__/gateway-client.test.ts`

**Interfaces:**
- Consumes: `GatewayTransport`, `GatewayTransportDeps` from Task 1.
- Produces: `GatewayClient` public API unchanged (`connect()`, `disconnect()`, CQE facade behave identically).

- [ ] **Step 1: Add the import**

In `gateway-client.ts`, next to the other `./gateway-*` imports, add:

```ts
import { GatewayTransport } from './gateway-transport.js';
```

- [ ] **Step 2: Replace the transport fields with a GatewayTransport instance**

Remove these field declarations:

```ts
  private ws: WebSocket | null = null;
```
```ts
  private intentionalDisconnect = false;

  private reconnectAttempts = 0;
  private reconnectBaseInterval = 5000;
  private reconnectMaxInterval = 60000;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private connectTimeout: NodeJS.Timeout | null = null;
  private connectTimeoutMs = 15000;
```
```ts
  private static readonly MAX_PENDING_MESSAGES = 200;
  private pendingMessages: string[] = [];
```

Add a `transport` field alongside the existing `heartbeat` field (arrow deps read `this` lazily, so referencing `this.config`/`this.isConnected` before the constructor body runs is safe — same pattern as `heartbeat`):

```ts
  private readonly transport = new GatewayTransport({
    resolveWsUrl: () => `${this.config.gatewayUrl.replace(/^http/, 'ws')}/ws`,
    createAgent: () =>
      createSocksProxyAgent(this.config, {
        failureMessage: '[Gateway] Failed to configure proxy:',
      }),
    isConnected: () => this.isConnected,
    onOpen: () => this.sendPeerHello(),
    onMessage: msg => this.handleMessage(msg),
    onDisconnect: () => this.cleanup(),
  });
```

- [ ] **Step 3: Replace `connect()` and `disconnect()` with thin delegators**

Replace the whole `connect(): void { … }` method body (the one that constructs the WebSocket) with:

```ts
  connect(): void {
    this.transport.connect();
  }
```

Replace the whole `disconnect(): void { … }` method with:

```ts
  disconnect(): void {
    this.transport.disconnect();
  }
```

- [ ] **Step 4: Delete the moved helper methods**

Delete these three methods from `gateway-client.ts` (now owned by the transport): `private sendWs(...)`, `private flushPendingMessages()`, `private clearConnectTimeout()`, and `private scheduleReconnect()`.

- [ ] **Step 5: Redirect the heartbeat `canSend` dep**

In the `heartbeat` field initializer, change:

```ts
    canSend: () => !!this.ws && this.isConnected,
```
to:
```ts
    canSend: () => this.transport.hasSocket() && this.isConnected,
```

- [ ] **Step 6: Redirect all senders to `transport.send`**

Replace every `this.sendWs(` call with `this.transport.send(` in `gateway-client.ts`. These occur in: the `GatewayBackendDataPublisher` `sendMessage` dep, the HTTP-proxy `sendWs` dep, `emitRunStreamEvent`, `broadcastSessionEvent`/`broadcastProjectEvent`, `catchUpOutgoingStream`, and the content-patch handlers. Example — the publisher dep:

```ts
      sendMessage: message => this.transport.send(message),
```

and the HTTP-proxy dep:

```ts
        sendWs: data => this.transport.send(data),
```

(The local key stays `sendWs` — it is the http-proxy dep name — only its value changes.)

- [ ] **Step 7: Replace the `this.ws` guards with `this.transport.hasSocket()`**

In each send/broadcast/emit guard of the form `if (!this.ws || !this.isConnected …) return;`, replace `!this.ws` with `!this.transport.hasSocket()`. These guards are in: `subscribeBackend`, `unsubscribeBackend`, `sendToBackend`, `catchUpOutgoingStream`, `broadcastSessionEvent`, `broadcastProjectEvent`, `emitRunStreamEvent`, the stream-demand-gated emitter, and `sendToChannel`. Example:

```ts
    if (!this.transport.hasSocket() || !this.isConnected) return;
```

- [ ] **Step 8: Rewrite `sendPeerHello` to use `transport.send`**

Replace the guard + direct `this.ws.send(...)` in `sendPeerHello` (transport.send is a no-op when the socket is not OPEN, matching the old guard):

```ts
  private sendPeerHello(): void {
    const msg: PeerHelloMessage = {
      type: 'peer_hello',
      protocolVersion: 3,
      namespace: this.config.namespace ?? 'zclaudia',
      clientProtocolVersion: this.config.clientProtocolVersion ?? 1,
      peerType: 'client+backend',
      gatewaySecret: this.config.gatewaySecret,
      identity: {
        deviceId: this.deviceId,
        instanceId: this.instanceId,
        channel: this.channel,
        name: this.config.name,
      },
      backend: {
        visible: this.config.visible !== false,
        capabilities: this.config.capabilities ?? [],
        backendProtocolVersion: this.config.backendProtocolVersion ?? 1,
        minClientProtocolVersion: 1,
      },
    };
    this.transport.send(msg);
  }
```

- [ ] **Step 9: Update `handlePeerReady` to use the transport**

In `handlePeerReady`, replace the first line `this.clearConnectTimeout();` with `this.transport.notifyHandshakeComplete();`, delete the `this.reconnectAttempts = 0;` line, and replace `this.flushPendingMessages();` with `this.transport.flushQueue();` (keep `flushQueue` at its original position after `startBackendDataPush()` to preserve send ordering). Result:

```ts
  private handlePeerReady(msg: PeerReadyMessage): void {
    this.transport.notifyHandshakeComplete();
    this.isConnected = true;
    this.peerSessionId = msg.peerSessionId;
    this.recoveryToken = msg.recoveryToken;
    if (msg.backend) {
      this.backendId = msg.backend.backendId;
      this.epoch = msg.backend.epoch;
      console.log(
        `[Gateway] Connected: peerSessionId=${this.peerSessionId} backendId=${this.backendId} epoch=${this.epoch}`
      );
    } else {
      console.log(`[Gateway] Connected: peerSessionId=${this.peerSessionId} (no backend)`);
    }
    this.applyRegistrySync(msg.registrySync);
    this.heartbeat.start();
    this.publishBackendDataSnapshot();
    this.startBackendDataPush();
    this.transport.flushQueue();
    this.outgoingEvents.onConnectionStateChanged?.(true);
  }
```

- [ ] **Step 10: Remove now-unused imports**

If `WebSocket` (from `'ws'`) is no longer referenced in `gateway-client.ts` after the edits, remove `import WebSocket from 'ws';`. Confirm with `grep -n "WebSocket" server/src/infra/gateway/gateway-client.ts` — if the only hits were the removed code, delete the import. (Keep `SocksProxyAgent` type import: still used by `createHttpAgent`.)

- [ ] **Step 11: Migrate the client's transport-coupled tests**

In `gateway-client.test.ts`, delete the cases that poke the now-moved private fields — they are covered by `gateway-transport.test.ts`:
- In `describe('connect', …)`: delete `it('clears pending reconnect timeout', …)` and `it('closes existing WebSocket before reconnecting', …)`.
- In `describe('disconnect', …)`: delete `it('sets intentional disconnect flag', …)` and `it('clears reconnect timeout', …)` and `it('closes WebSocket connection', …)`. Keep `it('clears connection state', …)` (it exercises `disconnect()` → `cleanup()` end-to-end and still passes).
- Delete the entire `describe('reconnection logic', …)` block (all five cases moved to the transport test).
- Keep `describe('connect', …)`'s `it('creates WebSocket connection to gateway URL', …)`, `it('configures SOCKS5 proxy if provided', …)`, and `it('adds proxy authentication to URL', …)` — they call `client.connect()` which now delegates to the transport and still constructs the WebSocket.

- [ ] **Step 12: Run the full gateway suite**

Run: `bash scripts/with-project-node.sh pnpm --filter @zclaudia/server exec vitest run src/infra/gateway`
Expected: PASS (all files, including `gateway-transport.test.ts` and the trimmed `gateway-client.test.ts`).

- [ ] **Step 13: Typecheck + gates**

Run:
```bash
bash scripts/with-project-node.sh pnpm --filter @zclaudia/server exec tsc --noEmit
bash scripts/with-project-node.sh pnpm exec prettier --write server/src/infra/gateway/gateway-client.ts server/src/infra/gateway/__tests__/gateway-client.test.ts
bash scripts/with-project-node.sh pnpm exec eslint server/src/infra/gateway/gateway-client.ts
```
Expected: tsc clean; eslint 0 errors.

- [ ] **Step 14: Update findings note + commit**

Update `docs/quality-audit/findings.json` QA-0027 `verificationNote` to mention the `GatewayTransport` extraction and the new line count (`wc -l server/src/infra/gateway/gateway-client.ts`), then:

```bash
bash scripts/with-project-node.sh pnpm exec prettier --write docs/quality-audit/findings.json
git add server/src/infra/gateway docs/quality-audit/findings.json
git commit -m "refactor(gateway): route GatewayClient through GatewayTransport (QA-0027)"
```

---

## Self-Review

**Spec coverage:** State ownership, deps interface, public API (`connect/disconnect/send/flushQueue` + the two additions `notifyHandshakeComplete`/`hasSocket` needed for `handlePeerReady` and the heartbeat/send guards), behaviour-preservation (stale-socket guard, reconnect policy incl. code 4000, connect-timeout via `isConnected()`, disconnect ordering, send/queue semantics), client changes (delegators, sender redirection, `handlePeerReady`), and test strategy (new transport test + migration) are all covered by Tasks 1–2.

**Deviations from the spec (intentional refinements, same approach):** the spec's "remove connect/disconnect" is realized as thin **delegators** to preserve the public API and CQE wiring; and two small transport methods (`hasSocket()`, `notifyHandshakeComplete()`) were added to cover the `this.ws` guards and `handlePeerReady`'s connect-timeout/backoff reset that the spec's deps list did not enumerate. Send ordering is preserved by keeping `flushQueue()` at its original position in `handlePeerReady`.

**Placeholder scan:** none — all steps carry concrete code/commands.

**Type consistency:** `GatewayTransportDeps` and the `GatewayTransport` method names/signatures used in Task 2 match Task 1 exactly (`connect`, `disconnect`, `send(data, queueIfOffline?)`, `flushQueue`, `notifyHandshakeComplete`, `hasSocket`).
