# Agent Runtime Replication Checklist

This checklist captures the Claude runtime migration path so Codex and Cursor
can copy the same shape with smaller decisions.

## Completed Claude Path

- Shared profile contract: `AgentProfileConfig.runtimeType` accepts `zclaudia`, `claude`, `codex`, and `cursor`.
- Storage/API: `agent_profiles.runtime_type` is migrated, mapped, defaulted to `zclaudia`, and validated on create/update.
- Runtime selection: conversation runs choose the provider adapter from `agentProfile.runtimeType ?? 'zclaudia'`; LLM profile `providerType` remains endpoint metadata.
- Safety boundaries: missing runtime adapters fail instead of falling back to zclaudia, zclaudia-only compaction stays gated to zclaudia, and multimodal fallback no longer changes runtime adapter identity.
- External-agent staging: Claude lives under `server/src/infra/providers/external-agents/claude`, and shared extraction contracts live under `server/src/infra/providers/external-agents/agent-plugin`.
- Claude adapter: `server/src/infra/providers/external-agents/claude` contains the manifest, runner, adapter, SDK dependency, registry wiring, abort propagation, native mode mapping, SDK event transforms, config loading, and bridge MCP injection.
- Claude hardening: permission bridge, event mapping coverage, non-live/live smoke harnesses, slash command metadata/pass-through, capability truthfulness, and UI limitations hints are implemented.
- HTTP metadata: `/api/providers/type/claude/capabilities` and `/api/providers/type/claude/commands` work.
- UI: Agent Profile editor can select `ZClaudia` or `Claude`, saves `runtimeType`, and hides zclaudia-only advanced controls for Claude.

## Replication Steps Per Runtime

1. Add a provider directory:
   - `server/src/infra/providers/external-agents/<runtime>/manifest.ts`
   - `server/src/infra/providers/external-agents/<runtime>/runner.ts`
   - `server/src/infra/providers/external-agents/<runtime>/adapter.ts`
   - `server/src/infra/providers/__tests__/<runtime>-agent-adapter.test.ts`

   Keep provider-specific code self-contained so the directory can move to an
   external plugin package later. Shared plugin contracts should stay under
   `server/src/infra/providers/external-agents/agent-plugin` until that package
   boundary is extracted.

2. Register the adapter in `server/src/infra/providers/registry.ts`.

3. Keep adapter identity separate from LLM metadata:
   - Adapter `type` must equal the runtime type (`codex` or `cursor`).
   - Do not derive runtime identity from an LLM profile.
   - Add registry coverage that the runtime is registered by default.

4. Map the runtime SDK/CLI stream into `ProviderRuntimeEvent`:
   - `init` with provider session id and system info.
   - Assistant text deltas/results.
   - Tool start/result events.
   - Error events.
   - Task/progress events when available.
   - Unknown progress/system events should not become empty assistant text.

5. Wire cancellation and resume:
   - Reuse `RunOptions.abortController` when the SDK/CLI supports abort signals.
   - Expose `providerSessionId` and `providerCwd` through `getRunState` when needed by `cancelRun`.
   - Pass the persisted provider session id into the SDK/CLI resume option.

6. Use native permission modes:
   - Declare `permissionModeMap` in the manifest.
   - Confirm `buildRunContext` passes provider-native `runOptions.mode`.
   - Only mark approval/permission bridge capabilities as supported after the adapter actually calls the runtime's permission callback.

7. Load runtime-native configuration locally:
   - Add a provider-local config loader when the runtime has existing user MCP, plugin, auth, or settings files.
   - Fail closed on missing or invalid user config.
   - Pass loaded config through the same runner path used by chat, resume, and smoke checks.

8. Consume the shared agent-plugin tool bridge:
   - Reuse `createAgentPluginToolBridgeMcpEntry` when the runtime can consume MCP servers.
   - Merge bridge MCP config without overwriting user-defined server names.
   - Only inject the bridge when bridge tools are registered and a server port is available.

9. Expose metadata:
   - Add `/api/providers/type/<runtime>/capabilities`.
   - Allow `/api/providers/type/<runtime>/commands`.
   - Keep LLM-profile capability routes independent unless they are explicitly changed to resolve agent runtime.
   - Back provider command metadata with the same sources the runtime can execute.

10. Add UI selection:

- Add the runtime to the Agent Profile editor once the adapter exists.
- Save `runtimeType` in create/update payloads.
- Hide or disable zclaudia-only controls until the runtime supports them.

11. Verify:

- Runtime adapter tests.
- Provider-local config tests.
- Agent-plugin bridge tests.
- Registry tests.
- Agent profile repository/routes tests.
- Runtime handler/provider-launch/context tests.
- HTTP provider metadata tests.
- Provider slash command tests.
- ProfileEditor tests.
- `@zclaudia/shared`, `@zclaudia/server`, and `@zclaudia/desktop` builds.

12. Add a runtime-local permission bridge before declaring `interaction.approval` supported.

13. Add deterministic and opt-in live smoke coverage:

- The default smoke command should avoid network/auth/token requirements.
- The live smoke should verify config loading, resume, cancel, and any bridge path the runtime exposes.
- Keep live smoke out of normal CI unless credentials and cost boundaries are explicit.

## Runtime-Specific Notes

- Codex likely needs OAuth/session-auth failure hints and provider-specific error normalization.
- Cursor should start with the same minimal chat/resume/cancel loop before adding command/task parity.
- Background task/process tracking should stay out of the first pass unless the target runtime exposes stable process handles.
- Approval bridging is a separate feature; manifest claims should stay conservative until the callback path is implemented and tested.
- AI review, multimodal attachments/fallback, and background task controls should remain explicitly unsupported until Codex or Cursor has a real provider-specific implementation.
