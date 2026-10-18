# Claude Runtime Hardening Design

## Goal

Make the migrated Claude runtime practical enough for real daily use before
copying the runtime pattern to Codex and Cursor.

## Scope

This phase hardens the existing `claude` runtime. It does not add Codex or
Cursor adapters. It keeps the first-class runtime boundary introduced in the
previous phase:

- `AgentProfileConfig.runtimeType` selects the runtime adapter.
- LLM profile `providerType` remains endpoint metadata for zclaudia/pi-agent.
- Claude runtime behavior lives under `server/src/infra/providers/external-agents/claude`.

## Workstreams

### 1. Live Smoke Harness

Add an opt-in smoke script that exercises the actual Claude Agent SDK without
running in normal CI. The script should validate:

- Chat: a Claude runtime turn emits `init` and a terminal `result` or visible assistant content.
- Resume: a second turn can resume the reported SDK session id.
- Cancel: an abort signal stops an in-flight SDK stream.

The smoke harness should be safe by default. It must require explicit CLI flags
or environment variables and should print clear skip/failure messages when the
Claude SDK or credentials are unavailable.

### 2. Permission Bridge

Claude currently declares approval as unsupported because the adapter does not
wire the SDK permission callback. This phase should add a small bridge from the
Claude SDK `canUseTool` callback to zclaudia's `PermissionCallback`.

The bridge should:

- Preserve the SDK tool name, input, tool use id, and display text in the permission request.
- Convert zclaudia allow/deny decisions into SDK permission results.
- Propagate aborts from the SDK permission request signal.
- Update the Claude manifest only after the bridge is tested.

### 3. Event Mapping Hardening

The current event mapper covers the minimal path. This phase should expand it
with shape-specific tests for:

- `assistant` text and tool use blocks.
- `user` tool result blocks.
- successful and failed `result` messages.
- task lifecycle and tool progress messages.
- unknown system/progress messages producing no empty assistant content.

This work should remain adapter-local. The shared runtime consumes normalized
`ProviderRuntimeEvent`; it should not learn Claude SDK shapes.

### 4. Runtime UI Affordance

The Agent Profile editor already saves `runtimeType`. This phase should add a
small capability hint so users understand the current Claude runtime limitations:

- Claude uses the Claude Agent SDK / Claude Code runtime.
- zclaudia-only features such as multimodal fallback and AI review are not
  currently available for Claude runtime.

No broad settings redesign is included.

## Error Handling

- Smoke script failures should exit non-zero only after the user explicitly
  requested a live run.
- Permission bridge errors should return deny by default unless the SDK request
  has already been aborted.
- Unknown Claude SDK messages should be ignored or mapped to non-content
  progress events; they must not create empty assistant content.

## Testing

Required checks:

- Claude adapter unit tests.
- Claude permission bridge unit tests.
- Claude event mapping unit tests.
- Runtime context/provider launch tests for native mode and abort propagation.
- ProfileEditor focused test.
- `@zclaudia/shared`, `@zclaudia/server`, and `@zclaudia/desktop` builds.

Optional manual check:

- Run the opt-in Claude smoke script against a real Claude Agent SDK setup.

## Out Of Scope

- Codex runtime adapter.
- Cursor runtime adapter.
- MCP bridge parity for Claude.
- Background task/process-tree tracking.
- Full slash command parity.
- Making Claude runtime use zclaudia multimodal fallback or AI review.
