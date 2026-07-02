# Quality Audit

Scope: main repository only, rooted at `/Users/zhvala/SourceCode/zclaudia`.

Out of scope for this audit: `../zclaudia-gateway`.

## Evaluation Standard

Each batch is scored out of 100:

- Architecture boundaries: 20
- Type and interface contracts: 15
- Test quality: 20
- Maintainability: 15
- Reliability: 15
- Security and privacy: 10
- Engineering experience: 5

Hard gates:

- `pnpm lint`
- `pnpm format:check`
- `pnpm check:architecture`
- `pnpm build`
- `pnpm test`

If a hard gate fails, the batch cannot be considered healthy until the failure is either fixed or explicitly reclassified as an environment-only failure with evidence.

## Batch Plan

| Batch | Area                                      | Status   | Report                                       |
| ----- | ----------------------------------------- | -------- | -------------------------------------------- |
| 00    | Baseline                                  | Complete | [00-baseline.md](00-baseline.md)             |
| 01    | `shared/` contract layer                  | Complete | [01-shared.md](01-shared.md)                 |
| 02    | `server/` infrastructure                  | Complete | [02-server-infra.md](02-server-infra.md)     |
| 03    | `server/` domains                         | Complete | [03-server-domains.md](03-server-domains.md) |
| 04    | `apps/desktop/` data and connection layer | Complete | [04-desktop-data.md](04-desktop-data.md)     |
| 05    | `apps/desktop/` UI feature layer          | Complete | [05-desktop-ui.md](05-desktop-ui.md)         |
| 06    | `e2e/` and `scripts/`                     | Complete | [06-e2e-scripts.md](06-e2e-scripts.md)       |

## Persistent Findings

Structured findings live in [findings.json](findings.json). Use it as the source of truth for the final optimization plan.

Recommended final prioritization:

1. Fix blocker findings that prevent reliable gates.
2. Restore architecture boundary checks.
3. Restore formatting and lint signal quality.
4. Address reliability and test-environment risks.
5. Reduce maintainability debt by module risk.
