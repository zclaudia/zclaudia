import { describe, it, expect } from 'vitest';
import {
  summaryChunkBudget,
  planSummaryChunks,
  summarizeChunked,
  MIN_SUMMARY_CHUNK_BUDGET,
  SUMMARY_PROMPT_OVERHEAD_TOKENS,
  type SummaryGenerator,
} from '../chunked-summary.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = (size: number): any => ({ role: 'assistant', content: [], _size: size });
const bySize = (msg: { _size: number }) => msg._size;

describe('summaryChunkBudget', () => {
  it('reserves output + previous-summary + scaffold from the window', () => {
    expect(summaryChunkBudget(262_144, 16_384)).toBe(262_144 - 16_384 * 2 - SUMMARY_PROMPT_OVERHEAD_TOKENS);
  });
  it('never drops below the floor', () => {
    expect(summaryChunkBudget(10_000, 16_384)).toBe(MIN_SUMMARY_CHUNK_BUDGET);
  });
});

describe('planSummaryChunks', () => {
  it('keeps everything in one chunk when it fits', () => {
    const msgs = [m(100), m(100), m(100)];
    const chunks = planSummaryChunks(msgs, 1000, bySize);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(3);
  });

  it('splits into multiple chunks when over budget', () => {
    const msgs = [m(400), m(400), m(400), m(400)];
    const chunks = planSummaryChunks(msgs, 1000, bySize); // 400+400=800, +400 would be 1200>1000
    expect(chunks.map((c) => c.length)).toEqual([2, 2]);
  });

  it('gives an oversized single message its own chunk without dropping it', () => {
    const msgs = [m(100), m(5000), m(100)];
    const chunks = planSummaryChunks(msgs, 1000, bySize);
    // [100], [5000], [100] — 5000 can't combine with neighbors.
    expect(chunks.map((c) => c.length)).toEqual([1, 1, 1]);
    expect(chunks.flat()).toHaveLength(3); // nothing dropped
  });

  it('returns no chunks for empty input', () => {
    expect(planSummaryChunks([], 1000, bySize)).toEqual([]);
  });
});

describe('summarizeChunked', () => {
  it('issues a single generate call when everything fits', async () => {
    const calls: Array<{ chunk: number; prev: string | undefined }> = [];
    const generate: SummaryGenerator = async (chunk, prev) => {
      calls.push({ chunk: chunk.length, prev });
      return { ok: true, value: 'S1' };
    };
    const summary = await summarizeChunked({ messages: [m(100), m(100)], chunkBudget: 1000, generate, estimate: bySize });
    expect(calls).toEqual([{ chunk: 2, prev: undefined }]);
    expect(summary).toBe('S1');
  });

  it('chains previousSummary across chunks and returns the final rollup', async () => {
    const seen: Array<string | undefined> = [];
    let n = 0;
    const generate: SummaryGenerator = async (_chunk, prev) => {
      seen.push(prev);
      n += 1;
      return { ok: true, value: `S${n}` };
    };
    const summary = await summarizeChunked({
      messages: [m(400), m(400), m(400), m(400)],
      chunkBudget: 1000,
      generate,
      estimate: bySize,
    });
    expect(seen).toEqual([undefined, 'S1']); // 2 chunks; second folds in S1
    expect(summary).toBe('S2');
  });

  it('throws when a chunk fails to summarize', async () => {
    const generate: SummaryGenerator = async () => ({ ok: false, error: new Error('overflow') });
    await expect(
      summarizeChunked({ messages: [m(100)], chunkBudget: 1000, generate, estimate: bySize }),
    ).rejects.toThrow('overflow');
  });
});
