# Runtime Event Model

This document describes the server runtime event model used by conversation runs.
The goal is to keep `run-events.ts` as orchestration code instead of a place that
must change for every new runtime behavior.

## Layers

Runtime events are intentionally layered. Each layer has a different owner and a
different compatibility promise.

1. Provider runtime events
   - Type: `ProviderRuntimeEvent`
   - Defined in `server/src/infra/providers/message-types.ts`
   - Produced by provider adapters such as the pi-agent adapter.
   - Represents provider/runtime input before it becomes canonical application
     state.

2. Run domain events
   - Type: `RunDomainEvent`
   - Defined in `server/src/application/conversation/runtime/run-domain-events.ts`
   - Canonical facts about a run: `tool.started`, `run.completed`,
     `mode.changed`, `compaction.completed`, and similar.
   - These are the internal contract between runtime translation, state updates,
     wire projection, plugin projection, and listener hooks.

3. Reducer state updates
   - Module: `run-reducer.ts`
   - Applies domain events to `ActiveRun`.
   - This should stay focused on in-memory state changes only.

4. Wire events
   - Module: `wire-projector.ts`
   - Projects domain events to `ServerMessage` values consumed by clients.
   - This preserves the existing WebSocket protocol.

5. Listener and plugin events
   - Listener registry: `run-domain-event-listeners.ts`
   - Plugin adapter: `plugin-domain-event-listener.ts`
   - Plugins are now downstream listeners of public domain events instead of
     being emitted directly from the run orchestration path.

The normal provider path is:

```text
ProviderRuntimeEvent
  -> provider-event-translator
  -> RunDomainEvent
  -> run-reducer
  -> wire-projector
  -> run-domain-event-listeners
  -> plugin-domain-event-listener
```

Some runtime-originated events, such as `run.started`, `run.completed`,
`run.failed`, and compaction outcomes, are created directly as `RunDomainEvent`
values and then use the same wire/listener projection path.

## Public Listener API

`PUBLIC_RUN_DOMAIN_EVENT_TYPES` is the stable external listener surface. It is
defined in `run-domain-events.ts` and is enforced at runtime by
`RunDomainEventListenerRegistry`.

Current public events:

```text
run.started
run.completed
run.failed
tool.started
tool.finished
mode.changed
backgroundTask.started
backgroundTask.finished
backgroundFollowup.started
backgroundFollowup.finished
compaction.completed
compaction.failed
interaction.todoUpdated
interaction.promptRequested
interaction.resolved
permission.requested
permission.resolved
permission.autoResolved
run.phaseChanged
```

The registry API is intentionally small:

```ts
const unsubscribe = runDomainEventListeners.on('tool.started', event => {
  // event is a RunDomainEvent<'tool.started'>
});

unsubscribe();
```

Listener behavior:

- Only public event types can be registered. Registering internal event types
  throws at runtime.
- Internal events such as `assistant.textDelta` are not emitted to external
  listeners.
- Listener errors are isolated and reported through the registry error handler;
  they do not fail the run.
- Async listener rejections are also isolated.

## Internal Events

`RUN_DOMAIN_EVENT_TYPES` includes both public and internal events. Internal events
are allowed to change more freely because they are runtime implementation
details.

Examples of internal-only events:

- `assistant.textDelta`
- `assistant.thinkingDelta`
- `run.providerTurnFinished`
- `compaction.requested`
- `compaction.skipped`

Do not build plugins or public hooks directly on internal event names unless they
are first promoted into `PUBLIC_RUN_DOMAIN_EVENT_TYPES`.

## Where To Add Behavior

Use this guide when adding runtime behavior:

- New provider output shape: update `ProviderRuntimeEvent` and
  `provider-event-translator.ts`.
- New canonical runtime fact: add a `RunDomainEvent` type and payload in
  `run-domain-events.ts`.
- New `ActiveRun` state change: update `run-reducer.ts`.
- New client protocol message from an existing fact: update `wire-projector.ts`.
- New plugin behavior: update `plugin-projector.ts` or register a listener in a
  dedicated adapter module.
- Multi-step side effects around a lifecycle phase: add or extend a coordinator
  module, then emit domain events from that coordinator.
- Stable external hook: add the event to `PUBLIC_RUN_DOMAIN_EVENT_TYPES` and add
  tests for registry emission and error isolation.

Avoid adding provider-specific branches or plugin emits directly to
`run-events.ts`.

## Current Coordinators

The runtime uses coordinators for behavior that is more than pure translation or
projection:

- `run-terminal-coordinator.ts`: run completion/failure, notifications, cleanup,
  and post-turn compaction.
- `background-task-coordinator.ts`: background task detection and SDK task
  notifications.
- `interaction-coordinator.ts`: TodoWrite normalization and finalization.
- `provider-session-coordinator.ts`: provider `init` handling and session
  metadata.
- `mode-transition-coordinator.ts`: AI-initiated mode transitions and provider
  session mode sync.
- `run-provider-launch.ts`: run start, preflight compaction, profile negotiation,
  and provider stream creation.

## Compatibility Notes

- `ProviderRuntimeEvent` replaced the old `ClaudeMessage` type name.
- The WebSocket protocol is still preserved by `wire-projector.ts`.
- Legacy plugin events are preserved by `plugin-projector.ts` and emitted only by
  `plugin-domain-event-listener.ts`.
- Runtime compaction paths use `compactionDomainEventFor`, then project to wire
  messages through `wire-projector.ts`.

## Remaining Migration Targets

The main event model is in place. Remaining work is mostly about deciding
whether lower-level internal events should stay private or be promoted later:

- Compaction request/skip signals:
  `compaction.requested` / `compaction.skipped`
- Fine-grained assistant/thinking stream events:
  `assistant.textDelta` / `assistant.thinkingDelta`
- Tool activity/effect details:
  `tool.activity` / `tool.effectDetected`
