# Batch 02: Server Infrastructure Audit

Date: 2026-07-01

Scope: `server/` infrastructure only: process startup, Express/WebSocket setup, auth middleware, storage/migrations, file storage/transfer, gateway client, and infrastructure bootstrap.

Score: 61 / 100

## Summary

The server infrastructure is functional and well covered by tests, but it carries material security-boundary and maintainability risk. The strongest areas are TypeScript build health, extensive server test coverage, storage/file-transfer unit coverage, and gateway reconnection logic. The weakest areas are broad local trust assumptions, file-system APIs exposed through authenticated HTTP routes, non-transactional migrations, a large gateway client class, formatting drift, and high lint-warning volume.

## Gate Results

| Gate / Check                               | Result             | Evidence                                                                                 |
| ------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------- |
| `pnpm --filter @zclaudia/server run build` | Pass               | `tsc` completed successfully.                                                            |
| `pnpm --filter @zclaudia/server run lint`  | Pass with warnings | 0 errors, 1486 warnings across server source.                                            |
| Infra subset ESLint                        | Pass with warnings | 346 files, 0 errors, 542 warnings; top rules are non-null assertions and explicit `any`. |
| Infra subset Prettier                      | Fail               | 279 files in this batch scope need formatting.                                           |
| Targeted infra tests                       | Pass               | Non-sandbox run: 6 files, 150 tests passed.                                              |
| Full server tests                          | Pass in baseline   | Non-sandbox baseline run: 425 files, 4845 tests passed, 1 skipped.                       |

The sandboxed targeted test run skipped route tests because loopback sockets were unavailable. The same targeted set passed under non-sandbox execution.

## Score Breakdown

- Architecture boundaries: 12 / 20
- Type and interface contracts: 10 / 15
- Test quality: 15 / 20
- Maintainability: 7 / 15
- Reliability: 10 / 15
- Security and privacy: 4 / 10
- Engineering experience: 3 / 5

## Strengths

- Server TypeScript build is clean.
- Server test coverage is broad; the targeted infrastructure slice passed 150 tests, and the baseline full server suite passed.
- REST route mounting is centralized through bootstrap modules rather than scattered across startup code.
- Attachment storage has explicit path-safety checks and bucketed storage keys.
- File upload paths use server-generated temporary and stored file IDs.
- Gateway reconnect logic uses bounded exponential backoff and a bounded offline queue for channel messages.
- Process, file cleanup, heartbeat, and supervision tasks are explicit enough to reason about operational behavior.

## Findings

### Local Trust Boundary Is Too Broad

The server defaults to `SERVER_HOST=0.0.0.0`, enables global `cors()`, and bypasses REST authentication for requests whose socket address is localhost. WebSocket authentication only requires an initial `auth` message type; it does not validate a token. This can be acceptable for a tightly controlled embedded desktop process, but it is risky when combined with browser-origin requests and file-system endpoints.

Evidence:

- `server/src/index.ts` defaults `HOST` to `0.0.0.0`.
- `server/src/server.ts` installs global `cors()`.
- `server/src/interfaces/http/middleware/express-auth.ts` allows localhost without Bearer auth.
- `server/src/server.ts` marks any `auth` WebSocket message as authenticated.

Recommended direction: define explicit trust modes. For local desktop mode, restrict accepted origins/hosts and require an unguessable local session token. For LAN/remote mode, require Bearer auth consistently and avoid localhost-only decisions as the main browser security boundary.

### File Push Can Copy Arbitrary Server Files

`POST /api/files/push` accepts `filePath` from the request body. `FileTransferService.pushLocalFile` checks only that the path exists and is a regular file, then copies it into the file store and optionally broadcasts it to clients. Tests assert absolute paths such as `/some/file.txt` are accepted when the filesystem checks pass.

This is probably intentional for the `push_file` interaction tool, but as an HTTP route it should not be callable by any origin that can reach local auth bypass or any remote client with a stored token.

Recommended direction: restrict push sources to explicit allowed roots, require a privileged local token, or move arbitrary local file push behind an internal-only service API that browser clients cannot call directly.

### Stored File Path Resolution Lacks Defense-in-Depth

`FileStore.getFilePath(fileId)` uses `path.join(this.storageDir, fileId)` without validating that `fileId` is a safe storage key or that the resolved path remains inside `storageDir`. Metadata lookup happens before download resolution, so exploitability depends on a malicious or corrupted metadata row. Still, `AttachmentStore` already has stronger storage-key checks, and `FileStore` should follow the same pattern.

Recommended direction: validate stored file IDs, reject absolute/parent paths, and compare `path.resolve(storageDir, fileId)` against `path.resolve(storageDir) + path.sep` before reading or deleting.

### Migrations Are Not Transactional

Production `runMigrations` and test `applyMigrations` both execute a migration SQL string and then insert the migration record as separate operations. If a migration partially applies or fails after side effects, the database can be left in a state that is neither cleanly unapplied nor marked applied. Several schema-mismatch errors currently recommend wiping the data directory, which is a sign this path needs stronger safety.

Recommended direction: wrap each migration in a `db.transaction` that applies SQL and inserts the migration record together. For complex rebuild migrations, use explicit temp-table/rename guards and tests that simulate mid-migration failures.

### WebSocket Router Errors Fall Back to Legacy Handling

When `router.route(...)` throws, `server.ts` logs the router error and continues into `handleClientMessage`. That can mask router regressions, double-handle partially processed requests, or return legacy behavior instead of a clear protocol error. The gateway message path has the same fallback pattern.

Recommended direction: distinguish "no route matched" from "route threw". Route misses can fall back during migration; route exceptions should emit a structured error and be covered by a regression test.

### Gateway Client Concentrates Too Many Responsibilities

`server/src/infra/gateway/gateway-client.ts` is 1105 lines and combines connection lifecycle, handshake, registry state, backend subscriptions, backend data publishing, stream routing, HTTP proxying, push notifications, reconnection, and offline queueing. The class is testable, but the ownership boundary is too wide for a high-risk networking component.

Recommended direction: split transport/handshake, registry, backend data, stream subscriptions, and HTTP proxy handling into smaller collaborators behind the existing command/query facade.

### Formatting And Lint Debt Reduce Signal

The server infrastructure slice has 279 files failing Prettier and 542 ESLint warnings. Full server lint has 1486 warnings. The most common warnings are non-null assertions, explicit `any`, import-type style violations, and unused variables. This keeps gates green only because warnings are non-blocking, and it makes real safety warnings harder to see.

Recommended direction: run a repository-wide mechanical format pass first, then reduce production-source `any` and non-null assertions in security-sensitive modules before test-only cleanup.

## Test Gaps

- No explicit test proves browser `Origin` or `Host` restrictions for localhost-trusted REST routes.
- No direct test enforces a path allowlist for `/api/files/push`.
- No test verifies `FileStore` rejects unsafe stored file IDs or resolved paths outside the storage directory.
- Migration tests cover schema outcomes, but not transactional rollback on mid-migration failure.
- Router fallback behavior is not locked down as "route miss only" versus "route exception".

## Suggested Fix Order

1. Decide and document server trust modes: embedded-local, LAN, gateway-backed remote.
2. Add origin/host/token enforcement for localhost-trusted REST and WebSocket entry points.
3. Restrict `/api/files/push` to allowed roots or privileged internal callers.
4. Add FileStore path-safety validation.
5. Make migration application transactional.
6. Change WebSocket router fallback to treat route exceptions as errors.
7. Split `GatewayClient` by responsibility after behavior is covered by focused tests.
8. Normalize formatting and reduce server production-source lint warnings.

## Next Batch

Batch 03 should evaluate server domain/business modules: sessions, projects, agent profiles, workflows, automations, supervision, goals, provider orchestration, and direct SQL boundary issues already flagged by the architecture check.
