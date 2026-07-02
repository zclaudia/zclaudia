# Batch 06: E2E And Scripts Audit

Date: 2026-07-01

Scope: `e2e/` and `scripts/` in the main repository only.

Out of scope: code under `../zclaudia-gateway`. References to that path are evaluated only when a main-repository script depends on it.

Score: 62 / 100

## Summary

The E2E and scripts layer provides useful coverage for multi-service workflows, release builds, deployment, architecture checks, and targeted test execution. The scripts are generally explicit, use strict shell mode in many high-impact entry points, and include focused tests for the architecture boundary checker.

The main risks are reproducibility and operational safety. Several root and E2E paths still depend on a bare `pnpm` being available, the E2E global setup requires a sibling gateway repository, fixed ports can be reused without proving the service identity, and some helper scripts construct shell commands from user-controlled input. Formatting and lint-warning debt are smaller than the app layers but still enough to reduce gate signal.

## Gate Results

| Gate / Check                         | Result  | Evidence                                                                                                                           |
| ------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Architecture-check script unit tests | Pass    | `node --test scripts/dev/__tests__/check-architecture-boundaries.test.mjs`: 3 tests passed.                                        |
| E2E full suite                       | Skipped | Not run for this audit because global setup starts multi-service E2E and depends on `../zclaudia-gateway`, which is outside scope. |
| E2E/scripts ESLint                   | Pass    | 84 JS/TS files evaluated, 0 errors, 73 warnings.                                                                                   |
| E2E/scripts Prettier                 | Fail    | 63 files in this batch scope need formatting.                                                                                      |
| Reproducible root script execution   | Fail    | Root scripts wrap `pnpm`, but `scripts/with-project-node.sh` execs the provided command without resolving `pnpm` through Corepack. |

The `fnm` symlink warning printed in this sandbox during command execution did not prevent the evaluated checks from running.

## Scale Snapshot

- Files in scope: 100 script/test files.
- Lines in scope: about 18,799 lines.
- Largest files include:
  - `scripts/build/android.sh`: 573 lines.
  - `scripts/diagnostics/test-interaction-tools.js`: 557 lines.
  - `scripts/build/macos.sh`: 557 lines.
  - `e2e/tests/project-management.spec.ts`: 501 lines.
  - `scripts/deploy/setup-server.sh`: 336 lines.
  - `scripts/dev/start-app.sh`: 258 lines.
  - `scripts/assets/regenerate-icons.mjs`: 255 lines.
  - `scripts/dev/check-architecture-boundaries.mjs`: 241 lines.
  - `scripts/dev/test-file-by-file.mjs`: 229 lines.

## Score Breakdown

- Architecture boundaries: 11 / 20
- Type and interface contracts: 10 / 15
- Test quality: 10 / 20
- Maintainability: 9 / 15
- Reliability: 9 / 15
- Security and privacy: 8 / 10
- Engineering experience: 5 / 5

## Strengths

- The architecture boundary checker has a small native `node:test` suite.
- Most high-impact shell scripts use `set -euo pipefail`.
- E2E setup uses isolated data under `.tmp/e2e-data` and starts gateway, server, and desktop in a deterministic order.
- Vitest E2E config runs files sequentially for database consistency and disables `.only` in CI.
- Deployment scripts preserve existing environment/data files instead of deleting them during uninstall.
- Release/build scripts include preflight checks and platform-specific validation.

## Findings

### Project Node Wrapper Does Not Resolve The Package Manager

Root scripts invoke `bash scripts/with-project-node.sh pnpm ...`, but the wrapper directly `exec`s the command when the active Node version already matches `.node-version`. If `pnpm` is not on `PATH`, root build, test, desktop build, and E2E setup can fail even though `packageManager` pins `pnpm@9.15.0`.

Recommended direction: teach `scripts/with-project-node.sh` to resolve `pnpm` through Corepack, or change workspace scripts to call `corepack pnpm` consistently. Keep the behavior identical in the matching-node and `fnm exec` branches.

### E2E Setup Depends On A Sibling Gateway Repository

`e2e/setup/global-setup.ts` resolves `GATEWAY_DIR` to `../zclaudia-gateway`, builds it with `pnpm run build`, and starts `node dist/index.js` from that directory. That makes main-repository E2E tests non-hermetic and impossible to evaluate in a main-repo-only checkout.

Recommended direction: either make gateway a declared test fixture/artifact for main-repo E2E, or split gateway-dependent tests into an explicit integration profile that checks the sibling path and fails with a clear diagnostic.

### Local E2E Can Reuse Any Process On The Expected Ports

Outside CI, E2E setup reuses existing services when a port is open. The check only proves that `localhost:3310`, `3320`, or `1421` accepts TCP connections; it does not verify health, protocol version, gateway secret, data directory, or that the process is actually ZClaudia.

Recommended direction: replace raw port reuse with service-specific health probes and expected metadata checks. If a port is occupied by an unexpected process, fail early with a clear message instead of silently reusing it.

### Architecture Boundary Checker Is Too Narrow For Current Server Shapes

The checker only scans `server/src/domains/**/routes.ts` for direct SQL. Earlier batches found direct SQL in route-like and registration files that are not named exactly `routes.ts`, so the tool can pass while server boundary violations remain.

Recommended direction: expand the scan to route/register/handler file patterns, add negative tests for `*-routes.ts` and `register.ts`, and make allowlists explicit when a migration exception is intentional.

### Test-File Helper Builds Shell Commands From Input

`scripts/dev/test-file-by-file.mjs` interpolates the user-provided path into a `find` command string and later builds `cd ... && npx vitest ...` shell strings. It also advertises `../zclaudia-gateway/src` as a supported target from inside the main repo helper. This is risky for paths with spaces/metacharacters and makes test helper behavior depend on undeclared external checkout layout.

Recommended direction: replace shell strings with `spawnSync` argument arrays, constrain accepted paths to the main repository by default, and add an explicit `--gateway` or separate helper if cross-repo testing is intended.

### Deploy Scripts Use Mutable Package Manager Resolution

`scripts/deploy/setup-server.sh` installs `pnpm@latest` through Corepack when `pnpm` is missing, while other deploy paths require a global `pnpm` and fall back from `pnpm install --frozen-lockfile` to mutable `pnpm install`. That can make production deployment use a different package manager or dependency tree than local and CI runs.

Recommended direction: use the repository `packageManager` version through Corepack and fail when the frozen install fails, unless an explicit `--repair-install` mode is requested.

### Platform Build Scripts Are Large And Duplicative

The Android and macOS build scripts are both over 550 lines and repeat environment setup, Node manager handling, package install/build, signing, cleanup, and artifact verification logic. Long shell scripts make it harder to test release behavior and easier for platform-specific fixes to diverge.

Recommended direction: extract shared Node/Corepack/bootstrap, version, signing, and artifact helpers into smaller scripts or a typed Node build orchestrator. Keep platform shell wrappers thin and focused on platform-only commands.

### E2E And Scripts Formatting/Lint Debt Still Reduces Signal

This batch has 63 files failing Prettier and 73 ESLint warnings across 84 evaluated JS/TS files. Most warnings are unused variables, type-only import cleanup, and a few non-null assertions.

Recommended direction: include E2E and scripts in the mechanical format pass, then clean unused variables in test helpers/specs so script lint remains a useful signal.

## Test Gaps

- Full E2E was not executed in this main-repo-only audit because it currently requires the sibling gateway repository.
- No test proves that E2E port reuse is talking to the expected service identity and data directory.
- The architecture checker tests do not cover `*-routes.ts`, `register.ts`, or handler-like server files.
- Shell helpers are not covered by tests for paths with spaces, metacharacters, missing `pnpm`, or missing sibling gateway checkout.
- Build/deploy scripts do not have dry-run or smoke-test coverage for generated commands.

## Suggested Fix Order

1. Make `scripts/with-project-node.sh` resolve `pnpm` through Corepack, then re-run root build/test gates.
2. Split main-repo-only E2E from gateway-integration E2E or make the gateway fixture explicit.
3. Replace local E2E raw port reuse with health and identity checks.
4. Expand architecture boundary checks to all route/register/handler shapes.
5. Convert `test-file-by-file.mjs` from shell strings to argument-array spawning and constrain default paths to the main repo.
6. Pin deploy package-manager behavior to `packageManager` and remove mutable install fallback from default deployment.
7. Extract shared build/deploy helpers from large platform scripts.
8. Format `e2e/` and `scripts/`, then clean lint warnings.

## Next Batch

All planned audit batches are complete. Use `findings.json` as the source of truth for the optimization plan.
