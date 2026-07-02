# Batch 01: Shared Contract Layer Audit

Date: 2026-07-01

Scope: `shared/` only.

Score: 76 / 100

## Summary

`shared` is generally healthy as a strict TypeScript contract package. It builds cleanly, its tests pass quickly, and it does not import platform-specific dependencies such as React, Tauri, Express, SQLite, or Node filesystem APIs from source. The main risks are contract-governance issues: a very broad root entrypoint, manually maintained wire unions, incomplete validation tests for plugin manifests, and formatting drift.

## Gate Results

| Gate                                       | Result             | Evidence                         |
| ------------------------------------------ | ------------------ | -------------------------------- |
| `pnpm --filter @zclaudia/shared run build` | Pass               | `tsc` completed successfully.    |
| `pnpm --filter @zclaudia/shared run test`  | Pass               | 21 test files, 153 tests passed. |
| `pnpm --filter @zclaudia/shared run lint`  | Pass with warnings | 0 errors, 107 warnings.          |
| `prettier --check shared/src ...`          | Fail               | 60 shared files need formatting. |

## Score Breakdown

- Architecture boundaries: 15 / 20
- Type and interface contracts: 12 / 15
- Test quality: 15 / 20
- Maintainability: 10 / 15
- Reliability: 12 / 15
- Security and privacy: 8 / 10
- Engineering experience: 4 / 5

## Strengths

- Strict TypeScript is enabled in `shared/tsconfig.json`.
- Package emits declarations and declaration maps.
- Source has no detected imports from React, Tauri, Express, SQLite, `ws`, or Node filesystem/path/crypto APIs.
- Subpath exports exist for `core/*`, `features/*`, `interaction/*`, `wire/*`, `facade/*`, `plugins`, and `plugins/*`.
- `facade` has meaningful unit/integration coverage around registry, runtime core, stream manager, and snapshot behavior.
- `wire/correlation` has basic guard tests ensuring requests/responses/streams are not misclassified as events.

## Findings

### Formatting Drift

`shared` has 60 files failing Prettier. This is not functionally dangerous by itself, but it keeps `format:check` red and makes unrelated diffs noisy.

### Root Entrypoint Is Too Broad

`shared/src/index.ts` re-exports core, feature, interaction, wire, plugin, and facade APIs. It even re-exports `facade/index.ts`, whose comments describe it as UI-facing. At the same time, many consumers import from `@zclaudia/shared` directly: 283 files and 323 import lines were observed. This makes ownership boundaries hard to enforce.

Recommended direction: keep root imports for backward compatibility, but document and gradually migrate consumers to subpath imports. Server code should not need to see UI-facing facade runtime APIs through the root package.

### Root Entrypoint Is Not Complete

`package.json` exposes broad subpath exports, but the root compatibility entrypoint does not re-export every contract module. Examples omitted from root include:

- `core/agent-readiness`
- `core/provider-policy`
- `features/executor`
- `features/spec-change`
- `features/meta-workflow`

This is acceptable if intentional, but it should be documented as "root is legacy convenience, subpaths are canonical" rather than treated as a full API surface.

### Wire Message Union Is Manual

`shared/src/wire/messages/index.ts` aggregates all wire modules and hand-maintains `ClientMessage` and `ServerMessage`. This is workable, but every new message type requires remembering to update the union manually. Current tests only prove a few meta-workflow messages flow through the union.

Recommended direction: add compile-time type tests for every wire message module or define unions closer to the modules so new message types are harder to forget.

### Plugin Manifest Validation Is Under-Tested

`validatePluginManifest` and `resolvePluginPlatform` have no direct shared-package tests. The validation logic checks required manifest fields and some contribution shapes, but tests should lock down edge cases before plugin contracts grow further.

Recommended direction: add tests for required fields, id format, semver warning behavior, platform inference, invalid contribution entries, and `frontend` platform inference.

### Runtime/Internal Facade Types Are Public

`facade/types.ts` marks `BackendRuntimeRecord`, `DesiredSessionStream`, and `SessionStreamRuntime` as internal, but `facade/index.ts` re-exports broad runtime classes and adapter contracts. This may be intentional for desktop tests and providers, but it means internal state shapes are part of the public package surface.

Recommended direction: split facade exports into public UI API and internal runtime API, or explicitly document that the facade runtime is a supported internal subpath only.

### Lint Warning Debt

`shared` lint has 107 warnings:

- Non-null assertions dominate tests and appear in runtime code.
- `wire/correlation.ts` uses `any` in type guards.
- `facade/stream-manager.ts` has unused imported types.
- Several wire message files use `import()` type annotations that violate the local style rule.

Recommended direction: fix production-source warnings first, then decide whether tests should allow non-null assertions or use local helpers.

## Test Gaps

- No direct tests for plugin manifest validation.
- No comprehensive compile-time checks that every exported wire message interface is included in `ClientMessage` or `ServerMessage`.
- No packaging smoke test that imports representative public subpaths from the built `dist` output.

## Suggested Fix Order

1. Format `shared` as part of the repository-wide formatting normalization.
2. Add plugin manifest validation tests.
3. Add wire-union compile-time coverage per message module.
4. Document root-vs-subpath import policy and migrate new code to subpaths.
5. Split or document facade public/internal exports.
6. Reduce production-source lint warnings in `shared`.

## Next Batch

Batch 02 should evaluate `server/` infrastructure: HTTP/WebSocket setup, storage/migrations, gateway client, runtime/provider boundary, file storage, and security-sensitive utilities.
