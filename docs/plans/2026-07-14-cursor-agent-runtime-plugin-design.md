# Cursor Agent Runtime Plugin Design

## Goal

Migrate the Cursor (`cursor-agent`) integration from `my-claudia` into `zclaudia` as a first-class project plugin, following the same shape as `plugins/claude`. Deliver a minimal, working chat loop with MCP tool-bridge injection and mode support (`default` / `plan` / `ask`), without restoring my-claudia's provider-config UI or putting Cursor runners under `server/infra/providers`.

## Context

- Claude already lives in `zclaudia/plugins/claude`: `plugin.json` declares `contributes.agentRuntimes` + optional `agentProfiles`; `activate` registers an `ExternalAgentAdapter` via `context.agentRuntimes.register`.
- `AgentProfileConfig.runtimeType` already accepts `'cursor'` (`AGENT_RUNTIME_TYPES`), but no Cursor adapter is registered yet (`providerRegistry.get('cursor')` is undefined).
- `my-claudia` implements Cursor as `cursor-adapter.ts` + `cursor-sdk.ts`: spawn `cursor-agent`, parse NDJSON, inject MCP into `.cursor/mcp.json`, normalize `switchMode` / `createPlan`, abort child processes.

## Decisions (locked)

| Topic | Choice |
|---|---|
| Scope | Minimal viable (aligned with Claude phase 1): chat stream, resume, cancel |
| Packaging | Direct `plugins/cursor` sibling to Claude (no server staging) |
| MCP | Basic host `createToolBridge` + merge into `<cwd>/.cursor/mcp.json` |
| Modes | `default`, `plan`, `ask` with `modeSwitchSessionPolicy: 'preserve'` |
| Plan UX | Normalize `switchMode` / `createPlan` into `mode_transition` / `toolSemantic`; **defer** client-side plan decision card |
| Deferred | Full image pipeline, background tasks, CLI jobs, OAuth hint rewriting, live smoke in CI |

## Architecture

Host owns profiles, sessions, run lifecycle, and registry. The plugin owns Cursor-specific execution and event translation.

```
Agent Profile (runtimeType=cursor)
        │
        ▼
Host run bootstrap → providerRegistry(get cursor)
        │
        ▼
plugins/cursor  CursorAgentAdapter  (ExternalAgentAdapter)
        │  createToolBridge() ──► host MCP bridge entry
        │  merge into <cwd>/.cursor/mcp.json
        ▼
runCursor()  spawn cursor-agent -p … --output-format stream-json
        │
        ▼
NDJSON → ProviderRuntimeEvent
        │
        ▼
Existing zclaudia conversation runtime
```

Boundary table:

| Layer | Owns |
|---|---|
| `AgentProfileConfig` | `runtimeType=cursor`, model, systemPrompt, cliPath |
| Host | Adapter selection, abort orchestration, `sdk_session_id`, capabilities HTTP |
| `plugins/cursor` | CLI spawn, stream parse, mode mapping, MCP file inject, process abort |

Cursor does not use `LlmProfileConfig` to call an HTTP API. `llmProfileId` may remain on the profile for schema/UI consistency; the adapter ignores it for execution.

Missing Cursor adapter must fail closed (existing host rule): never fall back to `zclaudia`.

## Components

Package: `zclaudia/plugins/cursor` (`@zclaudia/plugin-cursor`), workspace member via existing `plugins/*`.

| File | Responsibility |
|---|---|
| `plugin.json` | Declare `agentRuntimes[type=cursor]` (label, `hasCliPath`, model config kind, capabilities summary, PCP manifest, policy) and default profile `cursor-default` |
| `src/main.ts` | `activate`: register `CursorAgentAdapter` with `createToolBridge` from context |
| `src/adapter.ts` | `ExternalAgentAdapter`: `sessionModes` map, `run` / `abort` / `setSessionMode` / `getRunState` |
| `src/runner.ts` | Port of my-claudia `cursor-sdk`: spawn, CLI flags, NDJSON→`ProviderRuntimeEvent`, plan-tool normalization, abort map |
| `src/mcp-inject.ts` | Merge bridge entry into `.cursor/mcp.json` without clobbering user servers; same-name user entry wins |
| `src/resolve-cli.ts` | Resolve explicit `cliPath` or `cursor-agent` on `PATH` |
| `src/__tests__/*` | Unit tests for adapter, runner (mocked spawn), mcp-inject |

Host changes stay minimal: load/register plugin contributions; surface Cursor in profile runtime picker if contribution-driven UI already supports it. Do **not** place Cursor under `server/src/infra/providers/external-agents/cursor`.

### Manifest and policy (phase 1)

- Chat / run modes exposed to the UI and passed as `context.mode`: `default`, `plan`, `ask` (CLI `--mode=` / default `--yolo`).
- `permissionModeMap` (PCP keys → Cursor CLI mode), starting from my-claudia Cursor:
  - `supervised` → `default`
  - `plan_only` → `plan`
  - Include an `ask` mapping only if the host PCP permission enum already has a matching key; otherwise `ask` is selected as a chat mode id, not inventing new PCP enum values in this phase.
- Policy: `modeSwitchSessionPolicy: 'preserve'` (required so `--resume` works with `--mode=plan|ask`).
- Capability claims (truthful):
  - Supported: `chat.stream`, `tool.call` (native), `tool.inject` (bridged via mcp.json), `permission.mode`, `session.abort`.
  - Unsupported / degraded for phase 1: `input.image` (full attachment pipeline deferred), `session.background_task`, and other unproven interaction paths unless the shared MCP bridge demonstrably covers them—prefer conservative Claude-style honesty over copying every my-claudia claim.

## Data flow

1. **Profile** — User creates or selects an agent with `runtimeType = cursor` (optionally from contributed `cursor-default`). Optional `cliPath`, `model`, `systemPrompt`.

2. **Run bootstrap** — Host resolves profile → `providerRegistry.get('cursor')` → builds `ExternalAgentRunContext` (cwd, mode, model, cliPath, sessionId for resume, serverPort, claudiaSessionId, abortController, systemPrompt).

3. **Adapter prep**
   - Effective mode = `sessionModes.get(session) ?? context.mode` (AI-initiated transitions stick for the next spawn until the user overrides).
   - `createToolBridge({ serverPort, sessionId })`; if non-null, merge into `.cursor/mcp.json`.
   - Prepend `systemPrompt` to the user prompt (Cursor CLI has no native system-prompt flag).

4. **Spawn** — `cursor-agent -p <prompt> --output-format stream-json --trust`
   - `--mode=plan` or `--mode=ask` when applicable; otherwise `--yolo` for default/agent so non-interactive bash is not auto-rejected.
   - `--resume <sessionId>` when a provider session id exists.
   - `--model <id>` when set.

5. **Stream** — Map NDJSON to `ProviderRuntimeEvent`: `init` (provider session id), assistant text, tool start/end (with `toolSemantic` where applicable), `mode_transition` from `switchMode`, result/error. Persist `init.sessionId` for resume.

6. **Cancel** — Host abort → adapter kills the child process and clears session mode / process maps.

7. **Mode policy** — Preserve provider chat id across mode switches.

## Error handling

| Scenario | Behavior |
|---|---|
| Binary missing (`ENOENT`) | Yield `error` with install / `cliPath` guidance |
| Other spawn failures | Yield `error` with message |
| Non-JSON stdout lines `I:` / `E:` / `W:` | Yield as provider `error` |
| Stderr CLI messages with no useful stdout | Surface collected `I:`/`E:`/`W:` as `error` |
| Non-CLI JSON parse failures | Warn, skip line, continue stream |
| Abort / kill | Clean maps; do not disguise abort as an unexplained crash |
| `createToolBridge` returns null | Skip MCP inject; still run native Cursor |
| Unreadable `.cursor/mcp.json` | Start from empty config for merge; on write failure, log and continue without bridge |
| User MCP server same name as bridge | Do not overwrite user entry |
| Runtime selected but adapter missing | Host fails closed (no zclaudia fallback) |
| Unclosed think block at stream end | Emit closing marker so UI does not stick |

Defer Cursor-specific auth / OAuth hint rewriting.

## Testing

### Plugin (`plugins/cursor`, no network / no real CLI in default CI)

1. **Adapter** — `type === 'cursor'`; context plumbing to runner; `setSessionMode` affects next turn; abort clears state; bridge factory invoked and result passed to inject.
2. **Runner** (mock spawn / fake NDJSON) — init session id; assistant streaming; tool start/end; `switchMode` → `mode_transition`; `createPlan` → `toolSemantic=plan_proposal`; ENOENT message; stderr-only errors; CLI arg assembly for resume / modes / `--yolo`; abort kills process.
3. **mcp-inject** — merge write; preserve user servers; same-name no-clobber; create `.cursor` directory when missing.

### Host / shared (only if gaps)

4. Registry: after plugin activate, `get('cursor')` is defined; without plugin remains undefined.
5. Profile API: `runtimeType: 'cursor'` save/load smoke if not already covered.
6. UI: Cursor appears in runtime selector when contributions are loaded.

### Out of scope for phase 1 tests

Live smoke requiring Cursor login in CI; plan decision card E2E; CLI job adapters.

### Acceptance

Create/select Cursor agent → one streaming chat turn → resume → cancel; modes `default` / `plan` / `ask` selectable; when bridge tools exist, `.cursor/mcp.json` contains the injected server under the bridge name without destroying user entries.

## Migration source map

| my-claudia | zclaudia plugin |
|---|---|
| `cursor-adapter.ts` | `plugins/cursor/src/adapter.ts` |
| `cursor-sdk.ts` (run + map + abort) | `plugins/cursor/src/runner.ts` |
| MCP inject in `cursor-sdk.ts` | `plugins/cursor/src/mcp-inject.ts` + host `createToolBridge` |
| `CURSOR_*` in `manifests.ts` | `plugin.json` contributes.manifest / policy |
| CLI jobs / review adapters | Deferred |

## Non-goals

- Staging under `server/.../external-agents/cursor` before plugin extraction.
- Restoring my-claudia `ProviderConfig` UI / provider tables.
- Plan decision card UX, full multimodal attachment handling, background task tracking, CLI review jobs.
- Falling back to the `zclaudia` (pi-agent) runtime when Cursor is selected.
