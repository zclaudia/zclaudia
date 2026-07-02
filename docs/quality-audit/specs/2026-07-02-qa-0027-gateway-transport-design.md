# QA-0027 — Extract `GatewayTransport` from `gateway-client.ts`

Date: 2026-07-02
Finding: QA-0027 (gateway-client.ts too broad). See `docs/quality-audit/findings.json`.

## Context

`server/src/infra/gateway/gateway-client.ts` (~1055 lines) combines many responsibilities.
Prior steps already extracted HTTP proxy (`gateway-http-proxy.ts`), device identity
(`gateway-device-id.ts`), and the heartbeat timer (`gateway-heartbeat.ts`), each as a
standalone unit with injected dependencies and its own tests.

This spec covers the **next** decomposition step: the transport/connection layer.

## Goal & success criteria

- **Success = cohesive, independently testable responsibility.** The transport concern becomes
  its own unit with a clear interface and unit tests; `GatewayClient` moves toward a coordinator.
  Line count is not the target.
- Behaviour-preserving: existing server tests must keep passing (no live gateway in this env; the
  suite uses a mock `ws`).

## Chosen approach (A)

`GatewayTransport` owns the socket lifecycle + reconnect/backoff + offline send queue. Session
teardown (`cleanup()`), handshake, and the `isConnected` (handshake-complete) flag stay in
`GatewayClient`; the two collaborate through injected callbacks. This keeps the bug-prone
reconnect/backoff and queue logic in a testable unit while leaving the cross-cutting `cleanup()`
in the client, which is the lowest-risk way to preserve behaviour.

Rejected:
- **B** (transport also owns `isConnected` + session reset): leaks handshake/session semantics
  into the transport; muddier boundary.
- **C** (thin socket wrapper only): leaves the highest-risk reconnect/queue logic in the client;
  minimal benefit.

## Design

New file `server/src/infra/gateway/gateway-transport.ts` exporting `class GatewayTransport`,
following the existing `GatewayHeartbeat` pattern (class + injected deps).

### State owned by GatewayTransport

- `ws: WebSocket | null`
- `reconnectAttempts`, `reconnectTimeout`, `reconnectBaseInterval = 5000`, `reconnectMaxInterval = 60000`
- `connectTimeout`, `connectTimeoutMs = 15000`
- `intentionalDisconnect`
- `pendingMessages: string[]`, `MAX_PENDING_MESSAGES = 200`

### Injected dependencies

```ts
export interface GatewayTransportDeps {
  resolveWsUrl: () => string; // config.gatewayUrl.replace(/^http/, 'ws') + '/ws'
  createAgent: () => SocksProxyAgent | undefined; // createSocksProxyAgent(config, …)
  isConnected: () => boolean; // handshake-complete flag; used by the connect-timeout guard
  onOpen: () => void; // → client.sendPeerHello()
  onMessage: (parsed: Record<string, unknown>) => void; // → client.handleMessage()
  onDisconnect: (code: number | null) => void; // → client.cleanup(); close passes code, error/timeout pass null
}
```

### Public API

- `connect(): void`
- `disconnect(): void`
- `send(data: unknown, queueIfOffline?: boolean): void`
- `flushQueue(): void`

### Behaviour to preserve exactly

- Stale-socket guard `this.ws !== currentWs` moves into the transport alongside `ws`/`currentWs`.
- Reconnect policy moves wholesale into the transport: on `close`, reconnect only when
  `code !== 4000`; on `error`/`timeout`, always reconnect; all gated by `intentionalDisconnect`
  inside `scheduleReconnect`.
- The connect-timeout aborts + reconnects only when `!isConnected()` (queried via dep), matching
  the current `this.ws !== currentWs || this.isConnected` guard.
- `disconnect()` clears timers, calls `onDisconnect(null)`, removes listeners, and closes the
  socket (so the removed close handler cannot double-fire), matching the current ordering.
- `send()` sends immediately when `ws.readyState === OPEN`; otherwise, when `queueIfOffline`,
  enqueues with the 200-message cap dropping the oldest. `flushQueue()` drains and sends queued
  messages that are still OPEN.

### Changes to GatewayClient

- Remove the transport fields/methods: `ws`, `reconnect*`, `connectTimeout*`, `pendingMessages`,
  `MAX_PENDING_MESSAGES`, and `connect/disconnect/scheduleReconnect/clearConnectTimeout/sendWs/flushPendingMessages`.
- Add `private readonly transport = new GatewayTransport({ … })` wired to the client's
  `sendPeerHello`, `handleMessage`, `cleanup`, and `isConnected`.
- Redirect all senders to `this.transport.send(...)`: heartbeat `send`, `GatewayBackendDataPublisher`
  `sendMessage`, the HTTP-proxy `sendWs` dep, and every internal `this.sendWs(...)` call.
- `handlePeerReady`'s `flushPendingMessages()` → `this.transport.flushQueue()`.
- CQE `commands.connection.connect/disconnect` delegate to `this.transport`.

## Test strategy

- New `server/src/infra/gateway/__tests__/gateway-transport.test.ts` using the existing mock
  `ws` pattern + fake timers:
  - `connect()` creates the socket and wires open/message/close/error.
  - exponential backoff with cap; `intentionalDisconnect` prevents reconnect.
  - connect-timeout aborts + reconnects only when `isConnected()` is false.
  - `close` code 4000 skips reconnect; other codes reconnect.
  - `send()` immediate vs offline-enqueue; 200-cap drops oldest; `flushQueue()` sends queued.
- Migrate the reconnection-logic / connect-disconnect cases in `gateway-client.test.ts` that
  reach into the (now-removed) client socket over to the transport test, mirroring the earlier
  extractions.

## Out of scope (future QA-0027 steps)

Handshake (`sendPeerHello`/`handlePeerReady`), registry (`applyRegistrySync`/`handleRegistrySnapshot`),
backend-subscription/outgoing routing, and the message-router switch remain in the client and are
candidates for later separate steps.
