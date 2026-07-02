# Quality Audit — Remediation Progress

Working branch: `quality-audit/remaining-open` (not yet merged/pushed as of 2026-07-02).
Source of truth for per-finding status: [findings.json](findings.json).

## Overall status (55 findings)

- **Blockers:** all cleared.
- **High:** all fixed except QA-0022 (partial: CORS guard + WS auth added; LAN mode still binds 0.0.0.0) and QA-0049 (partial: gateway gated behind TEST_MODES but still builds the sibling repo).
- Remaining `open` items are the deferred architectural refactors with executable plans in
  [deferred-refactor-plans.md](deferred-refactor-plans.md): **QA-0037, QA-0039, QA-0043**.

## Branch commits (9)

| Commit | Finding | What |
| --- | --- | --- |
| `1effbfa` | QA-0019 ✅ | Exhaustive wire message-union coverage (mutual-assignability + interaction msgs) |
| `ee3dabe` | QA-0027 | Extract `gateway-http-proxy.ts` |
| `2608938` | QA-0027 | Extract `gateway-device-id.ts` + `gateway-heartbeat.ts` |
| `f280d70` | QA-0034 | Extract `review-prompt.ts` |
| `a14b351` | QA-0034 | Extract `provider-resolution.ts` + `merge-commit.ts` |
| `63e210d` | QA-0054 | Shared `zclaudia_resolve_version` / `zclaudia_set_updates_enabled`; linux+macos adopt |
| `26db24a` | QA-0054 | android.sh adopts the shared version helper |
| `b452ac3` | QA-0040 ✅ | Single-lease eviction for dev embedded-server PID (Rust not compile-verified — no cargo) |
| `6829d25` | docs | Executable plans for QA-0037/0039/0043 |

Gates at end of branch: `format:check` pass · `check:architecture` pass · `lint` 0 errors / 772
warnings · server `tsc` clean · touched server suites 227 passed. (Full `pnpm test` still has the
QA-0014 env-only failures: 4 pi-runtime files need `rg`/`git` binaries absent in the sandbox.)

## The three partials — current state for separate discussion

These were advanced by extracting cohesive, tested leaf modules but remain `partial`. Each needs
its own decision on how far to push the deeper, higher-risk decomposition.

### QA-0027 — `gateway-client.ts`
- **Now:** ~1055 lines. Extracted: HTTP proxy, device identity, heartbeat timer (all tested).
- **Remaining bulk:** connection lifecycle + reconnect/backoff, handshake (peer hello/ready),
  registry sync + snapshot, backend subscription state, outgoing backend-data/stream message
  handlers, offline send queue.
- **Why deferred:** these share the client's mutable connection state (`ws`, `epoch`,
  `isConnected`, subscription maps). Splitting needs a deps interface (CQE facade already exists)
  and carries live-networking regression risk.
- **Open questions for discussion:** which seam first — reconnect/transport, or the
  outgoing-message handler cluster? Extract as classes with injected deps, or move handlers behind
  the existing command/query/event facade?

### QA-0034 — `local-pr/service.ts`
- **Now:** ~1140 lines. Extracted: review prompt, conflict prompt (pre-existing), review-verdict
  (pre-existing), provider resolution, merge-commit lookup (all tested).
- **Remaining bulk:** creation/refresh, review orchestration, merge/revert, conflict resolution,
  and the queue scheduler (`tick` + `processQueue/Failed/Stale/PendingReviews/PendingMerges` +
  `cleanupFinishedPRs`).
- **Why deferred:** the queue scheduler alone touches ~12 private methods/fields
  (`prRepo`, `startReview`, `mergePR`, `startConflictResolution`, `refreshAfterBusyState`,
  `hasAvailableSlot`, `activeReviewIds`, `broadcastPRUpdate`, `deleteRelatedSessions`, …).
- **Open questions for discussion:** extract a `LocalPRQueueScheduler` behind a deps port, or split
  by lifecycle stage (creation / review / merge-revert / conflict)? How to test the scheduler
  without a live git worktree?

### QA-0054 — `scripts/build/*.sh`
- **Now:** android.sh ~556, macos.sh ~540 lines. All three scripts share the version/updates
  helpers via `common.sh`.
- **Remaining bulk:** signing (macos keychain/p12 import vs android keystore), artifact
  verification/bundling, cleanup traps.
- **Why deferred:** signing/artifact logic is genuinely platform-specific, not identical
  duplication; and these scripts can't be executed/verified in the current environment
  (no full macOS/Android build, `version-bump.sh` has side effects, no shellcheck).
- **Open questions for discussion:** is there value in a shared `sign_artifact` / `verify_bundle`
  abstraction despite platform differences, or is the remaining size acceptable? Would a typed
  build orchestrator (TS) be preferable to more bash helpers?
