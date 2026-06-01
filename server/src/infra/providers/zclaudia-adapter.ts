import type Database from 'better-sqlite3';
import { getModel, type Model } from '@earendil-works/pi-ai';
import { Agent, type AgentEvent, type AgentMessage } from '@earendil-works/pi-agent-core';
import type { PCPProviderManifest } from '@zclaudia/shared/core/pcp';
import type { ProviderPolicy } from '@zclaudia/shared/core/provider-policy';
import type { ClaudeMessage, ProviderAdapter, RunOptions } from './types.js';

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

function buildModel(): Model<unknown> {
  const provider = process.env.PI_PROVIDER || DEFAULT_PROVIDER;
  const model = process.env.PI_MODEL || DEFAULT_MODEL;
  return getModel(provider, model) as Model<unknown>;
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

export function translateEvent(
  event: AgentEvent,
  ctx: TranslateContext,
  usage?: UsageHint,
): ClaudeMessage | undefined {
  try {
    switch (event.type) {
      case 'agent_start':
        return {
          type: 'init',
          sessionId: ctx.sessionId,
          systemInfo: {
            model: ctx.model,
            cwd: ctx.cwd,
            permissionMode: ctx.permissionMode || 'default',
            tools: [],
            agents: ['zclaudia'],
          },
        };
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

  async *run(input: string, options: RunOptions): AsyncGenerator<ClaudeMessage, void, void> {
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
    let model: ReturnType<typeof buildModel>;
    try {
      model = buildModel();
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
    const agent = new Agent({
      initialState: {
        systemPrompt: options.systemPrompt ?? '',
        model,
        messages: history,
      },
    });

    // 5. Subscribe → translate → queue
    // Skip translated `init` because we already emitted one manually above;
    // pi's `agent_start` event translates to `init`, which would duplicate.
    const queue = new AsyncQueue<ClaudeMessage>();
    const unsubscribe = agent.subscribe(event => {
      const translated = translateEvent(event as AgentEvent, ctx);
      if (translated && translated.type !== 'init') queue.push(translated);
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
    }
  }
}
