# QA-0034 — Split `local-pr/service.ts` by lifecycle stage

Date: 2026-07-02
Finding: QA-0034 (LocalPRService too broad for a git-mutating workflow service). See `docs/quality-audit/findings.json`.

## Context

`server/src/domains/local-pr/service.ts` is ~1139 lines and owns the entire local-PR
workflow: creation/refresh, review orchestration, merge/revert, conflict resolution, the queue
scheduler, and cleanup. Prior QA-0034 steps already extracted the pure leaf modules
`review-prompt.ts`, `provider-resolution.ts`, `merge-commit.ts` (plus the pre-existing
`conflict-resolution-prompt.ts` / `review-verdict.ts`).

This spec covers the **stateful** decomposition that was previously deferred: splitting the
service body into lifecycle-stage collaborators.

## Goal & success criteria

- **Success = clear boundaries + a thin facade.** Each lifecycle stage becomes its own focused
  module with a single purpose; `LocalPRService` becomes a delegating facade. Reducing the file
  from ~1139 lines toward a ~150–250 line facade is an explicit target here (primary goal is
  structural clarity).
- **Behaviour-preserving.** `LocalPRService`'s public API is unchanged, so `routes.ts` /
  `register.ts` need zero changes, and the existing `local-pr-service.test.ts` (2236 lines,
  end-to-end over the service) must keep passing throughout — it is the regression net.

## Chosen approach — Shared Context + stage collaborators

The lifecycle stages are **not** independent: the queue scheduler calls into review / merge /
conflict / creation, review can trigger merge, merge can trigger conflict resolution, and the
stages share mutable state (`activeReviewIds`, `activeConflictIds`, `mergeLock`). A pure-function
split (like the earlier leaf extractions) would make cross-stage callbacks unworkable. So the
stages become classes that share one state holder.

Rejected:
- **Pure-function modules + explicit args:** fine for leaf logic, but the cross-stage callbacks and
  shared mutable sets would require threading a large state bag through every call. Muddy.
- **Independent, unrelated files (no shared context):** each stage would duplicate or re-derive the
  shared repos/sets/helpers; boundaries would leak.

## Design

### ① `LocalPRContext` — the single shared-state holder

New `server/src/domains/local-pr/context.ts` exporting `class LocalPRContext` (a class, so the
leaf helpers keep their behaviour rather than being loose functions). The service constructs one
instance and passes it to every stage. It bundles the state and leaf helpers every stage needs:

- **Repos / deps:** `prRepo`, `projectRepo`, `llmProfileRepo`, `sessionRepo`, `messageRepo`,
  `wtConfigRepo`, `db`, `aiDeps`, `broadcastToProject`.
- **Shared mutable state:** `mergeLock` (Mutex), `activeReviewIds`, `activeConflictIds`.
- **Leaf helpers** (moved verbatim): `requirePR`, `requireAiDeps`, `broadcastPRUpdate`,
  `hasAvailableSlot`, `deleteRelatedSessions`, `forwardSessionStream`,
  `resolveAgentLlmIdForProject`.

### ② Four stage collaborators (each holds the context)

| New module | Class | Methods moved from `service.ts` |
| --- | --- | --- |
| `creation.ts` | `PRCreationService` | `checkCreatePreconditions`, `createPR`, `maybeAutoCreatePR`, `maybeAutoCreatePRForCompletedSession`, `maybeRefreshPR`, `refreshAfterBusyState`, `archiveRelatedSessions` |
| `review.ts` | `PRReviewService` | `startReview`, `onReviewSessionComplete`, `cleanupReviewArtifacts` |
| `merge.ts` | `PRMergeService` | `mergePR`, `cancelMerge`, `reopenPR`, `revertMergedPR` |
| `conflict.ts` | `PRConflictService` | `triggerConflictResolution`, `startConflictResolution`, `onConflictSessionComplete` |

### ③ `PRQueueScheduler` — the one cross-stage orchestrator

New `scheduler.ts` exporting `class PRQueueScheduler` holding the context + references to the
creation / review / merge stages. Methods moved: `tick`, `processQueue`, `processFailed`,
`processStale`, `processPendingReviews`, `processPendingMerges`, `cleanupFinishedPRs`.

### ④ `LocalPRService` becomes a facade

`service.ts` constructs `LocalPRContext`, then the five collaborators, wires their cross-stage
references, and delegates each of its existing public methods to the owning collaborator. Public
signatures unchanged. `getRepo()` stays on the facade.

### Cross-stage edges (construction order resolves the cycle)

```
scheduler ──▶ creation, review, merge, conflict
review    ──▶ merge      (auto-merge after an approved review)
merge     ──▶ conflict   (merge conflict triggers resolution)
```

Construct in dependency order (conflict → merge → review → creation → scheduler). For any
remaining cycle (e.g. review↔merge, or a stage calling back into another), use a
post-construction wiring step (`stage.wire({ merge, conflict })`) rather than passing half-built
objects into constructors. Cross-stage calls that today are direct `this.method(...)` become
`this.merge.mergePR(...)` etc.

## Execution plan (one stage per commit)

Each step keeps the full `local-pr-service.test.ts` suite green and `tsc` clean before the next:

1. Extract `LocalPRContext` (state + leaf helpers); service delegates helpers to it. No behaviour
   change, no stage moved yet.
2. Extract `PRCreationService`.
3. Extract `PRReviewService`.
4. Extract `PRMergeService`.
5. Extract `PRConflictService`.
6. Extract `PRQueueScheduler`; service body is now a thin facade.

Ordering rationale: context first (everything depends on it), then the least-cross-linked stages
before the scheduler that references them all.

## Test strategy

- **Primary net:** the existing `local-pr-service.test.ts` (drives the public facade end-to-end)
  must pass unchanged after every step — this proves behaviour preservation.
- Run `pnpm --filter server exec vitest run src/domains/local-pr` + server `tsc` per commit.
- No new stage-level unit tests are required by this spec (goal is structure, and the facade suite
  already exercises each stage). If a stage's extracted seam turns out to be independently
  valuable to test, add it opportunistically — not a gate.

## Out of scope

- Changing any public behaviour, route, or persisted schema.
- Rewriting the git-mutation internals (worktree ops, merge/revert mechanics) — they move verbatim.
- Adding new stage-level unit suites as a requirement (see Test strategy).
