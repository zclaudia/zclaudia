# Codex Agent Runtime Plugin Design

## Goal

Migrate the Codex integration from `my-claudia` into `zclaudia` as a first-class project plugin (`plugins/codex`), following the same shape as `plugins/claude` and `plugins/cursor`. Deliver an App Server–based chat loop with MCP tool-bridge injection, approval bridging, and mode support, without restoring my-claudia's provider-config UI or staging runners under `server/infra/providers`.

## Context

- Claude lives in `zclaudia/plugins/claude`; Cursor in `plugins/cursor`. Both register an `ExternalAgentAdapter` via `context.agentRuntimes.register` and declare runtime metadata in `plugin.json`.
- `AgentProfileConfig.runtimeType` already accepts `'codex'` (`AGENT_RUNTIME_TYPES`), but no Codex adapter is registered yet.
- `my-claudia` uses **`CodexAppServerAdapter`** (not the legacy `@openai/codex-sdk` adapter): spawn `codex app-server`, JSON-RPC over stdio, true streaming deltas, approval requests via server requests, MCP via stable config TOML.
- `zclaudia` already has **LLM profile** Codex OAuth (`openai-codex` provider type). That is separate from the **agent runtime** `codex`, which relies on the local `codex` CLI auth in `~/.codex`.

## Decisions (locked)

| Topic | Choice |
|---|---|
| Runtime path | **App Server** (`codex app-server --listen stdio://`) — matches my-claudia production registry |
| Scope | **Phase 1 B**: chat stream, resume, cancel, MCP bridge, approval bridge, plan event normalization |
| Packaging | Direct `plugins/codex` sibling to Claude/Cursor (no server staging) |
| MCP | Host `createToolBridge` → merge into `$ZCLAUDIA_DATA_DIR/codex-config/.codex/config.toml` |
| Modes | `default`, `plan`, `acceptEdits`, `bypassPermissions` with `modeSwitchSessionPolicy: 'preserve'` |
| Plan UX | Normalize `EnterPlanMode` / `ExitPlanMode` → `mode_transition` / `toolSemantic`; defer client plan decision card |
| Auth | Local `codex` CLI login only; do not wire zclaudia LLM OAuth into runtime execution |
| Deferred | form/todo interaction UI, image attachments, DB/user MCP injection, CLI jobs, AI review, live smoke in CI, SDK rate-limit auto-retry |

## Architecture

Host owns profiles, sessions, run lifecycle, and registry. The plugin owns Codex App Server execution, approval bridging, and event translation.

```
Agent Profile (runtimeType=codex)
        │
        ▼
Host run bootstrap → providerRegistry.get('codex')
        │
        ▼
plugins/codex  CodexAgentAdapter  (ExternalAgentAdapter)
        │  createToolBridge() ──► host MCP bridge (claudia-plugins)
        │  writeMcpConfig()   ──► $ZCLAUDIA_DATA_DIR/codex-config/.codex/config.toml
        │  ensureCodexProjectTrusted() ──► ~/.codex/config.toml trust_level
        ▼
getOrCreateAppServerClient()
  spawn `codex app-server` (processCwd = codex-config dir)
  ZCLAUDIA_SESSION_ID in env for bridge routing
        │
        ▼
thread/start { cwd: project }  or  thread/resume
        │
        ▼
runTurn → JSON-RPC notifications → map-events → ProviderRuntimeEvent
        │                              │
        │                              ├─ assistant text (delta + final)
        │                              ├─ tool_start / tool_result
        │                              ├─ mode_transition (Enter/ExitPlanMode)
        │                              └─ error / init / usage
        ▼
handleServerRequest(approval) → permissions.ts → onPermission(host)
        │
        ▼
Existing zclaudia conversation runtime
```

Boundary table:

| Layer | Owns |
|---|---|
| `AgentProfileConfig` | `runtimeType=codex`, model, systemPrompt, cliPath |
| Host | Adapter selection, abort orchestration, `sdk_session_id`, capabilities HTTP, `createToolBridge` |
| `plugins/codex` | App Server spawn, JSON-RPC, approval bridge, MCP TOML, mode mapping, event translation, process lifecycle |

Codex agent runtime does not call zclaudia LLM profile HTTP APIs. `llmProfileId` may remain on the profile for schema/UI consistency; the adapter ignores it for execution.

Missing Codex adapter must fail closed (existing host rule): never fall back to `zclaudia`.

### vs my-claudia

| Point | my-claudia | zclaudia plugin |
|---|---|---|
| Event types | `ClaudeMessage` | `ProviderRuntimeEvent` |
| MCP bridge | `buildMcpBridgeEntry` + DB MCP | `createToolBridge` only (Phase 1) |
| Config dir | `~/.my-claudia/codex-config` | `$ZCLAUDIA_DATA_DIR/codex-config` |
| Session env | `CLAUDIA_SESSION_ID` | `ZCLAUDIA_SESSION_ID` (also accept legacy name in bridge) |
| Process supervisor | `getGlobalProcessSupervisor()` | Direct spawn/kill in Phase 1 |

## Components

Package: `zclaudia/plugins/codex` (`@zclaudia/plugin-codex`), workspace member via existing `plugins/*`.

```
plugins/codex/
├── plugin.json
├── package.json
├── tsconfig.json
└── src/
    ├── main.ts
    ├── adapter.ts
    ├── runner.ts
    ├── app-server-client.ts
    ├── config.ts
    ├── map-events.ts
    ├── permissions.ts
    ├── tool-effects.ts
    ├── resolve-cli.ts
    └── __tests__/
```

| File | Responsibility |
|---|---|
| `plugin.json` | Declare `agentRuntimes[type=codex]`, PCP manifest, policy (`escalateAlwaysTools: ['ExitPlanMode']`), default profile `codex-default` |
| `src/main.ts` | `activate`: register `CodexAgentAdapter` with `createToolBridge` from context |
| `src/adapter.ts` | `ExternalAgentAdapter`: session mode map, `run` / `abort` / `setSessionMode` / `getRunState` |
| `src/runner.ts` | Client cache, thread start/resume, session recovery, turn orchestration, idle cleanup hooks |
| `src/app-server-client.ts` | JSON-RPC process, `runTurn`, approval dispatch, interrupt |
| `src/config.ts` | MCP TOML write, mode→`-c` args, env build, input prep, project trust |
| `src/map-events.ts` | App Server items → `ProviderRuntimeEvent`; plan tool semantics |
| `src/permissions.ts` | Approval → `PermissionRequest`; mode-based auto rules |
| `src/tool-effects.ts` | Shell/file change effects for tool events |
| `src/resolve-cli.ts` | Resolve explicit `cliPath` or `codex` on `PATH` |

Host changes (minimal):

- `server/src/interfaces/http/provider-capabilities.ts` — add `CODEX_CAPABILITIES`
- `server/src/interfaces/http/provider-commands.ts` — allowlist `'codex'`
- `.gitignore` — `!/plugins/codex/`
- `server/src/application/plugins/__tests__/codex-plugin-lifecycle.test.ts`

Do **not** place Codex under `server/src/infra/providers/external-agents/codex`.

### Manifest and policy (phase 1)

Capability claims (truthful):

| Capability | Phase 1 |
|---|---|
| `chat.stream` | ✅ native |
| `tool.call` | ✅ native |
| `tool.inject` | ✅ bridged (MCP TOML) |
| `interaction.approval` | ✅ bridged (`onPermission`) |
| `permission.mode` | ✅ native |
| `session.abort` | ✅ native |
| plan normalization | ✅ `EnterPlanMode` / `ExitPlanMode` |
| `interaction.form` | ❌ defer (decline empty) |
| `interaction.todo` | ❌ defer |
| `input.image` / `input.text_file` / `input.binary_file` | ❌ defer |
| `session.steer` / `session.background_task` | ❌ defer |

`permissionModeMap`:

- `supervised` → `default`
- `auto_edit` → `acceptEdits`
- `autonomous` → `bypassPermissions`
- `plan_only` → `plan`

Policy: `modeSwitchSessionPolicy: 'preserve'`, `escalateAlwaysTools: ['ExitPlanMode']`.

HTTP capabilities (`CODEX_CAPABILITIES`): modes `default`, `plan`, `acceptEdits`, `bypassPermissions`; `supportsAIReview: false`.

## Data flow

1. **Profile** — User selects agent with `runtimeType = codex` (optionally `codex-default`). Optional `cliPath`, `model`, `systemPrompt`.

2. **Run bootstrap** — Host resolves profile → `providerRegistry.get('codex')` → builds `ExternalAgentRunContext`.

3. **Adapter prep**
   - Effective mode = `sessionModes.get(claudiaSessionId) ?? context.mode`.
   - `createToolBridge({ serverPort, sessionId: claudiaSessionId })`.
   - `writeMcpConfig` merges bridge into stable codex-config TOML.
   - `ensureCodexProjectTrusted` for config dir.

4. **Client** — `getOrCreateAppServerClient` spawns/reuses `codex app-server` with mode/model `-c` args.

5. **Thread** — `thread/resume(sessionId)` when resuming and cwd is compatible; else `thread/start { cwd }`. Yield `init` with provider session id (thread id).

6. **Turn** — `runTurn` streams JSON-RPC notifications → `map-events` → `ProviderRuntimeEvent`. Persist thread id for resume.

7. **Approval** — App Server `item/*/requestApproval` → `permissions.handleApproval` → host `onPermission` → `{ decision: accept|decline }`.

8. **Dynamic mode** — Host receives `mode_transition` from EnterPlanMode → `adapter.setSessionMode` → `client.currentMode` updated for subsequent approvals.

9. **Cancel** — `turn/interrupt` best-effort; clear session maps and modes.

10. **MCP bridge** — Bridge subprocess inherits `ZCLAUDIA_SESSION_ID` from app-server parent env; host routes to correct session.

## Error handling

| Scenario | Behavior |
|---|---|
| `codex` not found (`ENOENT`) | Yield `error` with install / `cliPath` guidance |
| App-server process exit | Reject pending RPC; runTurn fails → error event |
| JSON-RPC error response | Turn fails → error event |
| `turn/failed` / `error` notification | `extractErrorMessage` → error event |
| Resume failure | Log; fallback `startThread(cwd)` |
| Resumed session corrupt | Detect `SESSION_RECOVERY_PATTERNS`; one fresh-thread retry + user-visible recovery notice |
| Cwd-bound worktree, lost cwd record | Skip resume; `startThread` to avoid wrong checkout writes |
| Approval callback throws | Decline; do not hang app-server |
| No permission callback | Decline (fail closed) |
| Plan mode writes | Auto decline |
| `requestUserInput` / MCP elicitation | Empty/decline (Phase 1; avoid hang) |
| Unknown server request | Log + empty `{}` response |
| MCP config write failure | Warn; continue without bridge (or yield warning event) |
| Trust config update failure | Warn only |
| Abort / interrupt failure | Log only |
| Auth / quota errors | Surface Codex CLI message as error; no OAuth hint rewriting |
| Idle cleanup | 30 min idle + no active turns → destroy client; plugin `deactivate` destroys all |

Retry in Phase 1:

- ✅ Session recovery (one fresh thread)
- ✅ Resume fallback to new thread
- ❌ SDK-style rate-limit auto-retry (defer)

Env:

- `ZCLAUDIA_DATA_DIR` → `$DATA/codex-config`
- `ZCLAUDIA_SESSION_ID` injected for bridge routing
- Inherited env sanitized (equivalent to my-claudia `sanitizeInheritedProviderEnv`)

## Testing

### Plugin unit tests (no network / no real CLI in default CI)

| File | Coverage |
|---|---|
| `resolve-cli.test.ts` | cliPath priority; PATH lookup; not found |
| `config.test.ts` | TOML generation; bridge merge; mode args; trust upsert; text input prep |
| `permissions.test.ts` | plan→decline; bypass→accept; acceptEdits file auto-accept; default→callback |
| `map-events.test.ts` | deltas; tools; MCP name normalization; Enter/ExitPlanMode semantics |
| `app-server-client.test.ts` | Mock stdin/stdout JSON-RPC; approval flow; runTurn sequence; process exit |
| `runner.test.ts` | Start vs resume; session recovery; bridge write; abort |
| `adapter.test.ts` | createToolBridge plumbing; setSessionMode; abort cleanup; session id maps |

### Host tests

- `codex-plugin-lifecycle.test.ts` — register/unregister `com.zclaudia.codex`
- `provider-capabilities.test.ts` — `/api/providers/type/codex/capabilities` 200
- `provider-commands.test.ts` — `/api/providers/type/codex/commands` 200

### Build acceptance

```bash
pnpm --filter @zclaudia/plugin-codex test
pnpm --filter @zclaudia/plugin-codex build
pnpm --filter @zclaudia/server test -- provider-capabilities provider-commands
```

### Manual acceptance (post-merge)

1. Enable `com.zclaudia.codex` plugin
2. Agent Profile with runtime `codex` (local `codex` CLI logged in)
3. New chat → streaming reply → resume
4. Supervised mode: command approval → UI prompt → accept/decline
5. Switch `default` / `plan` / `acceptEdits` / `bypassPermissions`
6. AI triggers EnterPlanMode → mode sync → ExitPlanMode emits plan
7. Cancel interrupts turn
8. Confirm `$ZCLAUDIA_DATA_DIR/codex-config/.codex/config.toml` contains `claudia-plugins` bridge

### Out of scope for Phase 1 CI

Live smoke (real `codex` + network + account); image attachment E2E; form/todo interaction.

## Migration source map

| my-claudia | zclaudia plugin |
|---|---|
| `codex-app-server-adapter.ts` | `plugins/codex/src/adapter.ts` |
| `codex-app-server.ts` | `plugins/codex/src/runner.ts` |
| `codex/codex-app-server-client.ts` | `plugins/codex/src/app-server-client.ts` + `map-events.ts` |
| `codex/codex-config.ts` | `plugins/codex/src/config.ts` + `permissions.ts` |
| approval logic in client | `plugins/codex/src/permissions.ts` |
| `tool-effects.ts` patterns | `plugins/codex/src/tool-effects.ts` |
| `CODEX_*` in `manifests.ts` | `plugin.json` contributes.manifest / policy |
| `codex-adapter.ts` + `codex-sdk.ts` | **Not ported** (legacy SDK path) |
| `loadMcpServersFromDb` | Deferred (Phase 1 bridge only) |
| CLI jobs / review adapters | Deferred |

## Non-goals

- Staging under `server/.../external-agents/codex` before plugin extraction.
- Legacy `@openai/codex-sdk` adapter path.
- Restoring my-claudia `ProviderConfig` UI / provider tables.
- Wiring zclaudia LLM profile OAuth into agent runtime execution.
- Plan decision card UX, full multimodal attachments, background tasks, CLI review jobs.
- Falling back to the `zclaudia` (pi-agent) runtime when Codex is selected.
