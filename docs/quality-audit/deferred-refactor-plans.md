# Deferred Refactor Plans

These three findings are large, high-regression-risk architectural refactors that touch
live state management and very large UI files. They are intentionally deferred out of the
QA follow-up branch so each can be executed and reviewed on its own. Every plan below is
written to be picked up cold: current state, target, ordered steps, regression surface,
and test strategy.

Status source of truth: [findings.json](findings.json). These remain `open`.

---

## QA-0037 — Make `selectionStore` the single writer for selection state

### Current state

- [selectionStore.ts](../../apps/desktop/src/stores/selectionStore.ts) (32 lines) already owns
  `selectedProjectId`, `selectedSessionId`, `dashboardViews` with plain setters.
- [projectStore.ts](../../apps/desktop/src/stores/projectStore.ts) (527 lines) **duplicates** the
  same three fields (`:35-37`, defaults `:86-88`) and mutates them directly in:
  - `selectProject` (`:377`), `selectSession` (`:386`), `setDashboardView` (`:405`)
  - cleanup paths: `archiveProject` (`:212-217`), `deleteProject` (`:250-254`), `deleteSession` (`:326`)
- The two stores are kept in sync by a bidirectional bridge: `syncSelectionSnapshot()`
  (`:432-437`) plus a `selectionStore` subscription (`:468-475`).
- ~283 components read these fields, the majority via `useProjectStore`.

### Target

`selectionStore` is the **only writer**. `projectStore` keeps the three fields as
**read-only mirrors** during migration (updated by a one-way subscription from
`selectionStore`), and all mutations route through `selectionStore` actions. New code reads
selection from `selectionStore`.

### Ordered steps

1. Move selection-mutation logic into `selectionStore`: extend it with the cleanup helpers
   (`clearSelectionForProject(projectId)`, `clearSelectionForSession(sessionId)`) so deletion
   paths can call it instead of computing next-selection inline.
2. Rewrite `projectStore.selectProject/selectSession/setDashboardView` to delegate to
   `useSelectionStore.getState().setSelected*` / `setDashboardView` (no local `set` of those
   fields).
3. Rewrite `archiveProject/deleteProject/deleteSession` to call the new `selectionStore`
   cleanup helpers for the selection side-effects; keep their project/session data mutations.
4. Delete the `projectStore → selectionStore` half of the bridge; keep only
   `selectionStore → projectStore` (`syncSelectionSnapshot` driven by the subscription) so the
   mirror fields stay populated for existing readers.
5. Codemod readers incrementally: `useProjectStore(s => s.selectedSessionId)` →
   `useSelectionStore(s => s.selectedSessionId)`. Do this in batches by feature folder; the
   mirror keeps un-migrated readers correct throughout.
6. Once no component reads the mirror fields, delete them from `projectStore` and remove
   `syncSelectionSnapshot`.

### Regression surface

Selection drives routing, right-panel content, active-session streaming, and dashboard view
state. The dangerous window is steps 2-4 (writer flip) — if a mutation path is missed, that
selection silently stops updating.

### Test strategy

- Before touching anything, add store-level tests asserting current behavior of
  `selectProject/selectSession/setDashboardView` and the three cleanup paths (what
  `selectedProjectId/SessionId` become after archive/delete). These lock behavior across the flip.
- After each step run `vitest.unit.config.ts` (stores) and `vitest.ui.config.ts`.
- Add a test that mutating via `selectionStore` is reflected in `projectStore` mirrors and
  vice-versa is **no longer** possible (mirror is read-only).

---

## QA-0039 — Introduce a typed coordinator for `sessionSync`

### Current state

- [sessionSync.ts](../../apps/desktop/src/services/sessionSync.ts) coordinates
  `useSessionsStore`, `useProjectStore`, `useSessionRunStateStore`, `useSelectionStore`
  directly via `getState()` inside `incrementalSync`/`fullSync` (`:141-307`).
- Reconciliation bookkeeping lives in module-level mutable maps/sets: `syncStates` (`:27`),
  `activeSyncs` (`:30`), `pendingRecovery` (`:367`), `trailingRecovery` (`:368`).
- Related facade sync modules (`src/facade/sync/*`) coordinate the same stores for
  backend-lifecycle / run-content / backend-data reconciliation.

### Target

A pure, typed reconciliation layer: `sessionSync` computes a typed list of **effects**
(`SyncEffect` union: `upsertSessions`, `removeSessions`, `setRunState`, `scheduleRecovery`,
`replaySnapshot`, …) from the incoming payload plus the current snapshot, and a thin applier
maps effects onto stores. The module-level maps become fields of a `SyncCoordinator` instance
so reconciliation state is explicit and testable.

### Ordered steps

1. Define `SyncEffect` union and a `SyncSnapshot` input type (the store slices the sync reads).
2. Extract a pure `reconcile(snapshot, payload, coordinatorState): SyncEffect[]` function —
   move the branching in `incrementalSync`/`fullSync` into it, leaving store reads/writes out.
3. Introduce `class SyncCoordinator` holding `syncStates/activeSyncs/pendingRecovery/trailingRecovery`
   as fields; expose `handleIncremental/handleFull` that call `reconcile` then `applyEffects`.
4. `applyEffects(effects)` is the only place that touches stores.
5. Keep the existing exported function signatures as thin wrappers over a singleton
   `SyncCoordinator` so callers don't change.
6. Apply the same effect/reducer shape to the `facade/sync/*` modules once `sessionSync` proves
   the pattern.

### Regression surface

Deletion, reconnect, snapshot replay, and content catch-up. A wrong effect ordering can drop
messages or leave stale sessions.

### Test strategy

- `reconcile` is pure → exhaustive unit tests for: session deletion, reconnect replay,
  snapshot vs incremental, content catch-up, and no-op payloads (assert emitted effects).
- Applier tests with mocked stores assert each effect hits the right store method.
- Run `vitest.ui.config.ts` (covers `useActiveSessionStream`, sync-driven hooks) after each step.

---

## QA-0043 — Split the five oversized UI files

### Current state (line counts as of 2026-07-02)

| File | Lines |
| --- | --- |
| [LlmProfileManager.tsx](../../apps/desktop/src/features/settings/LlmProfileManager.tsx) | 1724 |
| [AgentManager.tsx](../../apps/desktop/src/features/settings/AgentManager.tsx) | 1649 |
| [McpServerSettings.tsx](../../apps/desktop/src/features/settings/McpServerSettings.tsx) | 1442 |
| [MessageInput.tsx](../../apps/desktop/src/features/chat/MessageInput.tsx) | 1378 |
| [MessageList.tsx](../../apps/desktop/src/features/chat/MessageList.tsx) | 1275 |

Each mixes data loading, form/validation state, serialization, keyboard/attachment handling,
and rendering in one component.

### Target

Per file, extract along these seams behind tested boundaries, leaving a thin container:

- **Form reducer**: `use<Feature>FormReducer.ts` — the `useReducer`/`useState` cluster + actions.
- **Validation/serialization**: pure `<feature>-form.ts` (to/from wire model, field validators).
- **Data loader hook**: `use<Feature>Data.ts` — fetch/subscribe/derive.
- **Subcomponents**: row/item/section components into sibling files.
- **Handlers**: keyboard + attachment logic (MessageInput) into `use<Feature>Input.ts`.

### Ordered steps (repeat per file, do one file per PR)

1. Extract the **pure** validation/serialization helpers first (no React) and unit-test them —
   safest, highest-leverage.
2. Extract the form reducer hook; test its state transitions.
3. Extract the data-loader hook.
4. Extract subcomponents last (mechanical), keeping props typed.
5. The original file becomes a container that composes the above. Target < ~400 lines each.

### Regression surface

These are the primary settings + chat surfaces. Extraction is mostly mechanical but prop/state
wiring mistakes surface as broken forms or lost keystrokes.

### Test strategy

- Component tests exist under `vitest.ui.config.ts` / `vitest.components.config.ts` — run both
  after each extraction step.
- Add unit tests for every newly-extracted pure helper and reducer (these didn't exist before
  and are the durable win).
- Prefer one file per PR so review and rollback stay tractable.
