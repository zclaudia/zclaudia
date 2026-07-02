# Batch 03: Server Domain Layer Audit

Date: 2026-07-01

Scope: `server/src/domains`, `server/src/application/conversation`, and `server/src/application/orchestration`.

Score: 64 / 100

## Summary

The server domain layer has broad test coverage and several well-structured repositories/services, but it is not yet architecturally clean. The main weaknesses are direct SQL leaking into route and conversation handlers, missing architecture-check coverage for `*-routes.ts` and `register.ts`, non-transactional multi-step domain mutations, and very large services that mix state machines, persistence, git operations, and AI-session orchestration.

This batch has one concrete behavioral issue: manually queued local PR conflict resolution does not actually enter the queue state when no execution slot is available.

## Gate Results

| Gate / Check                | Result             | Evidence                                                                                                              |
| --------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Server build                | Pass               | `tsc` passed in the Batch 02 server build check.                                                                      |
| Architecture check          | Fail               | Direct SQL in `agent-profiles/routes.ts` and `projects/routes.ts`; desktop findings also still present from baseline. |
| Domain subset ESLint        | Pass with warnings | 580 files, 0 errors, 764 warnings.                                                                                    |
| Domain subset Prettier      | Fail               | 516 files in this batch scope need formatting.                                                                        |
| Representative domain tests | Pass               | Non-sandbox run: 14 files, 486 tests passed.                                                                          |
| Full server tests           | Pass in baseline   | Non-sandbox baseline run: 425 files, 4845 tests passed, 1 skipped.                                                    |

The sandboxed representative test run failed only because supertest route tests attempted loopback sockets and hit `listen EPERM`. The same suite passed under non-sandbox execution.

## Scale Snapshot

- Production TS in scope: 348 files, about 49,427 lines.
- Test TS in scope: 231 files.
- Largest production files include:
  - `server/src/domains/local-pr/service.ts`: 1196 lines.
  - `server/src/application/conversation/runtime/run-permissions.ts`: 680 lines.
  - `server/src/domains/supervision/routes.ts`: 672 lines.
  - `server/src/domains/supervision/supervisor-service.ts`: 660 lines.
  - `server/src/domains/workflows/engine.ts`: 615 lines.

## Score Breakdown

- Architecture boundaries: 10 / 20
- Type and interface contracts: 11 / 15
- Test quality: 16 / 20
- Maintainability: 7 / 15
- Reliability: 10 / 15
- Security and privacy: 7 / 10
- Engineering experience: 3 / 5

## Strengths

- The domain layer has a large amount of focused unit coverage, including sessions, workflows, automations, goals, supervision, agent profiles, and local PR flows.
- Many modules use repositories and services rather than embedding SQL in HTTP routes.
- Workflow execution has explicit DAG validation, retry/skip handling, active-run tracking, cancellation, and event dispatch.
- Automations route scheduled/event/manual triggers through the workflow engine instead of duplicating execution behavior.
- Goals have a clear service/coordinator split and tests around lifecycle, budget, recovery, and evaluation.
- Local PR merge operations use a mutex, and create/recheck paths use transactions for duplicate prevention.
- Agent-profile deletion handles default transfer inside a transaction.

## Findings

### Architecture Boundary Rules Are Too Narrow

The architecture check catches direct SQL in `server/src/domains/agent-profiles/routes.ts` and `server/src/domains/projects/routes.ts`, but the same pattern also appears in files such as `server/src/domains/sessions/drafts-routes.ts` and `server/src/domains/supervision/register.ts`. This means the current rule catches `routes.ts` but misses common route/registration variants.

Recommended direction: expand the architecture rule to cover `server/src/domains/**/*routes.ts`, `server/src/domains/**/*-routes.ts`, and `server/src/domains/**/register.ts`, while allowing repository files. Move route-level existence/schema checks into repository or service methods.

### Agent Default Changes Are Not Transactional

`createAgentProfileRoutes` clears all defaults before creating or updating a new default profile. `AgentProfileRepository.setDefault` also clears defaults before setting the requested profile as default. If the second operation fails, the system can be left with no default agent. Deletion already uses a transaction for default transfer, so the consistency requirement is known but not uniformly applied.

Recommended direction: move "make default" semantics into repository/service methods that wrap clear-and-set/create/update in one transaction. Add tests that force the second write to fail and assert the previous default remains.

### Local PR Conflict Resolution Queue State Is Incomplete

`LocalPRService.triggerConflictResolution` handles "no available slot" by setting only `statusMessage`. It does not set `executionState = 'queued'` or `pendingAction = 'resolve_conflict'`. `processQueue` only starts queued PRs based on `pendingAction`, so manually triggered conflict resolution can look queued in the UI but never execute.

The existing test for this branch only checks the status message, so it misses the missing queue state.

Recommended direction: set the same queue fields used by review/merge paths and extend the test to assert `executionState` and `pendingAction`.

### Claudia Branch/Session Lifecycle Is Multi-Step And Partly Non-Atomic

The Claudia inline-message path allocates a branch, may set the active branch, inserts a session, and then attaches the session to the branch across separate calls. `ClaudiaBranchService` itself performs direct writes for branch creation and active-branch state. If session creation or attachment fails after branch allocation, the system can leave an orphaned branch or stale active-branch state.

Recommended direction: introduce a transaction-scoped application service for branch allocation plus session creation/attachment, and add recovery/invariant tests for failed middle steps.

### Conversation Handlers Bypass Repository Boundaries

Conversation handlers still issue direct SQL for project lookup, context project lookup, session insertion, cancellation lookup, terminal project lookup, and steered message persistence. Some of these writes are wrapped in transactions, but the persistence surface is split across handlers, repositories, and tree helpers.

Recommended direction: route conversation/session writes through cohesive session and message services. Keep raw SQL in repositories or storage adapters, and add architecture checks for `application/conversation/handlers`.

### LocalPRService Is Too Broad

`LocalPRService` is 1196 lines and owns PR creation, auto-create, review sessions, AI verdict parsing, merge, revert, conflict resolution, queue processing, stale reset, cleanup, provider resolution, and session cleanup. It is heavily tested, but the class is too broad for a workflow that mutates git state and starts AI sessions.

Recommended direction: split it into PR creation/refresh, review orchestration, merge/revert, conflict resolution, queue scheduler, and cleanup collaborators behind the existing route/service API.

### Formatting And Lint Debt Are Heavy In Domains

The domain/conversation/orchestration slice has 516 files failing Prettier and 764 ESLint warnings. Warnings are dominated by non-null assertions, import-type style issues, unused variables, and explicit `any`.

Recommended direction: fix formatting as part of the repo-wide mechanical pass, then reduce production-source warnings in large state machines first: `local-pr`, `supervision`, `workflows`, and conversation runtime.

## Test Gaps

- No test asserts default-agent consistency when create/update/set-default fails after clearing defaults.
- The local PR no-slot conflict-resolution test checks the message but not `executionState` or `pendingAction`.
- Architecture checks do not cover `*-routes.ts`, `register.ts`, or conversation handlers.
- Claudia branch/session allocation lacks failure-injection tests for partial write rollback.
- Large services have many scenario tests, but fewer invariants that assert state-machine fields are always mutually consistent.

## Suggested Fix Order

1. Fix local PR conflict-resolution queue state and extend its test.
2. Make agent default transitions transactional.
3. Expand architecture checks to route variants and conversation handlers.
4. Move project/agent/session draft route SQL into repositories/services.
5. Wrap Claudia branch allocation plus session creation/attachment in a transaction-scoped service.
6. Split `LocalPRService` after behavior is locked down.
7. Normalize formatting and reduce production warning debt in high-risk domain modules.

## Next Batch

Batch 04 should evaluate `apps/desktop/` data and connection layers: Zustand stores, API clients, embedded server hook, multi-server socket management, gateway/facade adapters, persistence, and store-boundary architecture findings.
