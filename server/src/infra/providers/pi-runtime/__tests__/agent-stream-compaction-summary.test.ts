import { describe, it, expect } from 'vitest';
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
} from '@earendil-works/pi-ai';
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
function captureStreamFn(): { fn: StreamFn; captured: { messages: unknown[] } } {
  const captured: { messages: unknown[] } = { messages: [] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn: StreamFn = (_model: any, llmContext: any) => {
    captured.messages = llmContext.messages;
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
      createCompactionSummaryMessage(SUMMARY, 1410063, new Date(0).toISOString()) as unknown as AgentMessage,
    ];
    const { fn, captured } = captureStreamFn();

    const gen = runPiAgentStream({
      userInput: '如果不用 docker 是不是就能解决这个问题了',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options: { claudiaSessionId: 's1' } as any,
      sessionId: 's1',
      ctx: { sessionId: 's1', model: 'test-model', cwd: '/tmp' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      modelInfo: { model: { id: 'test-model', name: 'test', api: 'unknown', provider: 'test', baseUrl: '', reasoning: false, input: [], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000_000, maxTokens: 1024 } } as any,
      supportsVision: false,
      history,
      tools: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hooks: { streamFn: fn } as any,
      effectiveSystemPrompt: 'You are a helpful assistant.',
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _event of gen) { /* drain to completion */ }

    const serialized = JSON.stringify(captured.messages);
    expect(serialized).toContain(SUMMARY);
    // The special role must have been converted away (into a `user` turn).
    expect((captured.messages as Array<{ role?: string }>).some((m) => m.role === 'compactionSummary')).toBe(false);
    expect((captured.messages as Array<{ role?: string }>).some((m) => m.role === 'user')).toBe(true);
  });
});
