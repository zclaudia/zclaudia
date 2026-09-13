# Cursor ACP P0 probe assets

Audit assets for the Cursor runtime ACP migration
(`docs/plans/2026-09-12-cursor-acp-migration.md`). These files are **not** part
of the production plugin package — the directory is excluded from the build and
from builtin staging.

## What lives here

| Asset                    | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `lib/jsonrpc.mjs`        | Minimal bare JSON-RPC / NDJSON stdio client (deliberately SDK-free)                |
| `probe-initialize.mjs`   | Handshake + capability surface (§2.1) — safe logged out                            |
| `probe-auth-session.mjs` | `authenticate` + `session/new` + modes/models + `set_mode`/`set_model` (§2.2/§2.3) |
| `probe-session-load.mjs` | Cross-process `session/load`, history replay, legacy-id load failure (§2.4)        |
| `probe-inline-mcp.mjs`   | Inline stdio MCP end-to-end, placeholder tool_call shape (§2.5)                    |
| `probe-permissions.mjs`  | Permission options shape, deny→`completed` trap (§2.6)                             |
| `probe-plan-mode.mjs`    | Plan mode workspace isolation, `cursor/create_plan` (§2.7)                         |
| `probe-cancel.mjs`       | `session/cancel` latency and clean shutdown (§2.8)                                 |
| `fixtures/*.json`        | Sanitized recorded outputs                                                         |
| `environment.json`       | CLI/OS versions and last-run record                                                |

## Running

```bash
cd plugins/agents/cursor
node probes/probe-initialize.mjs --out probes/fixtures/initialize.json   # no login needed
node probes/probe-auth-session.mjs --write-fixture                        # needs logged-in CLI
node probes/probe-session-load.mjs --write-fixture
node probes/probe-inline-mcp.mjs --write-fixture
node probes/probe-permissions.mjs --write-fixture
cd "$(mktemp -d)" && node <repo>/plugins/agents/cursor/probes/probe-plan-mode.mjs --write-fixture
node probes/probe-cancel.mjs --write-fixture
```

Cost notes: probes 2–7 each spend one short LLM turn on the logged-in account.
The plan-mode probe asks for a workspace write and must run in a scratch
directory; it auto-declines every permission/extension request.

## Policy

- Re-run **all** probes after every Cursor CLI upgrade; write results back to
  design doc §2. A behavior drift invalidates ACP defaults until triaged.
- Fixtures must stay sanitized: no tokens, no absolute home paths, no prompt
  content beyond fixed canaries. The lib's `sanitize()` handles the known
  shapes; review diff output before committing.
- `acp` is not listed in `cursor-agent --help`; availability is proven by the
  runtime handshake only (§2.1). Never gate on CLI version strings.
