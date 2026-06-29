# Task 1 Report: Neutral Agent-Loop Context Schema And Repository

## Implementation Summary

Added a neutral agent-loop context schema and repository for workflow loop state persistence.

What changed:
- Added migration `028_agent_loop_contexts` with `agent_loop_contexts` and `agent_loop_events`.
- Added domain types for agent-loop ownership, context policy, event kinds, permissions, and run request/result shapes.
- Added `AgentLoopContextRepository` with:
  - `resolveContextForRun(args)`
  - `appendEvent(args)`
  - `loadEvents(contextId)`
- Exported agent-loop domain types and repository from the domain index.

Behavior implemented:
- `workflow-thread` contexts are reused by `(owner_type, owner_id, context_key)`.
- `step-local` and `none` contexts are created fresh per call.
- Events are persisted as JSON payloads and loaded in timestamp order.

## Tests

Targeted test file:
- `server/src/domains/agent-loop/__tests__/context-repository.test.ts`

Verification command:
```bash
cd /Users/zhvala/SourceCode/zclaudia/.worktrees/lightweight-agent-runner-workflow-migration/server && bash ../scripts/with-project-node.sh ../node_modules/.bin/vitest run --config vitest.config.ts src/domains/agent-loop/__tests__/context-repository.test.ts
```

Result:
- 3 tests passed

## TDD Evidence

Red run before implementation:
```text
Error: Cannot find module '../../../infra/storage/migrations/028_agent_loop_contexts.js'
```

Green run after implementation:
```text
Test Files  1 passed (1)
Tests       3 passed (3)
```

## Files Changed

- `server/src/infra/storage/migrations/028_agent_loop_contexts.ts`
- `server/src/infra/storage/migrations/index.ts`
- `server/src/domains/agent-loop/types.ts`
- `server/src/domains/agent-loop/context-repository.ts`
- `server/src/domains/agent-loop/index.ts`
- `server/src/domains/agent-loop/__tests__/context-repository.test.ts`

## Self-Review

Checked:
- Migration SQL matches the brief and is idempotent.
- Repository uses `newId()` for IDs and `better-sqlite3` for persistence.
- Workflow-thread reuse is keyed by owner plus context key.
- Step-local and none policies do not reuse prior events.
- Domain exports are present for downstream workflow tasks.

## Concerns

- The repository currently treats `workflow-artifacts` as non-reusable and generates unique trace keys each time. That is consistent with the current task scope, but later workflow tasks should confirm whether that policy needs additional reuse semantics or summary handling.

## Review Fix

Addressed the two review findings without changing `workflow-artifacts` semantics:
- Expanded `OutputContract` to include a future discriminator union with `finish_tool` and `text` shapes, and exported the new type surface.
- Made `AgentLoopContextRepository.loadEvents()` deterministic for identical timestamps by ordering `created_at ASC, rowid ASC`.
- Added a regression test that appends two events under the fixed clock and verifies insertion order.

Verification command:
```bash
cd /Users/zhvala/SourceCode/zclaudia/.worktrees/lightweight-agent-runner-workflow-migration/server && bash ../scripts/with-project-node.sh ../node_modules/.bin/vitest run --config vitest.config.ts src/domains/agent-loop/__tests__/context-repository.test.ts
```

Result:
- `Test Files  1 passed (1)`
- `Tests       4 passed (4)`
