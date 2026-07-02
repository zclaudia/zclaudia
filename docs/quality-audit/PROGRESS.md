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

These were advanced by extracting cohesive, tested leaf modules. All three of these tracked
decomposition refactors are now `fixed`: QA-0027 (closed by decision), QA-0034 (fully split by
lifecycle stage), and QA-0054 (shared build helpers extracted; remaining bulk is irreducible
platform-specific logic). Other unrelated `partial` findings remain outside this section
(formatting/lint debt, perf, test-env, security, and the QA-0017/QA-0033 architecture items).

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

### QA-0054 — `scripts/build/*.sh` — ✅ CLOSED (fixed, 2026-07-02)
- **What shipped:** `common.sh` now holds every genuinely-shared piece — env/node/rustup/preflight,
  `zclaudia_resolve_version`, `zclaudia_set_updates_enabled`, and (final pass) `zclaudia_tauri_semver`
  (macos+linux) + `zclaudia_resolve_release_repo` (android+macos), the last two byte-identical
  duplications. Behaviour-preserving; android now also honors `GITHUB_REPOSITORY` (CI improvement).
- **Deliberately left inline:** the install/deps/build block (only `pnpm install` + `pnpm -r run
  build` are common; macOS/Linux also bundle the server, Android has an `INSTALL_ONLY` gate — a
  shared helper would need flags and read worse).
- **Remaining size is irreducible platform-specific logic:** Android manifest/gradle patching +
  keystore signing; macOS keychain/p12 + DMG + re-signing + bundle verification; Linux deb/rpm.
  A shared `sign_artifact`/`verify_bundle` abstraction and a TS build orchestrator were both
  rejected — high risk, unverifiable here (no macOS/Android build, no shellcheck), low value given
  the divergence.
- **Verification:** `bash -n` on all four scripts + diff review. Spec/plan:
  `specs/2026-07-02-qa-0054-build-helpers-design.md`, `plans/2026-07-02-qa-0054-build-helpers.md`.
