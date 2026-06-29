# Task 3 Report: Builtin Agent-Loop Toolset Registry

## Implementation Summary
- Added `server/src/infra/providers/pi-runtime/agent-loop/toolsets.ts` with:
  - `BUILTIN_AGENT_LOOP_TOOLSETS`
  - `getAgentLoopToolsetDescriptor(id)`
  - `buildAgentLoopTools(args)`
  - the supporting `AgentLoopToolsetDescriptor` and `ToolsetContext` types
- Registered the four builtin first-pass toolsets:
  - `none`
  - `permission-review`
  - `code-review-readonly`
  - `workflow-prompt-readonly`
- Re-exported the registry from `server/src/infra/providers/pi-runtime/agent-loop/index.ts`.
- Re-exported the agent-loop surface from `server/src/infra/providers/pi-runtime/index.ts`.
- Added focused registry tests covering builtin descriptors, unknown toolset rejection, and the `none` toolset build path.

## Tests
- Red: `cd /Users/zhvala/SourceCode/zclaudia/.worktrees/lightweight-agent-runner-workflow-migration/server && bash ../scripts/with-project-node.sh ../node_modules/.bin/vitest run --config vitest.config.ts src/infra/providers/pi-runtime/agent-loop/__tests__/toolsets.test.ts`
  - Result: failed with `Cannot find module '../toolsets.js'`
- Green setup: `cd /Users/zhvala/SourceCode/zclaudia/.worktrees/lightweight-agent-runner-workflow-migration/shared && bash ../scripts/with-project-node.sh pnpm build`
  - Result: built the shared package so runtime imports of `@zclaudia/shared/core/tools` resolve
- Green: same Vitest command after implementation
  - Result: `1 passed`, `3 tests passed`

## TDD Evidence
- Wrote the registry test file before implementation.
- Verified the expected missing-module failure.
- Implemented the minimal registry and export surface.
- Re-ran the exact same Vitest command and confirmed it passed.

## Files Changed
- `server/src/infra/providers/pi-runtime/agent-loop/toolsets.ts`
- `server/src/infra/providers/pi-runtime/agent-loop/index.ts`
- `server/src/infra/providers/pi-runtime/index.ts`
- `server/src/infra/providers/pi-runtime/agent-loop/__tests__/toolsets.test.ts`
- `.superpowers/sdd/task-3-report.md`

## Self-Review
- The registry is limited to the builtin first-pass IDs and does not expose plugin-provided tools.
- `none` resolves to an empty tool list with `deny-external` permission mode and read-only sandboxing.
- The wrapper rejects unknown toolset IDs instead of falling back to a broader tool surface.
- The top-level pi-runtime export now exposes the agent-loop registry without changing runner behavior.

## Concerns
- The repo’s Vitest config still prints the existing `test.poolOptions` deprecation warning on every run.
- The workspace needed a local `shared` package build before the registry test could import `tool-bridge.ts`; that output was used for verification only and was not committed.

## Review Fix
- Command: `cd /Users/zhvala/SourceCode/zclaudia/.worktrees/lightweight-agent-runner-workflow-migration/server && bash ../scripts/with-project-node.sh ../node_modules/.bin/vitest run --config vitest.config.ts src/infra/providers/pi-runtime/agent-loop/__tests__/toolsets.test.ts`
- Output summary: Vitest completed successfully with `1 passed` test file and `3 passed` tests. The run also printed the pre-existing `test.poolOptions` deprecation warning.
