# Batch 00: Baseline Quality Audit

Date: 2026-07-01

Scope: main repository only.

Score: 58 / 100

## Summary

The codebase compiles at the package level and the underlying package test suites mostly pass when executed with the correct Node/pnpm path and, for server tests, outside the restricted sandbox. The repository-level gates are not currently reliable: root `build` and `test` scripts fail in this environment because nested scripts call bare `pnpm`; `lint`, `format:check`, and `check:architecture` fail with real findings.

## Gate Results

| Gate                      | Result              | Evidence                                                                                                        |
| ------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`               | Fail                | Root lint reports 2 errors including hidden local worktree noise. Main source has 1 error and 2423 warnings.    |
| `pnpm format:check`       | Fail                | 1715 total files reported by the root command; 1689 are in main source/script scopes.                           |
| `pnpm check:architecture` | Fail                | 5 explicit architecture boundary violations.                                                                    |
| `pnpm build`              | Fail at root script | Root script calls nested bare `pnpm`; package-level `tsc` and Vite build pass when run through `corepack pnpm`. |
| `pnpm test`               | Fail at root script | Root script calls nested bare `pnpm`; underlying shared/server/desktop tests pass with corrected invocation.    |

## Verified Passing Subchecks

- `shared` build: `tsc` passed.
- `server` build: `tsc` passed.
- `desktop` typecheck: `tsc` passed.
- `desktop` Vite build: passed, with chunk-size warnings.
- `shared` tests: 153 passed.
- `server` tests: 4845 passed, 1 skipped when run outside sandbox.
- `desktop` tests by config:
  - unit: 1181 passed
  - hooks: 149 passed
  - ui: 2199 passed

## Blockers

1. `apps/desktop/src/features/automation/AutomationTree.tsx:85`
   - `@typescript-eslint/no-unused-expressions`
   - The conditional expression mutates a `Set` only for side effects.

2. Root `build` and `test` scripts are not reproducible in the current managed shell.
   - `package.json` scripts wrap commands with `scripts/with-project-node.sh`, but the wrapped command invokes bare `pnpm`.
   - In this environment, `corepack pnpm` is available but bare `pnpm` is not on `PATH`.

3. `apps/desktop` package scripts have the same reproducibility issue.
   - `apps/desktop/package.json` build script invokes bare `pnpm`.
   - `apps/desktop/scripts/test-sequential.mjs` spawns bare `pnpm`.

4. Architecture boundary checks fail.
   - `server/src/domains/projects/routes.ts:37`
   - `server/src/domains/projects/routes.ts:39`
   - `server/src/domains/agent-profiles/routes.ts:164`
   - `server/src/domains/agent-profiles/routes.ts:233`
   - `apps/desktop/src/utils/openPanel.ts:23`
   - `apps/desktop/src/utils/openPanel.ts:72`
   - `apps/desktop/src/utils/openPanel.ts:112`
   - `apps/desktop/src/components/RightSidebarEmptyState.tsx:4`

5. Formatting gate is effectively unusable until the repository is normalized.
   - Main-source formatting drift: 1689 files.
   - Distribution: server 888, desktop 680, shared 60, e2e 50, scripts 11.

## High-Risk Findings

- ESLint scans ignored local worktree directories `.claude/` and `.claire/` because `eslint.config.mjs` ignores `.worktrees/` but not those top-level directories.
- Lint warning volume is high enough to reduce signal quality:
  - `@typescript-eslint/no-non-null-assertion`: 1253
  - `@typescript-eslint/no-explicit-any`: 372
  - `@typescript-eslint/no-unused-vars`: 238
  - `@typescript-eslint/consistent-type-imports`: 232
- Desktop Vite build warns about large chunks:
  - `feature-interactive`: about 1506 kB minified
  - `index`: about 809 kB minified
- Vite reports an ineffective dynamic import: `src/services/api/base.ts` is dynamically imported but also statically imported elsewhere.
- Server tests assume the ability to bind loopback sockets and write under `~/.zclaudia/workspace/skills`; they fail inside the restricted sandbox but pass outside it.
- `apps/desktop/scripts/test-sequential.mjs` hides the actual spawn failure because it does not print `result.error`.

## Scale Signals

- TS/TSX total: about 351703 lines.
- Source/script file count: 2022.
- Test file count: 779.
- Largest areas:
  - `server/src/domains`: about 66096 lines
  - `apps/desktop/src/features`: about 67945 lines
  - `server/src/infra`: about 46373 lines
  - desktop data/connection layer (`hooks`, `services`, `stores`, `facade`): about 42733 lines
  - `server/src/application`: about 42167 lines
- Recent 8 commits are concentrated in desktop automation/chat/workspace and server activities/workflows.

## Recommended Fix Order

1. Make root and desktop build/test scripts use a reproducible pnpm invocation.
2. Fix the single main-source lint error and add ESLint ignores for `.claude/` and `.claire/`.
3. Fix the 5 architecture boundary violations.
4. Normalize formatting in one mechanical change, then keep `format:check` enforced.
5. Split lint warning reduction into focused follow-ups, starting with `any`, non-null assertions, and React hooks warnings.
6. Add better diagnostics to `apps/desktop/scripts/test-sequential.mjs`.
7. Review desktop chunking after the gates are reliable.

## Next Batch

Batch 01 should evaluate `shared/` as the shared contract layer: exports, protocol adaptation, wire models, facade contracts, and cross-package type stability.
