import { describe, it, expect } from 'vitest';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import {
  createCompactionSummaryMessage,
  type AgentMessage,
  type StreamFn,
} from '@earendil-works/pi-agent-core';
import { runPiAgentStream } from '../agent-stream.js';

const am = (over: Partial<AssistantMessage> = {}): AssistantMessage =>
  ({ role: 'assistant', content: [], stopReason: 'stop', ...over }) as unknown as AssistantMessage;

/**
 * A streamFn that records the LLM-ready messages it is handed (the payload that
 * would go on the wire) and returns a minimal terminal assistant stream so the
 * agent loop completes after one turn.
 */
function captureStreamFn(): {
  fn: StreamFn;
  captured: { messages: unknown[]; tools?: unknown[] };
} {
  const captured: { messages: unknown[]; tools?: unknown[] } = { messages: [] };

  const fn: StreamFn = (_model: any, llmContext: any) => {
    captured.messages = llmContext.messages;
    captured.tools = llmContext.tools;
    const stream = createAssistantMessageEventStream();
    void (async () => {
      stream.push({ type: 'start', partial: am() } as never);
      stream.push({ type: 'done', reason: 'stop', message: am() } as never);
      stream.end();
    })();
    return stream as never;
  };
  return { fn, captured };
}

describe('runPiAgentStream — compaction summary delivery', () => {
  // Regression guard for the post-compaction "amnesia" bug: buildContext() puts
  // the compaction summary into history as a `compactionSummary`-role message.
  // The Agent's `defaultConvertToLlm` only keeps user/assistant/toolResult and
  // SILENTLY DROPS that role, so the summary never reached the provider and the
  // model lost all pre-compaction memory. agent-stream must wire pi's harness
  // `convertToLlm`, which renders the summary into a `user` turn instead.
  it('delivers the compaction summary to the provider (not dropped)', async () => {
    const SUMMARY = 'GOAL: Dockerize gen_csms_token.py into the llm-gateway-proxy service.';
    const history: AgentMessage[] = [
      createCompactionSummaryMessage(
        SUMMARY,
        1410063,
        new Date(0).toISOString()
      ) as unknown as AgentMessage,
    ];
    const { fn, captured } = captureStreamFn();

    const gen = runPiAgentStream({
      userInput: '如果不用 docker 是不是就能解决这个问题了',

      options: { claudiaSessionId: 's1' } as any,
      sessionId: 's1',
      ctx: { sessionId: 's1', model: 'test-model', cwd: '/tmp' },

      modelInfo: {
        model: {
          id: 'test-model',
          name: 'test',
          api: 'unknown',
          provider: 'test',
          baseUrl: '',
          reasoning: false,
          input: [],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1_000_000,
          maxTokens: 1024,
        },
      } as any,
      supportsVision: false,
      history,
      tools: [],

      hooks: { streamFn: fn } as any,
      effectiveSystemPrompt: 'You are a helpful assistant.',
    });

    for await (const _event of gen) {
      /* drain to completion */
    }

    const serialized = JSON.stringify(captured.messages);
    expect(serialized).toContain(SUMMARY);
    // The special role must have been converted away (into a `user` turn).
    expect(
      (captured.messages as Array<{ role?: string }>).some(m => m.role === 'compactionSummary')
    ).toBe(false);
    expect((captured.messages as Array<{ role?: string }>).some(m => m.role === 'user')).toBe(true);
  });

  it('normalizes tool schemas for a Kimi model behind a private OpenAI-compatible gateway', async () => {
    const { fn, captured } = captureStreamFn();
    const originalParameters = {
      type: 'object',
      properties: { path: { type: 'string' }, file_path: { type: 'string' } },
      anyOf: [{ required: ['path'] }, { required: ['file_path'] }],
    };
    const tools = [
      {
        name: 'Read',
        label: 'Read',
        description: 'Read a file',
        parameters: originalParameters,
        execute: async () => ({ content: [], details: {} }),
      },
    ] as any;

    const gen = runPiAgentStream({
      userInput: 'read the file',
      options: { claudiaSessionId: 's-kimi' } as any,
      sessionId: 's-kimi',
      ctx: { sessionId: 's-kimi', model: 'kimi-k3', cwd: '/tmp' },
      modelInfo: {
        model: {
          id: 'kimi-k3',
          name: 'Kimi K3',
          api: 'openai-completions',
          provider: 'openai',
          baseUrl: 'http://192.168.2.150:3022/v1',
          reasoning: true,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1_000_000,
          maxTokens: 8192,
        },
      } as any,
      supportsVision: false,
      history: [],
      tools,
      hooks: { streamFn: fn } as any,
      effectiveSystemPrompt: 'You are a coding agent.',
    });

    for await (const _event of gen) {
      /* drain to completion */
    }

    expect(captured.tools?.[0]).toMatchObject({
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, file_path: { type: 'string' } },
      },
    });
    expect((captured.tools?.[0] as any).parameters.anyOf).toBeUndefined();
    expect(originalParameters.type).toBe('object');
  });
});
