# Quality Audit — Remediation Progress

Working branch: `quality-audit/remaining-open` (merged to `main` on 2026-07-02).
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

## The maintainability partials — current state for separate discussion

These were advanced by extracting cohesive, tested leaf modules. QA-0027 (closed by decision) and
QA-0034 (fully split by lifecycle stage) are now `fixed`; QA-0054 remains `partial` and needs its
own decision on how far to push the deeper, higher-risk decomposition.

### QA-0027 — `gateway-client.ts` — ✅ CLOSED (fixed, 2026-07-02)
- **Now:** 937 lines. Extracted: HTTP proxy, device identity, heartbeat timer, and socket
  lifecycle + reconnect/backoff + offline send queue (`gateway-transport.ts`, `GatewayTransport`) —
  all independently tested (12 gateway test files / 90 tests green).
- **Retained by decision:** registry sync + snapshot, backend subscription state, message router,
  handshake (peer hello/ready), and the backend-data/stream outgoing handlers stay in the client.
- **Rationale:** these are tightly coupled to the client's shared mutable connection state (`ws`,
  `epoch`, subscription maps); further decomposition is high-risk (live-networking regression) and
  low-value. Closed rather than pursued further.

### QA-0034 — `local-pr/service.ts` — ✅ CLOSED (fixed, 2026-07-02)
- **Now:** 236-line delegating facade (was 1139). Split by lifecycle stage into `LocalPRContext`
  (shared state + helpers + refresh ops, 226) + `PRCreationService` (192) + `PRReviewService` (167)
  + `PRMergeService` (226) + `PRConflictService` (157) + `PRQueueScheduler` (153). Each stage is a
  `constructor(ctx, …)` collaborator; the facade constructs them and delegates its unchanged public
  API.
- **How:** behaviour-preserving verbatim move, one stage per commit (branch
  `quality-audit/qa-0034-service-split`, 7 commits). The 2236-line `local-pr-service.test.ts` was
  the regression net — unchanged and green throughout (7 files / 143 tests); server `tsc` clean.
- **Extra:** dropped pre-existing dead scheduler code (`processPendingReviews`/`processPendingMerges`
  + unused `creation` dep). Spec/plan: `specs/2026-07-02-qa-0034-local-pr-service-split-design.md`,
  `plans/2026-07-02-qa-0034-local-pr-service-split.md`.
- **Follow-ups (non-blocking):** align `[LocalPRService]` log prefixes with new class names; remove
  now-orphaned repo methods `findPendingAutoReview`/`findPendingMerge`; if the test may be edited,
  drop the `(service as any)` reflection delegators on the facade.

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
