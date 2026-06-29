import { streamSimple } from '@earendil-works/pi-ai';
import { Agent, convertToLlm, type AgentEvent, type AgentMessage, type AgentTool, type StreamFn } from '@earendil-works/pi-agent-core';
import type { ProviderRuntimeEvent, RunOptions } from '../types.js';
import { CodexOAuthError } from '../../../domains/llm-profiles/codex-oauth-errors.js';
import type { AgentHooksOutput } from './agent-hooks.js';
import { AsyncQueue } from './async-queue.js';
import type { BuiltModel } from './build-model.js';
import type { TranslateContext } from './message-event-translator.js';
import { translateEvent } from './message-event-translator.js';
import { translateToolEvent } from './tool-event-translator.js';
import { withStreamRetry } from './retry-stream.js';
import { extractErrorStop, extractLastCallUsage, extractUsage } from './usage-extractor.js';
import { recordPiContextUsage } from './context-observer.js';

export async function* runPiAgentStream(input: {
  userInput: string;
  options: RunOptions;
  sessionId: string;
  ctx: TranslateContext;
  modelInfo: BuiltModel;
  supportsVision: boolean;
  history: AgentMessage[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: AgentTool<any>[];
  hooks: AgentHooksOutput;
  effectiveSystemPrompt: string;
}): AsyncGenerator<ProviderRuntimeEvent, void, void> {
  const {
    userInput,
    options,
    sessionId,
    ctx,
    modelInfo,
    supportsVision,
    history,
    tools,
    hooks,
    effectiveSystemPrompt,
  } = input;

  // Queue is created before agentOpts so the onRetry callback can push
  // retry_scheduled messages without a forward reference to the queue.
  const queue = new AsyncQueue<ProviderRuntimeEvent>();

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
    // Use pi's harness converter, NOT the Agent's `defaultConvertToLlm`. The
    // default merely FILTERS to user/assistant/toolResult and silently DROPS
    // `compactionSummary` / `branchSummary` messages — so after any compaction
    // the post-cut summary built by buildContext() never reaches the provider
    // and the model loses all pre-compaction memory (looks like total amnesia).
    // The harness converter renders those summary messages into a `user` turn
    // (COMPACTION_SUMMARY_PREFIX + summary). See agent.js `defaultConvertToLlm`
    // vs harness/messages.js `convertToLlm`.
    convertToLlm,
  };
  if (modelInfo.getApiKey) agentOpts.getApiKey = modelInfo.getApiKey;
  if (hooks.transformContext) agentOpts.transformContext = hooks.transformContext;
  // pi-agent-core's Agent does not forward cacheRetention to StreamOptions,
  // so a per-profile preference has to ride in via a streamFn wrapper. When
  // the profile doesn't set one, leave pi-ai's own default ('short', plus
  // the PI_CACHE_RETENTION env knob) untouched.
  // 'none' is deliberately truthy here: it rides the wrapper to actively
  // disable cache_control markers (pi-ai treats it as opt-out, not default).
  const cacheRetention = options.llmProfileConfig?.cacheRetention;
  const baseStreamFn: StreamFn = hooks.streamFn ?? streamSimple;
  const cachedStreamFn: StreamFn = cacheRetention
    ? (((m, c, o) => baseStreamFn(m, c, { ...o, cacheRetention })) as StreamFn)
    : baseStreamFn;
  // Retry wrapping is unconditional: pre-first-token transient failures
  // (429/529/5xx/network) back off and retry instead of failing the run.
  agentOpts.streamFn = withStreamRetry(cachedStreamFn, {
    onRetry: (info) => {
      queue.push({
        type: 'retry_scheduled',
        retryInfo: info,
      } as ProviderRuntimeEvent);
    },
  });

  const agent = new Agent(agentOpts);

  // Expose mid-run steer entry point synchronously so application has a
  // handle BEFORE pi can emit any event. The callback is invoked once per run.
  options.onAgentReady?.({
    steer: (msg: AgentMessage) => agent.steer(msg),
  });

  // `agent_start` is intentionally not translated by translateEvent; init is
  // emitted manually by the adapter as a run-bootstrap concern.
  // Listener MUST stay synchronous: we rely on `result` being pushed to the queue
  // before `agent.prompt(input).then(close)` settles. Making this async would
  // break the init -> ... -> result -> close ordering guarantee.
  const unsubscribe = agent.subscribe(event => {
    // Bridge turn_start -> onSteerConsumed BEFORE any downstream forwarding.
    // With steeringMode:'all', turn_start fires after the steering queue is
    // drained, so this is the atomic point to clear pendingSteers tracking.
    if (event.type === 'turn_start') {
      try {
        options.onSteerConsumed?.();
      } catch (err) {
        console.warn('[PiAgentProviderAdapter] onSteerConsumed callback threw:', err);
      }
    }

    // 1. Text / thinking / result path
    if (event.type === 'agent_end') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messages = (event as any).messages as AgentMessage[];
      const usage = extractUsage(messages);

      recordPiContextUsage({
        sessionId: options.claudiaSessionId,
        lastCallUsage: extractLastCallUsage(messages),
      });

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

  // Run prompt; close queue on completion or push error on rejection.
  const resolvedImages = options.images ?? [];
  let promptInput = userInput;
  let promptImages: Array<{ type: 'image'; data: string; mimeType: string }> | undefined;
  if (resolvedImages.length > 0 && supportsVision) {
    promptImages = resolvedImages.map((img) => ({ type: 'image' as const, data: img.data, mimeType: img.mimeType }));
  } else if (resolvedImages.length > 0) {
    // Vision degradation: the conversation continues with a textual stand-in
    // per image instead of failing the run on a text-only model.
    promptInput = `${userInput}\n\n${resolvedImages
      .map((img) => `[Image attached: ${img.name} — current model does not support vision]`)
      .join('\n')}`;
  }
  agent.prompt(promptInput, promptImages)
    .then(() => { queue.close(); })
    .catch(err => {
      const errorMsg: ProviderRuntimeEvent = {
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
