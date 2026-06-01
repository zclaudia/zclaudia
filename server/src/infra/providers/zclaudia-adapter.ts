import type Database from 'better-sqlite3';
import { getModel, type Model } from '@earendil-works/pi-ai';
import { Agent, type AgentEvent, type AgentMessage } from '@earendil-works/pi-agent-core';
import type { PCPProviderManifest } from '@zclaudia/shared/core/pcp';
import type { ProviderPolicy } from '@zclaudia/shared/core/provider-policy';
import type { ClaudeMessage, PermissionCallback, ProviderAdapter, RunOptions } from './types.js';

const DEFAULT_PROVIDER = 'anthropic';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const HISTORY_LIMIT = 50;

interface StoredRow {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
}

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
    { id: 'tool.call', supported: false, degradation: 'fallback_to_text' },
    { id: 'tool.inject', supported: false, degradation: 'fallback_to_text' },
    { id: 'interaction.form', supported: false, degradation: 'fallback_to_text' },
    { id: 'interaction.approval', supported: false, degradation: 'fallback_to_text' },
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

export function loadHistory(db: Database.Database | undefined, sessionId: string | undefined): AgentMessage[] {
  if (!db || !sessionId) return [];

  // Schema mirrors messages table in server/src/infra/storage/migrations (keep in sync if columns change).
  const rows = db.prepare<[string, number], StoredRow>(`
    SELECT id, role, content, created_at as createdAt
    FROM messages
    WHERE session_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(sessionId, HISTORY_LIMIT);

  // Reverse to chronological order
  const chronological = rows.reverse();

  // Strip trailing user message (the current turn's input, just inserted by run-bootstrap)
  if (chronological.length > 0 && chronological[chronological.length - 1].role === 'user') {
    chronological.pop();
  }

  // Convert to pi AgentMessage format; skip system rows
  const messages: AgentMessage[] = [];
  for (const row of chronological) {
    if (row.role === 'system') continue;
    if (row.role === 'user') {
      messages.push({ role: 'user', content: row.content, timestamp: row.createdAt } as AgentMessage);
    } else if (row.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: [{ type: 'text', text: row.content }],
        stopReason: 'stop',
        timestamp: row.createdAt,
      } as AgentMessage);
    }
  }

  return messages;
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
 * Extract usage from the last assistant message in an `agent_end` payload.
 *
 * pi exports `getLastAssistantUsage`, but it operates on `SessionTreeEntry[]` (session-repo entries),
 * not on `AgentMessage[]` (which is what `agent_end.messages` carries). So we scan inline and
 * extract `usage.input` / `usage.output` from the last assistant message that has a usage block.
 */
function extractUsage(messages: AgentMessage[]): UsageHint | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; usage?: { input?: number; output?: number } };
    if (m.role === 'assistant' && m.usage) {
      return { inputTokens: m.usage.input ?? 0, outputTokens: m.usage.output ?? 0 };
    }
  }
  return undefined;
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
        const sub = event.assistantMessageEvent;
        if (sub && sub.type === 'text_delta' && typeof sub.delta === 'string') {
          return { type: 'assistant', content: sub.delta };
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

export const __testables = { AsyncQueue, buildModel, loadHistory, translateEvent };

export class ZClaudiaAdapter implements ProviderAdapter {
  readonly type = 'zclaudia';
  readonly manifest = manifest;
  readonly policy = policy;

  async *run(
    input: string,
    options: RunOptions,
    _onPermission?: PermissionCallback,
  ): AsyncGenerator<ClaudeMessage, void, void> {
    // MVP: pure conversation, no tools, so onPermission is unused.
    // Wired into pi `beforeToolCall` hook in a future sub-project.
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
      history = loadHistory(options.db, options.claudiaSessionId);
    } catch (err) {
      console.error('[ZClaudiaAdapter] history load failed:', err);
      yield {
        type: 'error',
        error: 'history unavailable, continuing fresh',
        isComplete: false,
      };
    }

    // 4. Construct Agent
    const agentOpts: ConstructorParameters<typeof Agent>[0] = {
      initialState: {
        systemPrompt: options.systemPrompt ?? '',
        model: modelInfo.model,
        messages: history,
      },
    };
    if (modelInfo.getApiKey) {
      agentOpts.getApiKey = modelInfo.getApiKey;
    }
    const agent = new Agent(agentOpts);

    // 5. Subscribe → translate → queue
    // `agent_start` is intentionally not translated by translateEvent; init is
    // emitted manually above as a run-bootstrap concern.
    const queue = new AsyncQueue<ClaudeMessage>();
    // Listener MUST stay synchronous: we rely on `result` being pushed to the queue
    // before `agent.prompt(input).then(close)` settles. Making this async would
    // break the init → ... → result → close ordering guarantee.
    const unsubscribe = agent.subscribe(event => {
      if (event.type === 'agent_end') {
        const usage = extractUsage(event.messages);
        const result = translateEvent(event as AgentEvent, ctx, usage);
        if (result) queue.push(result);
        return;
      }
      const translated = translateEvent(event as AgentEvent, ctx);
      if (translated) queue.push(translated);
    });

    // 6. Run prompt; close queue on completion or push error on rejection
    agent.prompt(input)
      .then(() => queue.close())
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
      for await (const m of queue) yield m;
    } finally {
      unsubscribe();
      // Cancel any in-flight pi work (token leak prevention on early break /
      // consumer error). Safe to call on an already-idle agent.
      agent.abort();
    }
  }
}
