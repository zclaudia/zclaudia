import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { PCPProviderManifest } from '@zclaudia/shared/core/pcp';
import type { ProviderPolicy } from '@zclaudia/shared/core/provider-policy';
import { ALL_TOOL_NAMES, normalizeToolName, type ToolName } from '@zclaudia/shared/core/tools';
import type { ClaudeMessage, PermissionCallback, ProviderAdapter, RunOptions } from '../types.js';
import {
  AsyncQueue,
  buildModel,
  buildPiRunPrompt,
  buildPiRunToolBundle,
  capturePiRunContextSnapshot,
  extractErrorStop,
  extractLastCallUsage,
  rebuildHistory,
  resolvePlanModeTools,
  runPiAgentStream,
  translateEvent,
  type BuiltModel,
  type TranslateContext,
} from '../pi-runtime/index.js';
import { resolveEnvModel } from '../pi-runtime/env-model.js';
import { isSandboxAvailable } from '../pi-runtime/sandbox.js';
import { SANDBOX_NETWORK_ESCALATION_TOOL } from '../pi-runtime/sandbox-denial.js';
import { resolveContextWindow } from '../../../application/conversation/compaction/context-windows.js';
import { resolveImageAttachments } from '../../../application/conversation/runtime/resolve-image-attachments.js';
import { getFileStore } from '../../storage/fileStore.js';

const manifest: PCPProviderManifest = {
  id: 'zclaudia',
  name: 'ZClaudia Agent',
  version: '0.1.0',
  apiVersion: 'pcp/v1',
  providerType: 'zclaudia',
  runtime: 'sdk',
  permissionModeMap: {
    supervised: 'default',
    auto_edit: 'default',
    autonomous: 'default',
    plan_only: 'plan',
  },
  capabilities: [
    { id: 'chat.stream', supported: true, mode: 'emulated', reliability: 'strict' },
    { id: 'tool.call', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'tool.inject', supported: false, degradation: 'fallback_to_text' },
    { id: 'interaction.form', supported: false, degradation: 'fallback_to_text' },
    { id: 'interaction.approval', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'interaction.todo', supported: false, degradation: 'fallback_to_text' },
    { id: 'input.image', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'input.text_file', supported: false, degradation: 'fallback_to_notice' },
    { id: 'input.binary_file', supported: false, degradation: 'fallback_to_notice' },
    { id: 'permission.mode', supported: true, mode: 'emulated', reliability: 'display_only' },
    { id: 'session.abort', supported: true, mode: 'emulated', reliability: 'strict' },
    { id: 'session.steer', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'session.background_task', supported: false, degradation: 'fallback_to_text' },
  ],
};

const policy: ProviderPolicy = {
  modeSwitchSessionPolicy: 'preserve',
  sessionCwdPolicy: 'requested',
  emptyResultFallback: 'ZClaudia agent completed without additional output.',
  escalateAlwaysTools: [SANDBOX_NETWORK_ESCALATION_TOOL],
};

export { resolvePlanModeTools, translateEvent };

export const __testables = { AsyncQueue, buildModel, translateEvent, extractErrorStop, extractLastCallUsage };

export class PiAgentProviderAdapter implements ProviderAdapter {
  readonly type = 'zclaudia';
  readonly manifest = manifest;
  readonly policy = policy;

  async *run(
    input: string,
    options: RunOptions,
    onPermission?: PermissionCallback,
  ): AsyncGenerator<ClaudeMessage, void, void> {
    const sessionId = options.sessionId || `zclaudia-${Date.now()}`;
    // ctx.model surfaces in init.systemInfo (the UI's "Model:" badge) and in the
    // captured context snapshot. Resolution mirrors buildModel: the agent
    // profile's model (the canonical surface the editor writes), else the shared
    // env-knob fallback (PI_MODEL -> OPENAI_MODEL -> default). This is the value
    // shown if buildModel throws before normalization; on a successful build we
    // refresh ctx.model from modelInfo.model.id to match what was actually sent.
    const ctx: TranslateContext = {
      sessionId,
      model: options.agentProfile?.model || resolveEnvModel(),
      cwd: options.cwd,
      permissionMode: options.mode === 'plan' ? 'plan' : 'default',
    };

    // 1. Build the model first (config errors stop here, before any init event).
    //    Init carries contextWindow which requires a built model. If the LLM
    //    profile declares a per-model entry for this model id, pass it so
    //    user-declared contextWindow / maxTokens / displayName override the
    //    pi-ai registry / openai-compat defaults (T3 of llm-profile-models).
    let modelInfo: BuiltModel;
    let supportsVision = false;
    try {
      const modelId = options.agentProfile?.model;
      const modelEntry = modelId
        ? options.llmProfileConfig?.models?.find((m) => m.modelId === modelId)
        : undefined;
      modelInfo = buildModel(options.llmProfileConfig, modelId, modelEntry);
      // Refresh ctx.model to the canonical id post-resolution so the UI badge
      // and context snapshot reflect exactly what was put on the wire.
      if (typeof modelInfo.model.id === 'string' && modelInfo.model.id) {
        ctx.model = modelInfo.model.id;
      }
      const modelInput = (modelInfo.model as { input?: string[] }).input;
      supportsVision = Array.isArray(modelInput) && modelInput.includes('image');
    } catch (err) {
      // Emit a minimal init so the client has a sessionId, then the error.
      yield {
        type: 'init',
        sessionId,
        systemInfo: {
          model: ctx.model,
          cwd: options.cwd,
          permissionMode: ctx.permissionMode || 'default',
          tools: [],
          agents: ['zclaudia'],
        },
      };
      yield {
        type: 'error',
        error: `model configuration failed: ${err instanceof Error ? err.message : String(err)}. Check PI_PROVIDER / PI_MODEL / provider API key env vars or LLM Profile config.`,
        isComplete: true,
      };
      return;
    }

    // 2. Resolve effective context window via the single shared resolver. The
    //    model literal `modelInfo.model.contextWindow` already has any per-model
    //    override applied (so other pi-ai consumers read the right value), but
    //    `systemInfo` goes through `resolveContextWindow` so the source layer
    //    is reported uniformly and the UI can warn on the fallback path.
    const resolvedWindow = resolveContextWindow(
      options.agentProfile ?? null,
      undefined,
      options.llmProfileConfig,
    );
    const effectiveContextWindow = resolvedWindow.value;
    const contextWindowSource = resolvedWindow.source;
    const contextWindowMatchedProvider = resolvedWindow.matchedProvider;

    // 3. Resolve effective tool set. Plan mode collapses the agent's
    //    enabledTools to only the read-only subset (read/grep/find/ls).
    //    Non-plan modes pass through whatever the agent profile requested.
    const isPlanMode = options.mode === 'plan';
    const requestedTools: ToolName[] = (options.enabledTools ?? [...ALL_TOOL_NAMES])
      .flatMap((tool) => {
        const normalized = normalizeToolName(tool);
        return normalized ? [normalized] : [];
      });
    const effectiveTools: ToolName[] = resolvePlanModeTools(requestedTools, isPlanMode, isSandboxAvailable());
    const toolBundle = buildPiRunToolBundle({
      options,
      effectiveTools,
      supportsVision,
      isPlanMode,
      permissionCallback: onPermission,
    });

    // 4. Yield init now (after we know contextWindow + effective tools).
    yield {
      type: 'init',
      sessionId,
      systemInfo: {
        model: ctx.model,
        contextWindow: effectiveContextWindow,
        contextWindowSource,
        contextWindowMatchedProvider,
        cwd: options.cwd,
        permissionMode: ctx.permissionMode || 'default',
        tools: toolBundle.visibleToolNames,
        agents: ['zclaudia'],
      },
    };

    // 5. Load history (non-fatal failure)
    let history: AgentMessage[] = [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      history = rebuildHistory(options.db, options.claudiaSessionId, {
        resolveImages: (atts) => {
          const resolved = resolveImageAttachments(atts, getFileStore());
          if (supportsVision) return resolved;
          return {
            images: [],
            notices: atts.map((a) => `[Image attached: ${a.name} — current model does not support vision]`),
          };
        },
      }).messages as any;
    } catch (err) {
      console.error('[PiAgentProviderAdapter] history load failed:', err);
      yield {
        type: 'error',
        error: 'history unavailable, continuing fresh',
        isComplete: false,
      };
    }

    // 6. Construct Agent — wire tools + hooks from pi-runtime
    const { tools, hooks, externalProviderCatalog, skillCatalog, activeSkillContext } = toolBundle;
    const promptBundle = buildPiRunPrompt({
      systemPrompt: options.systemPrompt,
      externalProviderCatalog,
      skillCatalog,
      activeSkillContext,
      isPlanMode,
    });

    // Context snapshot for the /context command. The skill catalog is counted
    // separately from the base prompt; the external provider catalog and the
    // plan-mode suffix ride with the base prompt. Keyed by the zclaudia
    // session id (what the desktop knows), not the adapter-local sessionId.
    // The estimate intentionally omits the catalog boilerplate/separators baseSystemPrompt adds (~tens of tokens; noise for a chars/4 estimate).
    capturePiRunContextSnapshot({
      sessionId: options.claudiaSessionId,
      model: ctx.model,
      contextWindow: effectiveContextWindow,
      contextWindowSource,
      prompt: promptBundle,
      tools,
    });

    yield* runPiAgentStream({
      userInput: input,
      options,
      sessionId,
      ctx,
      modelInfo,
      supportsVision,
      history,
      tools,
      hooks,
      effectiveSystemPrompt: promptBundle.effectiveSystemPrompt,
    });
  }
}
