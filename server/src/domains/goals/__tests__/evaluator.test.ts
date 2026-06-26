import { describe, it, expect } from 'vitest';
import { GoalEvaluator, type EvaluatorLlmPort, type TranscriptMessage } from '../evaluator.js';

function transcript(items: Array<Partial<TranscriptMessage> & { role: TranscriptMessage['role'] }>): TranscriptMessage[] {
  return items.map((it, i) => ({
    role: it.role,
    content: it.content ?? `msg-${i}`,
    timestamp: it.timestamp ?? i,
  }));
}

describe('GoalEvaluator', () => {
  it('parses the LLM tool-call response into a verdict', async () => {
    const stub: EvaluatorLlmPort = {
      async evaluate() {
        return { kind: 'done', reason: 'all tests pass', inputTokens: 100, outputTokens: 20 };
      },
    };
    const ev = new GoalEvaluator(stub);
    const out = await ev.evaluate({
      objective: 'tests pass',
      transcript: transcript([{ role: 'user' }, { role: 'assistant' }]),
      llmProfileId: 'lp1',
    });
    expect(out.verdict.kind).toBe('done');
    expect(out.verdict.reason).toBe('all tests pass');
    expect(out.tokensUsed).toBe(120);
  });

  it('windows the transcript to the most recent N messages', async () => {
    let received: TranscriptMessage[] = [];
    const stub: EvaluatorLlmPort = {
      async evaluate(req) {
        received = req.transcript;
        return { kind: 'continue', reason: 'in progress', inputTokens: 0, outputTokens: 0 };
      },
    };
    const ev = new GoalEvaluator(stub);
    const items = transcript(
      Array.from({ length: 20 }, (_, i) => ({ role: 'user' as const, content: `m${i}` })),
    );
    await ev.evaluate({ objective: 'x', transcript: items, llmProfileId: 'lp1' });
    expect(received).toHaveLength(8);
    expect(received[7].content).toBe('m19');
  });

  it('maps adapter errors to an error verdict without throwing', async () => {
    const stub: EvaluatorLlmPort = {
      async evaluate() {
        throw new Error('upstream 502');
      },
    };
    const ev = new GoalEvaluator(stub);
    const out = await ev.evaluate({ objective: 'x', transcript: [], llmProfileId: 'lp1' });
    expect(out.verdict.kind).toBe('error');
    expect(out.verdict.reason).toContain('upstream 502');
    expect(out.tokensUsed).toBe(0);
  });

  it('truncates reason to 200 chars on success path', async () => {
    const longReason = 'x'.repeat(300);
    const stub: EvaluatorLlmPort = {
      async evaluate() {
        return { kind: 'done', reason: longReason, inputTokens: 0, outputTokens: 0 };
      },
    };
    const ev = new GoalEvaluator(stub);
    const out = await ev.evaluate({ objective: 'x', transcript: [], llmProfileId: 'lp1' });
    expect(out.verdict.reason).toHaveLength(200);
  });

  it('truncates reason to 200 chars on error path', async () => {
    const longMessage = 'y'.repeat(300);
    const stub: EvaluatorLlmPort = {
      async evaluate() {
        throw new Error(longMessage);
      },
    };
    const ev = new GoalEvaluator(stub);
    const out = await ev.evaluate({ objective: 'x', transcript: [], llmProfileId: 'lp1' });
    expect(out.verdict.kind).toBe('error');
    expect(out.verdict.reason).toHaveLength(200);
  });
});
