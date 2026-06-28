# Multimodal Fallback Model Design

## Goal

Some agent profiles use fast or inexpensive text-only models. When the current user input contains image attachments, the runtime should optionally switch only that run to a configured multimodal fallback model. The default agent model and stored agent configuration must remain unchanged for later text-only runs.

## Scope

This design covers agent-profile-level configuration, LLM-profile model capability metadata, runtime model selection, API validation, desktop settings UI, and tests.

The trigger is intentionally narrow: fallback selection only considers images attached to the current user input. Historical messages that contain images do not trigger fallback for a later text-only turn.

## Data Model

`AgentProfileConfig` gains an optional cross-profile fallback reference:

```ts
interface AgentProfileConfig {
  multimodalFallback?: {
    llmProfileId: string;
    model: string;
  };
}
```

The reference is stored with agent profile configuration and can point to any LLM profile, including the agent's primary profile.

`LlmProfileModelEntry` gains input capability metadata:

```ts
interface LlmProfileModelEntry {
  inputModalities?: Array<'text' | 'image'>;
}
```

If `inputModalities` is absent, current behavior remains:

- Registry-backed models use the pi-ai registry model `input` field.
- Unknown OpenAI-compatible literal models default to `['text']`.
- Explicit `inputModalities` overrides the built model input list so custom proxy models can be marked as vision-capable.

## Runtime Flow

Before a provider run starts, the server already parses the current user input and resolves image attachments. The multimodal fallback selector runs after that parsing and before `buildRunContext` creates `RunOptions`.

Selection rules:

1. If the current input has no resolved image attachments, use the existing agent profile and LLM profile unchanged.
2. If the current input has images and the primary agent model supports `image`, use the primary model unchanged.
3. If the current input has images, the primary model does not support `image`, and no fallback is configured, keep the existing no-vision degradation path: image refs become text notices.
4. If a fallback is configured, load the referenced LLM profile and model entry.
5. If the fallback model supports `image`, create run-local effective copies:
   - `effectiveAgentProfile = { ...agentProfile, model: fallback.model }`
   - `effectiveLlmProfile = fallback LLM profile`
6. If the fallback model does not support `image`, fail before the provider call with a configuration error that names the fallback profile and model.

Only run-local objects are changed. No database update is made during fallback.

## Behavior Surface

The provider init event and Model badge should show the effective fallback model when fallback is active.

Context-window resolution, preflight compaction, post-turn compaction, image resolution in history, Read-tool image behavior, and context snapshots should all use the effective fallback profile and model for that run.

The session's SDK/provider session id behavior remains unchanged. A fallback run may call a different upstream LLM profile than the primary model. The fallback affects only the LLM request configuration; it does not fork or permanently migrate the conversation.

## API Validation

Agent profile create/update accepts `multimodalFallback` as either `null`/absent or an object with non-empty `llmProfileId` and `model` strings.

Server validation checks:

- The referenced LLM profile exists.
- The fallback model id is non-empty.
- If the referenced LLM profile has a non-empty `models[]`, the fallback model must be present in that list.
- If the matching model entry declares `inputModalities`, that list must contain `image`; otherwise the update is rejected with a validation error.
- If the referenced profile has no model list, the update may be saved, but runtime still verifies support with `buildModel` and fails cleanly if the resulting model lacks image support.

LLM profile create/update validates `models[].inputModalities`:

- Must be an array if present.
- Allowed values are `text` and `image`.
- Stored values are normalized, deduplicated, and default to including `text` when the row is marked image-capable from the UI.

## Desktop UI

Agent settings gains a "Multimodal fallback" control:

- Disabled/empty means no fallback.
- The user first selects an LLM profile.
- The model selector then shows that profile's declared models.
- Models marked with `image` are selectable normally.
- Models not marked with `image` are disabled with helper text.
- If the selected LLM profile has no declared models, the UI allows a manual model id but explains that image support will be verified only at run time.
- A clear action removes the fallback.

LLM profile model rows gain an Images/Vision toggle. When enabled, the row saves `inputModalities: ['text', 'image']`; when disabled, it saves no override unless other modalities need to be preserved later.

The UI should not silently infer vision support for unknown custom models. Users can opt in with the toggle.

## Error Handling

Runtime configuration errors are surfaced before the provider request. The user should see a message equivalent to:

`Multimodal fallback model "<model>" on LLM profile "<profile>" does not support image input. Enable Images on that model or choose another fallback.`

If no fallback is configured, the current text-notice degradation remains unchanged to avoid breaking existing behavior.

If the fallback LLM profile is deleted after being configured, agent readiness should report a configuration issue, and runtime should fail cleanly when an image input attempts to use it.

## Tests

Server tests:

- LLM profile routes accept and persist `models[].inputModalities`.
- LLM profile routes reject invalid modality values.
- Agent profile routes accept a valid cross-profile `multimodalFallback`.
- Agent profile routes reject missing or non-vision fallback models when the referenced profile declares models.
- Runtime selection leaves text-only input on the primary model.
- Runtime selection leaves image input on the primary model when it supports image.
- Runtime selection switches image input to the configured fallback profile/model when the primary model is text-only.
- Runtime selection preserves existing no-fallback text-notice degradation.
- Runtime selection fails early when the configured fallback is not vision-capable.

Desktop tests:

- LLM profile editor saves the Images/Vision toggle as `inputModalities: ['text', 'image']`.
- Agent settings saves and clears a cross-profile multimodal fallback reference.
- Agent settings disables non-vision model options when a profile declares model capabilities.

## Non-Goals

- Fallback is not triggered by historical images.
- Fallback does not change the agent profile's primary model.
- Fallback does not automatically guess unknown model capabilities from model names.
- Fallback does not add per-message or per-session permanent model migration.
