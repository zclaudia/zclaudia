# Claude Agent Runtime Migration Design

## Goal

Migrate the Claude support from `my-claudia` into `zclaudia` as the first external CLI agent runtime. The migration should prove a reusable path for later Codex and Cursor support while keeping the first implementation to a minimal, working chat loop.

## Current Context

`my-claudia` models Claude, Codex, Cursor, OpenCode, and other runtimes as provider adapters under `server/src/infrastructure/providers`. Each adapter implements a common `ProviderAdapter` interface with `run`, `abort`, optional task/process helpers, a capability manifest, runtime policy, and optional event normalizer.

`zclaudia` already has a similar `ProviderAdapter` interface under `server/src/infra/providers/types.ts`, but its registry currently registers only `PiAgentProviderAdapter` as runtime type `zclaudia`. User-facing configuration has moved from provider configs to two profile layers:

- `LlmProfileConfig`: model endpoint and credential configuration for pi-agent.
- `AgentProfileConfig`: user-facing agent persona, model, tools, skills, and fallback settings.

The migration should use `AgentProfileConfig` as the visible abstraction and add a runtime selector to it.

## Decision

Add `runtimeType` to `AgentProfileConfig` and use it to choose the runtime adapter.

```ts
export const AGENT_RUNTIME_TYPES = ['zclaudia', 'claude', 'codex', 'cursor'] as const;
export type AgentRuntimeType = (typeof AGENT_RUNTIME_TYPES)[number];

export interface AgentProfileConfig {
  runtimeType?: AgentRuntimeType;
  llmProfileId: string;
  model: string;
  systemPrompt: string;
  // existing fields unchanged
}
```

Runtime selection becomes:

```ts
const runtimeType = agentProfile.runtimeType ?? 'zclaudia';
const adapter = providerRegistry.getOrDefault(runtimeType);
```

`llmProfileId` remains required for now. For `runtimeType === 'claude'`, the first phase keeps the LLM profile relation for schema stability and UI consistency, but the Claude runtime does not use the LLM profile to call an API. It uses the local Claude Agent SDK or CLI path, plus `agentProfile.model`, `systemPrompt`, mode, cwd, and session state.

## First Phase Scope

The first phase migrates Claude only and builds the smallest complete loop:

- Agents UI can create or edit an agent whose runtime is `claude`.
- Session creation and run bootstrap resolve the agent, read `runtimeType`, and choose the Claude adapter.
- Claude runtime can start a turn, stream assistant/tool/result/error events, and finish the run through the existing zclaudia lifecycle.
- Claude runtime can resume through `sessions.sdk_session_id` when the Claude SDK reports a provider session id.
- User cancellation calls the Claude adapter abort path.
- Capabilities expose at least `default` and `plan` modes for Claude so the chat mode selector works.

This phase intentionally does not migrate all Claude peripheral behavior from `my-claudia`.

## Migration List

### Required For Minimal Claude

1. Shared profile types
   - Add `AgentRuntimeType` and `runtimeType?: AgentRuntimeType`.
   - Default missing runtime values to `zclaudia`.

2. Database and repository
   - Add an `agent_profiles.runtime_type` migration.
   - Map create, update, and row reads in `AgentProfileRepository`.
   - Validate runtime type in agent profile routes.

3. Backend runtime selection
   - Use `agentProfile.runtimeType ?? 'zclaudia'` in run bootstrap.
   - Use runtime type for `providerRegistry.getPolicy`, `getOrDefault`, capability lookup, and tracing metadata.
   - Keep `providerConfig?.providerType` as LLM endpoint metadata for pi-agent only.

4. Claude adapter
   - Port `my-claudia/server/src/infrastructure/providers/claude-adapter.ts` into `zclaudia/server/src/infra/providers/claude-agent/adapter.ts` or equivalent.
   - Implement the current zclaudia `ProviderAdapter` interface.
   - Register the adapter in `server/src/infra/providers/registry.ts`.

5. Claude runner
   - Port the minimal `runClaude` path from `my-claudia/server/src/infrastructure/providers/claude-sdk.ts`.
   - Support cwd, sdk session id, cli path, env, model, native mode, system prompt, server port, zclaudia session id, abort controller, and session id callback.
   - Produce zclaudia `ProviderRuntimeEvent` values.

6. Event compatibility
   - Reuse current zclaudia runtime events where possible.
   - Add a small Claude event translator only for fields that differ.
   - Ensure init, assistant text, tool start, tool finish, result, error, and mode transition events are handled.

7. Capabilities and commands
   - Add Claude capabilities with `default` and `plan` modes.
   - Update `/api/providers/type/:type/capabilities` to support `claude`.
   - Update profile capabilities resolution so agent runtime metadata is not confused with LLM provider type.
   - Commands can initially return local zclaudia commands and custom commands. Full Claude built-in slash command pass-through can wait.

8. Frontend
   - Add runtime selection to the Agent Profile editor.
   - Default new and existing agents to `zclaudia`.
   - When runtime is `claude`, keep LLM profile fields present but mark them as not used by this runtime or hide them if the UI can do so cleanly.

9. Tests
   - Add repository and migration coverage for `runtime_type`.
   - Add run-bootstrap tests proving `claude` selects the Claude adapter and keeps existing `zclaudia` behavior unchanged.
   - Add mocked Claude adapter or runner tests for init, assistant streaming, result, error, resume id, and abort.
   - Add frontend ProfileEditor tests for runtime defaulting and editing.

### Deferred Until Claude Phase 2

- Full MCP bridge injection parity.
- Native interaction tool policy parity.
- Complete image temp-file attachment handling.
- Auth error hint rewriting.
- Background task tracking, stopTask, process-tree scans, and PID display.
- Process supervisor tracing parity.
- Full Claude slash command pass-through.
- AI review and CLI job support.

### Not In The Claude First Phase

- Codex app-server client, app-server cache, and thread cwd protection.
- Cursor `cursor-agent` process parser and `.cursor/mcp.json` injection.
- Restoring the old `ProviderConfig` UI or provider repository.
- Reintroducing my-claudia's legacy provider tables.

## Architecture

The key boundary is between user-visible agent configuration and runtime execution.

`AgentProfileConfig` owns:

- Runtime type.
- System prompt.
- Tool and skill selection.
- Mode-independent user-facing identity.

`LlmProfileConfig` owns:

- API endpoint, model catalog, credentials, and compatibility settings for pi-agent.

`ProviderAdapter` owns:

- Runtime-specific execution and event translation.
- Runtime-specific capability manifest and policy.
- Abort and future process/task controls.

For `zclaudia`, the adapter continues to build a pi-agent model from `LlmProfileConfig`. For `claude`, the adapter uses Claude's local runtime and treats `LlmProfileConfig` as irrelevant in the first phase.

## Data Flow

1. User creates or selects an Agent Profile with `runtimeType = 'claude'`.
2. Session stores `agent_profile_id` as it does today.
3. `initializeRunBootstrap` resolves the agent profile.
4. Bootstrap computes `runtimeType = agentProfile.runtimeType ?? 'zclaudia'`.
5. Bootstrap uses runtime type for policy decisions and cwd/session resume behavior.
6. `launchProviderRun` receives the selected adapter.
7. `buildRunContext` assembles the same system prompt and common run options.
8. Claude adapter starts `runClaude`.
9. Claude runtime events flow through the existing provider-event translator, run lifecycle, persistence, and UI projection.

## Error Handling

- Missing `runtimeType` means `zclaudia`.
- Unknown runtime type should fail validation on create/update and fall back only for old data reads if necessary.
- Claude startup failure should emit an init event if possible, followed by an error event that completes the run.
- Claude SDK auth failures should initially surface raw provider errors. Friendly auth hints are a phase 2 improvement.
- Abort should be best effort in phase 1: signal the AbortController and clean adapter maps. Process-tree killing can follow later.

## Testing Strategy

The first phase should be test-heavy at boundaries rather than relying on real Claude CLI integration.

- Repository tests verify create, update, default, and legacy null runtime mapping.
- Route tests verify invalid runtime type is rejected.
- Bootstrap tests use a fake provider registry or mocked registry adapter to prove runtime selection.
- Adapter tests mock the Claude SDK query stream and assert zclaudia events.
- Abort tests assert the registered abort controller is signaled.
- Frontend tests assert the runtime selector defaults to `zclaudia` and persists `claude`.

Manual verification after implementation:

1. Create a Claude runtime agent.
2. Start a new session with that agent.
3. Send a simple prompt.
4. Confirm assistant text streams and final result persists.
5. Send a second prompt and confirm provider session resume works.
6. Start a long request and cancel it.

## Rollout

Implement as small commits:

1. Add runtime type schema, repository, API, and frontend defaults.
2. Wire runtime type through bootstrap and registry selection with no Claude adapter behavior yet.
3. Add minimal Claude adapter and mocked tests.
4. Expose Claude capabilities and UI selector behavior.
5. Run focused backend and frontend tests, then manual smoke test.

Codex and Cursor should follow this same path later:

1. Add or enable runtime type option.
2. Port adapter and runner.
3. Add runtime-specific capability manifest and policy.
4. Add runtime-specific tests using the Claude migration as the template.
