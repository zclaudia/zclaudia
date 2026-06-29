# Task 4 Report: Pi-Backed Lightweight Agent Runner

## Implementation Summary

- Added `LightweightAgentRunner` at `server/src/infra/providers/pi-runtime/agent-loop/lightweight-agent-runner.ts`.
- Added concrete pi executor `runPiAgentLoop` at `server/src/infra/providers/pi-runtime/agent-loop/pi-agent-loop-executor.ts`.
- Exported the new runner and executor from `server/src/infra/providers/pi-runtime/agent-loop/index.ts`.
- Added fake-executor runner tests at `server/src/infra/providers/pi-runtime/agent-loop/__tests__/lightweight-agent-runner.test.ts`.

The runner:

- resolves an agent-loop context with `AgentLoopContextRepository`
- loads the LLM profile with `LlmProfileRepository`
- builds the model via `buildModel`
- builds hooks via `buildAgentHooks`
- builds tools via `buildAgentLoopTools`
- records `input`, `assistant_message`, `contract_result`, and `error` events
- enforces first-pass JSON-only output contracts with `parseJsonOutput`
- issues repair retries with `buildJsonRepairPrompt`

The executor:

- constructs a pi `Agent`
- reuses pi stream retry behavior through `withStreamRetry`
- preserves pi cache-retention behavior through a wrapped `streamFn`
- aborts on timeout and throws `AgentLoopTimeoutError`
- extracts final assistant text plus usage from `agent_end`

## TDD Evidence

RED:

- Added `lightweight-agent-runner.test.ts` before production code existed.
- Ran:

```bash
cd /Users/zhvala/SourceCode/zclaudia/.worktrees/lightweight-agent-runner-workflow-migration/server
bash ../scripts/with-project-node.sh ../node_modules/.bin/vitest run --config vitest.config.ts src/infra/providers/pi-runtime/agent-loop/__tests__/lightweight-agent-runner.test.ts
```

- Observed expected failure:
  - `Cannot find module '../lightweight-agent-runner.js'`

GREEN:

- Implemented the runner and executor.
- Re-ran the same test command and got:
  - `Test Files  1 passed (1)`
  - `Tests  4 passed (4)`

## Tests

`server/src/infra/providers/pi-runtime/agent-loop/__tests__/lightweight-agent-runner.test.ts`

Covers:

- successful JSON-contract completion
- one repair retry for invalid JSON
- terminal `contract_failed` result after exhausted repair attempts
- unknown toolset rejection before executor invocation

## Files Changed

- `server/src/infra/providers/pi-runtime/agent-loop/pi-agent-loop-executor.ts`
- `server/src/infra/providers/pi-runtime/agent-loop/lightweight-agent-runner.ts`
- `server/src/infra/providers/pi-runtime/agent-loop/index.ts`
- `server/src/infra/providers/pi-runtime/agent-loop/__tests__/lightweight-agent-runner.test.ts`

No unrelated files were modified.

## API Adjustments vs Brief

- The brief sample used a `ctx.turn`-style read inside `shouldStopAfterTurn`.
- The installed `@earendil-works/pi-agent-core` `ShouldStopAfterTurnContext` does not expose a turn counter.
- I enforced `maxTurns` with a local closure counter inside `runPiAgentLoop` instead. This keeps the behavior compatible with the actual package API.

## Self-Review

- Scope stayed within the task-owned files.
- The implementation uses the required existing helpers instead of introducing a parallel path.
- Tests use an injected fake `AgentLoopExecutor`; no real LLM calls occur in test.
- Output handling remains JSON-contract-only, as required.
- Workflow step migration was not touched.

## Concerns

- The executor path is only compile-covered by the runner test import path in this task. There is no direct unit test here for live pi `Agent` event sequencing or timeout behavior.
- Context replay is intentionally simple in this phase: loaded prior events are rendered into the current prompt string instead of migrating richer workflow-step state.
