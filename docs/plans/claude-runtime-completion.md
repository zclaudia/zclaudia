# Claude Runtime Completion Plan

## Goal

Finish the Claude runtime migration before copying the runtime abstraction to
Codex or Cursor.

Claude is usable as a first-class runtime: adapter selection, registry wiring,
permission approval, event mapping, smoke checks, custom command metadata, MCP
bridge wiring, and the Profile Editor runtime selector are in place. This
document records the completed migration path and the explicit advanced
capabilities that remain out of scope for Claude.

## Current Baseline

Completed in `zclaudia`:

- `AgentProfileConfig.runtimeType` selects `zclaudia` or `claude`.
- `server/src/infra/providers/external-agents/claude` owns Claude SDK integration.
- Claude chat, resume, cancel, SDK event mapping, and approval bridging are
  covered by focused tests.
- `/api/providers/type/claude/capabilities` and
  `/api/providers/type/claude/commands` expose runtime metadata.
- `server/scripts/smoke-claude-runtime.ts` provides an opt-in live SDK check.
- Profile Editor can select Claude and explains current limitations.
- Claude external-agent code is staged for later extraction under
  `server/src/infra/providers/external-agents`.
- Claude SDK receives user MCP servers and enabled local plugins.
- Claude SDK receives the zclaudia MCP bridge as `claudia-plugins` when bridge
  tools and a server port are available.

Completion status:

- Claude runtime migration is complete for the supported capability set.
- AI review, multimodal attachments/fallback, and background task controls are
  explicitly unsupported for Claude until each has a dedicated implementation.
- Live Claude Agent SDK smoke remains opt-in because it requires Claude Code
  authentication and may spend tokens.

## Source Mapping From `my-claudia`

Relevant old-project sources:

- Claude config loading:
  - `my-claudia/server/src/utils/claude-config.ts`
  - Loads `~/.claude/mcp.json`.
  - Loads enabled plugins from `~/.claude/settings.json` and
    `~/.claude/plugins/installed_plugins.json`.
- Slash command discovery:
  - `my-claudia/server/src/utils/command-scanner.ts`
  - Scans user, project, and plugin command markdown files.
- MCP bridge:
  - `my-claudia/server/src/utils/mcp-bridge-launch.ts`
  - `my-claudia/server/src/application/plugins/mcp-bridge.ts`
- Review and workflow:
  - `my-claudia/server/src/infrastructure/providers/cli-jobs/claude-review.ts`
  - `my-claudia/server/src/application/conversation/agent/*`
  - `my-claudia/server/src/domains/workflows/*`

Existing new-project foundations:

- `zclaudia/server/src/utils/command-scanner.ts` already has user, project, and
  plugin command discovery.
- `zclaudia/server/src/utils/mcp-bridge-launch.ts` and
  `zclaudia/server/src/application/plugins/mcp-bridge.ts` already exist.
- `zclaudia/server/src/application/conversation/agent/*` and
  `zclaudia/server/src/domains/workflows/*` already carry permission and review
  infrastructure.
- The missing work is mostly Claude adapter wiring and capability truthfulness.

## Completion Phases

### Phase A: Claude Config And SDK Loading

Phase A status: implemented. Claude SDK receives user MCP servers and enabled
local plugins from Claude Code configuration.

Load Claude Code user configuration into the Claude Agent SDK:

- Create an adapter-local Claude config loader under
  `server/src/infra/providers/external-agents/claude`.
- Read `~/.claude/mcp.json` into SDK-compatible `mcpServers`.
- Read enabled Claude plugins from `~/.claude/settings.json` and
  `~/.claude/plugins/installed_plugins.json` into SDK `plugins`.
- Pass `mcpServers` and `plugins` through `runClaudeAgent`.
- Add tests that verify absent config is harmless, valid config is passed, and
  invalid JSON fails closed to empty config.

Done when:

- Claude SDK query options include MCP servers and plugins when config exists.
- Existing chat/resume/cancel tests still pass.
- Server build passes.

### Phase B: ZClaudia MCP Bridge For Claude

Phase B status: implemented. zclaudia exposes a provider-agnostic agent plugin
tool bridge context, and Claude translates that bridge into a `claudia-plugins`
MCP server when bridge tools and a server port are available. User-defined
`claudia-plugins` MCP servers are preserved.

Expose zclaudia bridge tools to Claude SDK:

- Build the `claudia-plugins` MCP server entry with
  `buildMcpBridgeEntry(serverPort, sessionId)`.
- Merge it with user Claude MCP config without overwriting user-defined servers.
- Decide and test the conflict policy for an existing `claudia-plugins` user
  server. The safer default is to keep the user server and log a warning.
- Pass `serverPort` and `claudiaSessionId` from `RunOptions` through the Claude
  adapter into the runner.
- Update the Claude manifest when bridge-backed interactions are truly usable.

Done when:

- Claude SDK receives a bridge MCP server when bridge tools are registered and
  the run has a server port.
- MCP bridge tests cover session id injection and no-tools behavior.
- A live smoke can list or call at least one bridge tool.

### Phase C: Slash Commands End-To-End

Phase C status: implemented. Claude command metadata is backed by the shared
custom command scanner, including user, project, and plugin command sources.
The desktop command handler forwards provider slash commands and unknown slash
inputs to the active runtime, while plugin commands still use the command API.

Make slash command parity explicit:

- Keep provider command metadata backed by `scanCustomCommands`.
- Add tests that `/api/providers/type/claude/commands` includes user, project,
  and plugin commands.
- Add a smoke or integration check showing Claude SDK plugins are loaded in the
  same run path used by the adapter.
- Ensure unknown slash commands continue to pass through to Claude rather than
  being swallowed as local-only commands.

Done when:

- Command metadata and SDK plugin loading agree.
- UI command autocomplete for Claude is backed by the same sources Claude SDK
  will see.

### Phase D: Review, Multimodal, And Background Capability Decisions

Phase D status: implemented for capability truthfulness. Claude keeps AI review,
multimodal attachments/fallback, and background task controls unsupported until
each has a dedicated implementation. The Profile Editor hides zclaudia-only
multimodal fallback controls for Claude profiles and explains the remaining
advanced limitations.

Resolve the remaining zclaudia-only limitations:

- AI review:
  - Either bridge Claude runtime into the existing local review flow or keep
    review explicitly zclaudia-only with a manifest/UI reason.
- Multimodal fallback:
  - Decide whether Claude SDK image/file input is supported directly.
  - If supported, add adapter-local input handling; if not, keep the manifest
    unsupported and remove misleading UI affordances for Claude.
- Background tasks:
  - Decide whether Claude SDK exposes stable process handles or task ids that
    can support stop/status.
  - Keep `session.background_task` unsupported unless stop semantics can be
    implemented safely.

Done when:

- Claude manifest capabilities match the implementation.
- Profile Editor hint is either removed or updated to only list real remaining
  gaps.
- Replication checklist names which features must be copied to Codex/Cursor.

### Phase E: Completion Gate

Phase E status: implemented. The deterministic test/build/smoke gate passes,
the live Claude Agent SDK smoke remains opt-in, and Codex/Cursor replication
notes are updated with the finalized Claude path.

Finish Claude migration:

- Extend `smoke:claude-runtime` with optional checks for user MCP, bridge MCP,
  plugins, slash commands, and cancel/resume.
- Run the server and desktop focused test matrix.
- Run shared, server, and desktop builds.
- Update `docs/plans/agent-runtime-codex-cursor-replication.md`.
- Mark Claude runtime migration complete in this document.

## Execution Order

1. Phase A: Claude Config And SDK Loading.
2. Phase B: ZClaudia MCP Bridge For Claude.
3. Phase C: Slash Commands End-To-End.
4. Phase D: Review, Multimodal, And Background Capability Decisions.
5. Phase E: Completion Gate.

Claude runtime migration is complete for supported capabilities. Codex/Cursor
implementation can copy this external-agent path, keeping deferred advanced
capabilities unsupported until each runtime implements them directly.
