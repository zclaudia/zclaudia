import { streamSimple, type Usage } from '@earendil-works/pi-ai';
import { Agent, type AgentEvent, type AgentMessage, type StreamFn } from '@earendil-works/pi-agent-core';
import type { PCPProviderManifest } from '@zclaudia/shared/core/pcp';
import type { ProviderPolicy } from '@zclaudia/shared/core/provider-policy';
import type { ClaudeMessage, PermissionCallback, ProviderAdapter, RunOptions } from './types.js';
import {
  buildTools,
  buildAgentHooks,
  translateToolEvent,
  rebuildHistory,
  buildModel,
  buildExternalMetaTools,
  buildExternalProviderCatalog,
  concreteMcpToolName,
  createConcreteMcpTool,
  externalToolKey,
  buildActiveSkillContext,
  buildSkillCatalog,
  buildSkillMetaTools,
  type BuiltModel,
} from './pi-runtime/index.js';
import { CodexOAuthError } from '../../domains/llm-profiles/codex-oauth-errors.js';
import { ALL_TOOL_NAMES, READ_ONLY_TOOL_NAMES, normalizeToolName, type ToolName } from '@zclaudia/shared/core/tools';
import { resolveContextWindow } from '../../application/conversation/compaction/context-windows.js';

const PLAN_MODE_SYSTEM_PROMPT_SUFFIX =
  '\n\nYou are in PLAN mode. Produce a concrete plan for the user to review and approve. ' +
  'Do not modify files or execute side-effecting commands; only read-only or clarification tools are available. ' +
  'Once the plan is ready, end your turn and wait for the user to confirm before executing anything.';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

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
    { id: 'input.image', supported: false, degradation: 'fallback_to_notice' },
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
};

class AsyncQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.buffer.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length) {
      const waiter = this.waiters.shift()!;
      waiter({ value: undefined as unknown as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        }
        return new Promise<IteratorResult<T>>(resolve => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}

interface TranslateContext {
  sessionId: string;
  model: string;
  cwd: string;
  permissionMode?: string;
}

function zeroUsage(): Usage {
  return {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/**
 * Find the LLM-level error swallowed by pi-agent-core's run loop.
 *
 * Pi-agent-core treats `done` and `error` stream stop reasons identically:
 * both go through the same `message_end` path, dropping the error detail and
 * leaving only an empty assistant message with `stopReason: 'error'`. Without
 * surfacing this, the run looks like "completed in 120ms with zero output"
 * instead of "the provider returned HTTP 503 model_not_found".
 *
 * Returns the provider's error message when the final assistant message
 * stopped with an error, otherwise undefined.
 */
function extractErrorStop(messages: AgentMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; stopReason?: string; errorMessage?: string };
    if (m.role !== 'assistant') continue;
    return m.stopReason === 'error'
      ? (m.errorMessage || 'LLM provider returned an error stop reason')
      : undefined;
  }
  return undefined;
}

/**
 * Sum usage across all assistant messages in an `agent_end` payload.
 *
 * A tool-using turn yields multiple assistant messages (one per LLM call); each carries
 * its own usage block. We sum them so the final `result` event reflects the full turn cost,
 * not just the last LLM call.
 */
function extractUsage(messages: AgentMessage[]): Usage {
  const acc = zeroUsage();
  for (const m of messages) {
    const msg = m as { role?: string; usage?: Partial<Usage> & { cost?: Partial<Usage['cost']> } };
    if (msg.role === 'assistant' && msg.usage) {
      acc.input += msg.usage.input ?? 0;
      acc.output += msg.usage.output ?? 0;
      acc.cacheRead += msg.usage.cacheRead ?? 0;
      acc.cacheWrite += msg.usage.cacheWrite ?? 0;
      acc.totalTokens += msg.usage.totalTokens ?? 0;
      if (msg.usage.cost) {
        acc.cost.input += msg.usage.cost.input ?? 0;
        acc.cost.output += msg.usage.cost.output ?? 0;
        acc.cost.cacheRead += msg.usage.cost.cacheRead ?? 0;
        acc.cost.cacheWrite += msg.usage.cost.cacheWrite ?? 0;
        acc.cost.total += msg.usage.cost.total ?? 0;
      }
    }
  }
  return acc;
}

export function translateEvent(
  event: AgentEvent,
  ctx: TranslateContext,
  usage?: Usage,
): ClaudeMessage | undefined {
  try {
    switch (event.type) {
      // agent_start is intentionally not translated; run() emits `init` directly
      // as a run-bootstrap concern (see ZClaudiaAdapter.run).
      case 'message_update': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sub = (event as any).assistantMessageEvent;
        if (!sub) return undefined;
        if (sub.type === 'text_delta' && typeof sub.delta === 'string') {
          return { type: 'assistant', content: sub.delta };
        }
        if (sub.type === 'thinking_delta' && typeof sub.delta === 'string') {
          return { type: 'thinking_delta', thinkingContent: sub.delta };
        }
        if (sub.type === 'thinking_end') {
          // Extract thinkingSignature from the partial.content (set by pi when thinking completes)
          const blocks = sub.partial?.content;
          if (Array.isArray(blocks) && typeof sub.contentIndex === 'number') {
            const block = blocks[sub.contentIndex];
            if (block && block.type === 'thinking' && typeof block.thinkingSignature === 'string') {
              return { type: 'thinking_delta', thinkingSignature: block.thinkingSignature };
            }
          }
          return undefined;
        }
        return undefined;
      }
      case 'agent_end':
        return {
          type: 'result',
          isComplete: true,
          usage: usage ?? zeroUsage(),
        };
      // Explicit no-ops:
      case 'message_start':
      case 'message_end':
      case 'turn_start':
      case 'turn_end':
      case 'tool_execution_start':
      case 'tool_execution_update':
      case 'tool_execution_end':
        return undefined;
      default:
        return undefined;
    }
  } catch (err) {
    console.warn('[ZClaudiaAdapter] translateEvent failed:', err);
    return undefined;
  }
}

export const __testables = { AsyncQueue, buildModel, translateEvent, extractErrorStop };

export class ZClaudiaAdapter implements ProviderAdapter {
  readonly type = 'zclaudia';
  readonly manifest = manifest;
  readonly policy = policy;

  async *run(
    input: string,
    options: RunOptions,
    onPermission?: PermissionCallback,
  ): AsyncGenerator<ClaudeMessage, void, void> {
    const sessionId = options.sessionId || `zclaudia-${Date.now()}`;
    const ctx: TranslateContext = {
      sessionId,
      model: process.env.PI_MODEL || DEFAULT_MODEL,
      cwd: options.cwd,
      permissionMode: options.mode === 'plan' ? 'plan' : 'default',
    };

    // 1. Build the model first (config errors stop here, before any init event).
    //    Init carries contextWindow which requires a built model. If the LLM
    //    profile declares a per-model entry for this model id, pass it so
    //    user-declared contextWindow / maxTokens / displayName override the
    //    pi-ai registry / openai-compat defaults (T3 of llm-profile-models).
    let modelInfo: BuiltModel;
    try {
      const modelId = options.agentProfile?.model;
      const modelEntry = modelId
        ? options.llmProfileConfig?.models?.find((m) => m.modelId === modelId)
        : undefined;
      modelInfo = buildModel(options.llmProfileConfig, modelId, modelEntry);
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
    const effectiveTools: ToolName[] = isPlanMode
      ? requestedTools.filter((t) => READ_ONLY_TOOL_NAMES.includes(t))
      : requestedTools;
    const externalToolNames = options.externalToolState
      ? [
        ...options.externalToolState.loadedExternalTools.flatMap((ref) => (
          ref.source === 'mcp' ? [concreteMcpToolName(ref)] : []
        )),
        'ListExternalToolProviders',
        'SearchExternalTools',
        'InspectExternalTool',
        'LoadExternalTool',
      ]
      : [];
    const skillToolNames = options.skillState
      ? ['ListSkills', 'SearchSkills', 'InspectSkill', 'LoadSkill', 'RunSkill']
      : [];

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
        tools: [...effectiveTools, ...externalToolNames, ...skillToolNames],
        agents: ['zclaudia'],
      },
    };

    // 5. Load history (non-fatal failure)
    let history: AgentMessage[] = [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      history = rebuildHistory(options.db, options.claudiaSessionId).messages as any;
    } catch (err) {
      console.error('[ZClaudiaAdapter] history load failed:', err);
      yield {
        type: 'error',
        error: 'history unavailable, continuing fresh',
        isComplete: false,
      };
    }

    // 6. Construct Agent — wire tools + hooks from pi-runtime
    const tools = buildTools(options.cwd, {
      enabled: effectiveTools,
      serverPort: options.serverPort,
      sessionId: options.claudiaSessionId,
      runId: options.runId,
      permissionOverride: options.permissionOverride,
      db: options.db,
      agentTaskExecutor: options.agentTaskExecutor,
      permissionCallback: onPermission,
    });
    if (options.externalToolState) {
      for (const ref of options.externalToolState.loadedExternalTools) {
        if (ref.source === 'mcp') {
          tools.push(createConcreteMcpTool(
            ref,
            options.db,
            options.externalToolState.loadedExternalToolSchemas?.[externalToolKey(ref)],
          ));
        }
      }
      tools.push(...buildExternalMetaTools({
        db: options.db,
        state: options.externalToolState,
        toolsArray: tools,
      }));
    }
    if (options.skillState) {
      tools.push(...buildSkillMetaTools({
        state: options.skillState,
        execution: {
          cwd: options.cwd,
          db: options.db,
          enabledTools: effectiveTools,
          llmProfileConfig: options.llmProfileConfig,
          agentProfile: options.agentProfile,
          permissionOverride: options.permissionOverride,
          permissionCallback: onPermission,
        },
      }));
    }
    const hooks = buildAgentHooks({
      permissionCallback: onPermission ?? (async () => ({ behavior: 'deny', message: 'no permission callback provided' })),
    });

    const externalProviderCatalog = options.externalToolState
      ? buildExternalProviderCatalog(options.externalToolState, options.db)
      : '';
    const skillCatalog = options.skillState
      ? buildSkillCatalog(options.skillState, options.agentProfile)
      : '';
    const activeSkillContext = options.skillState
      ? buildActiveSkillContext(options.skillState)
      : '';
    const baseSystemPrompt = [
      options.systemPrompt ?? '',
      externalProviderCatalog
        ? `\n\n${externalProviderCatalog}\nUse SearchExternalTools and InspectExternalTool before loading external tools. LoadExternalTool only makes a tool available in this session; execution may still require permission.`
        : '',
      skillCatalog
        ? `\n\n${skillCatalog}`
        : '',
      activeSkillContext
        ? `\n\n${activeSkillContext}`
        : '',
    ].join('');
    const effectiveSystemPrompt = isPlanMode
      ? baseSystemPrompt + PLAN_MODE_SYSTEM_PROMPT_SUFFIX
      : baseSystemPrompt;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const agentOpts: any = {
      initialState: {
        systemPrompt: effectiveSystemPrompt,
        model: modelInfo.model,
        messages: history,
        tools,
        ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
      },
      // Drain the entire steering queue between turns (pi default is
      // 'one-at-a-time'). With 'all', every `turn_start` is the application's
      // signal that pendingSteers tracking can be cleared atomically.
      steeringMode: 'all',
      beforeToolCall: hooks.beforeToolCall,
      afterToolCall: hooks.afterToolCall,
      shouldStopAfterTurn: hooks.shouldStopAfterTurn,
      // pi-ai uses this for session-scoped cache routing on providers that
      // support it; the zclaudia session id is stable across runs.
      sessionId: options.claudiaSessionId ?? sessionId,
    };
    if (modelInfo.getApiKey) agentOpts.getApiKey = modelInfo.getApiKey;
    if (hooks.transformContext) agentOpts.transformContext = hooks.transformContext;
    // pi-agent-core's Agent does not forward cacheRetention to StreamOptions,
    // so a per-profile preference has to ride in via a streamFn wrapper. When
    // the profile doesn't set one, leave pi-ai's own default ('short', plus
    // the PI_CACHE_RETENTION env knob) untouched.
    // 'none' is deliberately truthy here: it rides the wrapper to actively disable cache_control markers (pi-ai treats it as opt-out, not default).
    const cacheRetention = options.llmProfileConfig?.cacheRetention;
    if (cacheRetention) {
      const inner: StreamFn = hooks.streamFn ?? streamSimple;
      agentOpts.streamFn = ((model, context, streamOpts) =>
        inner(model, context, { ...streamOpts, cacheRetention })) as StreamFn;
    } else if (hooks.streamFn) {
      agentOpts.streamFn = hooks.streamFn;
    }

    const agent = new Agent(agentOpts);

    // Expose mid-run steer entry point synchronously so application has a
    // handle BEFORE pi can emit any event. The callback is invoked once per run.
    options.onAgentReady?.({
      steer: (msg: AgentMessage) => agent.steer(msg),
    });

    // 7. Subscribe → translate → queue
    // `agent_start` is intentionally not translated by translateEvent; init is
    // emitted manually above as a run-bootstrap concern.
    const queue = new AsyncQueue<ClaudeMessage>();
    // Listener MUST stay synchronous: we rely on `result` being pushed to the queue
    // before `agent.prompt(input).then(close)` settles. Making this async would
    // break the init → ... → result → close ordering guarantee.
    const unsubscribe = agent.subscribe(event => {
      // Bridge turn_start → onSteerConsumed BEFORE any downstream forwarding.
      // With steeringMode:'all', turn_start fires after the steering queue is
      // drained, so this is the atomic point to clear pendingSteers tracking.
      if (event.type === 'turn_start') {
        try {
          options.onSteerConsumed?.();
        } catch (err) {
          console.warn('[ZClaudiaAdapter] onSteerConsumed callback threw:', err);
        }
      }

      // 1. Text / thinking / result path
      if (event.type === 'agent_end') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const messages = (event as any).messages as AgentMessage[];
        const usage = extractUsage(messages);

        // Surface LLM-level errors that pi-agent-core's loop quietly absorbs
        // (it routes `error` and `done` stop reasons through the same
        // `message_end` path). Without this, a 503 / bad model id / auth
        // failure looks like "session ran for 120ms and produced nothing".
        const errorReason = extractErrorStop(messages);
        if (errorReason) {
          queue.push({
            type: 'error',
            error: `LLM call failed: ${errorReason}. Check agent profile model id, LLM profile baseUrl/apiKey, or provider availability.`,
            isComplete: true,
          });
          // Skip the `result` translation: run-events treats `error` as a
          // terminal event (sets activeRun.phase = 'failed' and emits run_failed).
          // Emitting result on top would double-fire run_completed and persist
          // an empty assistant message.
          return;
        }

        const result = translateEvent(event as AgentEvent, ctx, usage);
        if (result) queue.push(result);
      } else {
        const textResult = translateEvent(event as AgentEvent, ctx);
        if (textResult) queue.push(textResult);
      }

      // 2. Tool path (independent of text path)
      const toolResult = translateToolEvent(event as AgentEvent, ctx);
      if (Array.isArray(toolResult)) {
        for (const r of toolResult) queue.push(r);
      } else if (toolResult) {
        queue.push(toolResult);
      }
    });

    // 8. Run prompt; close queue on completion or push error on rejection
    agent.prompt(input)
      .then(() => { queue.close(); })
      .catch(err => {
        const errorMsg: ClaudeMessage = {
          type: 'error',
          error: err instanceof Error ? err.message : String(err),
          isComplete: true,
        };
        if (err instanceof CodexOAuthError) {
          errorMsg.errorCode = err.code;
        }
        queue.push(errorMsg);
        queue.close();
      });

    // 9. Yield translated events
    try {
      for await (const m of queue) {
        yield m;
      }
    } finally {
      unsubscribe();
      // Cancel any in-flight pi work (token leak prevention on early break /
      // consumer error). Safe to call on an already-idle agent.
      agent.abort();
    }
  }
}
