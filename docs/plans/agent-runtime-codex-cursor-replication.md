# Agent Runtime Replication Checklist

This checklist captures the Claude runtime migration path so Codex and Cursor
can copy the same shape with smaller decisions.

## Completed Claude Path

- Shared profile contract: `AgentProfileConfig.runtimeType` accepts `zclaudia`, `claude`, `codex`, and `cursor`.
- Storage/API: `agent_profiles.runtime_type` is migrated, mapped, defaulted to `zclaudia`, and validated on create/update.
- Runtime selection: conversation runs choose the provider adapter from `agentProfile.runtimeType ?? 'zclaudia'`; LLM profile `providerType` remains endpoint metadata.
- Safety boundaries: missing runtime adapters fail instead of falling back to zclaudia, zclaudia-only compaction stays gated to zclaudia, and multimodal fallback no longer changes runtime adapter identity.
- Claude adapter: `server/src/infra/providers/claude-agent` contains the manifest, runner, adapter, SDK dependency, registry wiring, abort propagation, native mode mapping, and minimal SDK event transforms.
- Claude hardening: permission bridge, event mapping coverage, live smoke harness, and UI limitations hint are implemented.
- HTTP metadata: `/api/providers/type/claude/capabilities` and `/api/providers/type/claude/commands` work.
- UI: Agent Profile editor can select `ZClaudia` or `Claude` and saves `runtimeType`.

## Replication Steps Per Runtime

1. Add a provider directory:
   - `server/src/infra/providers/<runtime>-agent/manifest.ts`
   - `server/src/infra/providers/<runtime>-agent/runner.ts`
   - `server/src/infra/providers/<runtime>-agent/adapter.ts`
   - `server/src/infra/providers/__tests__/<runtime>-agent-adapter.test.ts`

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

7. Expose metadata:
   - Add `/api/providers/type/<runtime>/capabilities`.
   - Allow `/api/providers/type/<runtime>/commands`.
   - Keep LLM-profile capability routes independent unless they are explicitly changed to resolve agent runtime.

8. Add UI selection:
   - Add the runtime to the Agent Profile editor once the adapter exists.
   - Save `runtimeType` in create/update payloads.

9. Verify:
   - Runtime adapter tests.
   - Registry tests.
   - Agent profile repository/routes tests.
   - Runtime handler/provider-launch/context tests.
   - HTTP provider metadata tests.
   - ProfileEditor tests.
   - `@zclaudia/shared`, `@zclaudia/server`, and `@zclaudia/desktop` builds.

10. Add a runtime-local permission bridge before declaring `interaction.approval` supported.

11. Add an opt-in live smoke harness for the runtime before starting UI polish.

## Runtime-Specific Notes

- Codex likely needs OAuth/session-auth failure hints and provider-specific error normalization.
- Cursor should start with the same minimal chat/resume/cancel loop before adding command/task parity.
- Background task/process tracking should stay out of the first pass unless the target runtime exposes stable process handles.
- Approval bridging is a separate feature; manifest claims should stay conservative until the callback path is implemented and tested.
