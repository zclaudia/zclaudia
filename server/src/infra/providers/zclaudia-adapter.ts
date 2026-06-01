import { getModel, type Model } from '@earendil-works/pi-ai';
import { Agent, type AgentEvent, type AgentMessage } from '@earendil-works/pi-agent-core';
import type { PCPProviderManifest } from '@zclaudia/shared/core/pcp';
import type { ProviderPolicy } from '@zclaudia/shared/core/provider-policy';
import type { ClaudeMessage, PermissionCallback, ProviderAdapter, RunOptions } from './types.js';
import { buildTools, buildAgentHooks, translateToolEvent, rebuildHistory } from './pi-runtime/index.js';

const DEFAULT_PROVIDER = 'anthropic';
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
    { id: 'session.background_task', supported: false, degradation: 'fallback_to_text' },
  ],
};

const policy: ProviderPolicy = {
  modeSwitchSessionPolicy: 'preserve',
  sessionCwdPolicy: 'requested',
  emptyResultFallback: 'ZClaudia agent completed without additional output.',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BuiltModel = { model: Model<any>; getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined };

function buildModel(): BuiltModel {
  // If OPENAI_BASE_URL is set we build a custom openai-completions Model literal so
  // any OpenAI-compatible endpoint (DeepSeek / vLLM / Azure / corporate proxies / etc.)
  // works without being pre-registered in pi-ai's model registry.
  const baseUrl = process.env.OPENAI_BASE_URL;
  if (baseUrl) {
    const id = process.env.OPENAI_MODEL || 'gpt-4o';
    const provider = process.env.PI_PROVIDER || 'openai-custom';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model: Model<any> = {
      id,
      name: id,
      api: 'openai-completions',
      provider,
      baseUrl,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    };
    return {
      model,
      getApiKey: async () => process.env.OPENAI_API_KEY ?? '',
    };
  }

  const provider = process.env.PI_PROVIDER || DEFAULT_PROVIDER;
  const modelId = process.env.PI_MODEL || DEFAULT_MODEL;
  // pi-ai's getModel is generically typed on literal provider + model id.
  // Env-derived strings can't satisfy those generic constraints; cast through `string`
  // to erase the generic and let the runtime registry lookup do the work.
  // Model<T> requires T extends Api, so we use `any` to opt out of that constraint.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (getModel as (provider: string, model: string) => Model<any>)(provider, modelId);
  return { model };
}

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

interface UsageHint {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Sum usage across all assistant messages in an `agent_end` payload.
 *
 * A tool-using turn yields multiple assistant messages (one per LLM call); each carries
 * its own usage block. We sum them so the final `result` event reflects the full turn cost,
 * not just the last LLM call.
 */
function extractUsage(messages: AgentMessage[]): UsageHint {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const m of messages) {
    const msg = m as { role?: string; usage?: { input?: number; output?: number } };
    if (msg.role === 'assistant' && msg.usage) {
      inputTokens += msg.usage.input ?? 0;
      outputTokens += msg.usage.output ?? 0;
    }
  }
  return { inputTokens, outputTokens };
}

export function translateEvent(
  event: AgentEvent,
  ctx: TranslateContext,
  usage?: UsageHint,
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
          usage: {
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
          },
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

export const __testables = { AsyncQueue, buildModel, translateEvent };

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
      permissionMode: options.mode,
    };

    // 1. Always yield init first
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

    // 2. Build the model (config errors stop here)
    let modelInfo: BuiltModel;
    try {
      modelInfo = buildModel();
    } catch (err) {
      yield {
        type: 'error',
        error: `model configuration failed: ${err instanceof Error ? err.message : String(err)}. Check PI_PROVIDER / PI_MODEL / provider API key env vars.`,
        isComplete: true,
      };
      return;
    }

    // 3. Load history (non-fatal failure)
    let history: AgentMessage[] = [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      history = rebuildHistory(options.db, options.claudiaSessionId) as any;
    } catch (err) {
      console.error('[ZClaudiaAdapter] history load failed:', err);
      yield {
        type: 'error',
        error: 'history unavailable, continuing fresh',
        isComplete: false,
      };
    }

    // 4. Construct Agent — wire tools + hooks from pi-runtime
    const tools = buildTools(options.cwd);
    const hooks = buildAgentHooks({
      permissionCallback: onPermission ?? (async () => ({ behavior: 'deny', message: 'no permission callback provided' })),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const agentOpts: any = {
      initialState: {
        systemPrompt: options.systemPrompt ?? '',
        model: modelInfo.model,
        messages: history,
        tools,
      },
      beforeToolCall: hooks.beforeToolCall,
      afterToolCall: hooks.afterToolCall,
      shouldStopAfterTurn: hooks.shouldStopAfterTurn,
    };
    if (modelInfo.getApiKey) agentOpts.getApiKey = modelInfo.getApiKey;
    if (hooks.transformContext) agentOpts.transformContext = hooks.transformContext;
    if (hooks.streamFn) agentOpts.streamFn = hooks.streamFn;

    const agent = new Agent(agentOpts);

    // 5. Subscribe → translate → queue
    // `agent_start` is intentionally not translated by translateEvent; init is
    // emitted manually above as a run-bootstrap concern.
    const queue = new AsyncQueue<ClaudeMessage>();
    // Listener MUST stay synchronous: we rely on `result` being pushed to the queue
    // before `agent.prompt(input).then(close)` settles. Making this async would
    // break the init → ... → result → close ordering guarantee.
    const unsubscribe = agent.subscribe(event => {
      // 1. Text / thinking / result path
      if (event.type === 'agent_end') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const usage = extractUsage((event as any).messages);
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

    // 6. Run prompt; close queue on completion or push error on rejection
    agent.prompt(input)
      .then(() => { queue.close(); })
      .catch(err => {
        queue.push({
          type: 'error',
          error: err instanceof Error ? err.message : String(err),
          isComplete: true,
        });
        queue.close();
      });

    // 7. Yield translated events
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
