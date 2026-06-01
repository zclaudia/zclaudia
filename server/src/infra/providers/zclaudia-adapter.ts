import type Database from 'better-sqlite3';
import { getModel, type Model } from '@earendil-works/pi-ai';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
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

export const __testables = { AsyncQueue, buildModel, loadHistory };

function buildStubResponse(input: string, options: RunOptions): string {
  const mode = options.mode || 'default';
  const model = options.model || 'stub';
  const prompt = input.trim() || '(empty prompt)';
  return [
    'ZClaudia agent runtime stub is active.',
    '',
    `Mode: ${mode}`,
    `Model: ${model}`,
    `Prompt: ${prompt}`,
    '',
    'pi-agent is not integrated yet; this response confirms the zclaudia runtime path is wired.',
  ].join('\n');
}

export class ZClaudiaAdapter implements ProviderAdapter {
  readonly type = 'zclaudia';
  readonly manifest = manifest;
  readonly policy = policy;

  async *run(input: string, options: RunOptions): AsyncGenerator<ClaudeMessage, void, void> {
    const sessionId = options.sessionId || `zclaudia-stub-${Date.now()}`;
    yield {
      type: 'init',
      sessionId,
      systemInfo: {
        model: options.model || 'zclaudia-stub',
        cwd: options.cwd,
        permissionMode: options.mode || 'default',
        tools: [],
        agents: ['zclaudia-stub'],
      },
    };

    yield {
      type: 'assistant',
      content: buildStubResponse(input, options),
    };

    yield {
      type: 'result',
      usage: {
        inputTokens: input.length,
        outputTokens: 0,
      },
      isComplete: true,
    };
  }
}
