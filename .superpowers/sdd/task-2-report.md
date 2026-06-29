# Task 2 Report: JSON Output Contract Parser

## Implementation Summary
- Added `server/src/domains/agent-loop/output-contract.ts` with:
  - `parseJsonOutput(text, contract)`
  - `buildJsonRepairPrompt(previousOutput, errors)`
  - `createObjectJsonContract(schema, repairAttempts = 1)`
- Exported the new parser helpers from `server/src/domains/agent-loop/index.ts`.
- Added focused tests for fenced JSON parsing, schema validation failures, repair prompt generation, and the new contract helper.

## Tests
- Red: `cd /Users/zhvala/SourceCode/zclaudia/.worktrees/lightweight-agent-runner-workflow-migration/server && bash ../scripts/with-project-node.sh ../node_modules/.bin/vitest run --config vitest.config.ts src/domains/agent-loop/__tests__/output-contract.test.ts`
  - Result: failed with `Cannot find module '../output-contract.js'`
- Green: same command after implementation
  - Result: `1 passed`, `5 tests passed`

## TDD Evidence
- Wrote the test file before implementing production code.
- Verified the test suite failed for the missing module.
- Implemented the minimal parser and helper exports.
- Re-ran the exact same vitest command and confirmed green.

## Files Changed
- `server/src/domains/agent-loop/output-contract.ts`
- `server/src/domains/agent-loop/index.ts`
- `server/src/domains/agent-loop/__tests__/output-contract.test.ts`
- `.superpowers/sdd/task-2-report.md`

## Self-Review
- The parser stays scoped to the contract subset used by this task: fenced JSON extraction, object validation, required fields, primitive types, and enums.
- `createObjectJsonContract` matches the brief’s interface requirement and defaults `repairAttempts` to `1`.
- Exports are limited to the new parser helpers plus the existing domain exports.

## Concerns
- The repo’s Vitest config prints a deprecation warning about `test.poolOptions` on every run. It does not block this task, but it is visible in verification output.
- JSON extraction is intentionally lightweight and accepts either fenced JSON or a raw object substring. That matches the task brief, but it is not a full streaming JSON repairer.
