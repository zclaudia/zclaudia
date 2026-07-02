# Batch 04: Desktop Data And Connection Layer Audit

Date: 2026-07-01

Scope: `apps/desktop/src/stores`, `apps/desktop/src/hooks`, `apps/desktop/src/services`, `apps/desktop/src/facade`, and `apps/desktop/src/utils/openPanel.ts`.

Score: 66 / 100

## Summary

The desktop data and connection layer is in the middle of a useful facade migration. The direction is sound: embedded desktop, gateway-direct mobile, and backend routing now mostly go through `BackendFacade`, with targeted tests around stores, connection hooks, facade providers, and transport behavior.

The main quality risks are state ownership and sensitive configuration storage. Several stores still mirror the same selection state, protocol transport code still reaches into business stores for cleanup, and sync services coordinate many global stores from module-level state. The existing baseline architecture failure in `openPanel.ts` remains part of this same boundary problem.

## Gate Results

| Gate / Check                       | Result             | Evidence                                                                                                                           |
| ---------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Architecture check                 | Fail               | Still flags `apps/desktop/src/utils/openPanel.ts` for reading `selectedSessionId` from `projectStore` instead of `selectionStore`. |
| Desktop data/facade ESLint         | Pass with warnings | 252 files, 0 errors, 159 warnings. Top rules: non-null assertions, explicit `any`, import-type style, unused vars.                 |
| Desktop data/facade Prettier       | Fail               | 200 files in this batch scope need formatting.                                                                                     |
| Store/service representative tests | Pass               | 8 files, 280 tests passed.                                                                                                         |
| Hook representative tests          | Pass               | 2 files, 55 tests passed under `vitest.hooks.config.ts`; jsdom logged the known canvas `getContext` warning.                       |
| Facade/transport tests             | Pass               | 5 files, 50 tests passed under `vitest.unit.config.ts`.                                                                            |

The `fnm` multishell symlink warning appears during commands in the sandbox but does not prevent these checks from completing.

## Scale Snapshot

- Files in scope: 251 TypeScript/TSX files before adding `openPanel.ts` to checks; ESLint evaluated 252 files including `openPanel.ts`.
- Lines in scope: about 42,733 lines.
- Largest files include:
  - `apps/desktop/src/services/__tests__/api.test.ts`: 1529 lines.
  - `apps/desktop/src/services/__tests__/messageHandler.test.ts`: 1493 lines.
  - `apps/desktop/src/stores/recoveryStore.ts`: 781 lines.
  - `apps/desktop/src/hooks/chat/useCommandHandler.ts`: 729 lines.
  - `apps/desktop/src/stores/projectStore.ts`: 543 lines.
  - `apps/desktop/src/hooks/transport/GatewayTransport.ts`: 424 lines.

## Score Breakdown

- Architecture boundaries: 10 / 20
- Type and interface contracts: 11 / 15
- Test quality: 17 / 20
- Maintainability: 8 / 15
- Reliability: 10 / 15
- Security and privacy: 6 / 10
- Engineering experience: 4 / 5

## Strengths

- `BackendFacade` gives the app one conceptual connection abstraction across embedded desktop and gateway-direct clients.
- Facade sync is split into focused modules instead of living entirely inside `useBackendFacade`.
- `serverStore` runtime connection metadata is not persisted.
- `gatewayStore` removes older persisted runtime gateway secrets during migration and separates runtime config from direct mobile config.
- Tests cover API routing, session sync, file upload/download, gateway store behavior, connection hooks, transport lifecycle, and facade providers.
- `useEmbeddedServer` handles dev/prod startup separately and parses `SERVER_READY:<port>` for random-port embedded server discovery.
- Gateway proxy URL resolution centralizes desktop-local proxy versus mobile-direct HTTP routing.

## Findings

### Direct Gateway Secret Is Persisted In Browser Storage

`gatewayStore` intentionally avoids persisting runtime `gatewaySecret`, but it persists `directGatewaySecret` through Zustand `partialize`. That may be required for mobile direct reconnects, but it stores a gateway credential in WebView/browser local storage.

Recommended direction: move direct gateway credentials into OS-backed secure storage where available, or persist only an opaque reference/session token. Keep the current runtime/persisted split, but document the threat model and add tests that assert runtime secrets are not accidentally included in persisted state.

### Selection State Is Mirrored Between Stores

`projectStore` still owns `selectedProjectId`, `selectedSessionId`, and `dashboardViews`, while `selectionStore` owns the same concepts. The two stores are synchronized in both directions with subscriptions. This keeps compatibility, but it creates a split-brain risk and makes architecture rules harder to enforce.

Recommended direction: make `selectionStore` the single writer for selection state. Leave read-only compatibility selectors on `projectStore` only during migration, then remove the bidirectional subscriptions.

### Protocol Transport Writes Business Stores Directly

`GatewayTransport` imports and mutates `sessionsStore`, `projectStore`, and `ownershipStore` when registry items disappear. That couples low-level protocol transport to application state cleanup and bypasses the facade sync boundary that the rest of the connection layer is moving toward.

Recommended direction: emit a typed registry-removal event from transport, then handle store cleanup in facade runtime/sync code. Add a test that verifies transport emits the event without importing business stores.

### Sync Services Coordinate Too Many Global Stores

`sessionSync` and `facade/sync` modules coordinate session lists, chat messages, project data, ownership, run state, recovery, terminal state, and toasts. Several operations use module-level maps/sets for dedupe and recovery. The behavior is tested, but invariants are distributed across multiple stores.

Recommended direction: introduce typed coordinator effects or reducers for session/project/run-state reconciliation. Add invariant tests that assert selection, ownership, active-run state, and session lists stay consistent after deletion, reconnect, snapshot replay, and content catch-up.

### Dev Embedded Server Lifecycle Can Leave Orphan Processes

In dev mode, `useEmbeddedServer` intentionally does not kill the spawned server during React cleanup to avoid StrictMode races. Cleanup depends on registering the PID with Rust, but PID registration failure is only logged. This is reasonable for developer ergonomics but fragile when startup fails halfway.

Recommended direction: keep the StrictMode workaround, but add a dev-process registry/lease with explicit cleanup on restart and tests for PID-registration failure. Consider a per-process local token so stale dev servers cannot be silently reused by the wrong app session.

### Formatting And Lint Debt Remain In The Desktop Data Layer

This batch scope has 200 files failing Prettier and 159 ESLint warnings. Warnings are concentrated in non-null assertions, explicit `any`, import-type style, unused variables, and React hook rules.

Recommended direction: include this slice in the repo-wide mechanical format pass, then reduce production warnings in `projectStore`, `sessionRunStateStore`, `GatewayTransport`, `useEmbeddedServer`, and sync modules first.

## Test Gaps

- No test asserts that `directGatewaySecret` is never written outside the intended persisted key or that a secure-storage adapter is used when available.
- Architecture checks catch `openPanel.ts`, but they do not yet prevent protocol/transport modules from importing business stores.
- There are tests around store synchronization, but fewer end-to-end invariants for selection/ownership/session consistency across deletion and reconnect.
- Dev embedded-server cleanup paths are hard to validate in jsdom; PID-registration failure and stale-process reuse need focused unit or integration coverage.
- The representative commands passed, but the desktop top-level `test` script remains affected by the bare-`pnpm` runner issue recorded in Batch 00.

## Suggested Fix Order

1. Replace `openPanel.ts` reads of `projectStore.selectedSessionId` with `selectionStore`.
2. Stop `GatewayTransport` from importing business stores; move registry-removal cleanup into facade sync/runtime.
3. Make `selectionStore` the sole selection writer and turn `projectStore` selection fields into compatibility reads during migration.
4. Move `directGatewaySecret` to secure storage or document and constrain the fallback local-storage behavior.
5. Add invariant tests for reconnect, deletion, selection, ownership, and active-run reconciliation.
6. Harden dev embedded-server cleanup and stale-process reuse semantics.
7. Run the mechanical formatting pass for this slice and reduce production lint warnings.

## Next Batch

Batch 05 should evaluate `apps/desktop/` UI feature layer: components, feature modules, layout/state boundaries, accessibility-relevant interaction state, rendering performance, and the remaining desktop architecture finding in shared UI components.
