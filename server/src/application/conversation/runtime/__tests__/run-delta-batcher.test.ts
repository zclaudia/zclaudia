import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeltaMessage, ServerMessage } from '@zclaudia/shared/wire/messages';
import { createRunDeltaBatcher } from '../run-delta-batcher.js';

const delta = (content: string, runId = 'run-1', sessionId = 'session-1'): DeltaMessage => ({
  type: 'delta',
  runId,
  sessionId,
  content,
});

describe('createRunDeltaBatcher', () => {
  afterEach(() => vi.useRealTimers());

  it('coalesces text before sequence assignment into one legacy-compatible event', () => {
    vi.useFakeTimers();
    const sent: ServerMessage[] = [];
    let eventSeq = 0;
    const batcher = createRunDeltaBatcher(
      message => {
        if ('runId' in message) (message as ServerMessage & { seq?: number }).seq = ++eventSeq;
        sent.push(message);
      },
      { maxDelayMs: 40 }
    );

    batcher.send(delta('hel'));
    batcher.send(delta('lo'));
    expect(sent).toEqual([]);
    expect(eventSeq).toBe(0);

    vi.advanceTimersByTime(40);

    expect(sent).toEqual([{ ...delta('hello'), seq: 1 }]);
    expect((sent[0] as DeltaMessage).seq).toBe(1);
    expect('seqStart' in sent[0]).toBe(false);
  });

  it('flushes before a non-delta event and keeps the wire sequence continuous', () => {
    vi.useFakeTimers();
    const sent: ServerMessage[] = [];
    let eventSeq = 0;
    const batcher = createRunDeltaBatcher(
      message => {
        if ('runId' in message) (message as ServerMessage & { seq?: number }).seq = ++eventSeq;
        sent.push(message);
      },
      { maxDelayMs: 100 }
    );

    batcher.send(delta('before '));
    batcher.send({ type: 'tool_activity', runId: 'run-1', toolUseId: 'tool-1', activity: 'read' });
    batcher.send(delta('after'));
    batcher.flush();

    expect(sent).toEqual([
      { ...delta('before '), seq: 1 },
      { type: 'tool_activity', runId: 'run-1', toolUseId: 'tool-1', activity: 'read', seq: 2 },
      { ...delta('after'), seq: 3 },
    ]);
  });

  it('flushes on content bounds and isolates independent runs', () => {
    vi.useFakeTimers();
    const sent: ServerMessage[] = [];
    const batcher = createRunDeltaBatcher(message => sent.push(message), {
      maxDelayMs: 100,
      maxContentChars: 4,
    });

    batcher.send(delta('abc'));
    batcher.send(delta('de'));
    batcher.send(delta('x', 'run-2'));
    expect(sent).toEqual([delta('abc'), delta('de')]);
    batcher.flush();

    expect(sent).toEqual([delta('abc'), delta('de'), delta('x', 'run-2')]);
    batcher.flush();
    expect(sent).toHaveLength(3);
  });

  it('sends a single oversized provider chunk immediately', () => {
    vi.useFakeTimers();
    const sent: ServerMessage[] = [];
    const batcher = createRunDeltaBatcher(message => sent.push(message), {
      maxDelayMs: 100,
      maxContentChars: 4,
    });

    batcher.send(delta('oversized'));

    expect(sent).toEqual([delta('oversized')]);
  });

  it('keeps per-run buffers independent and advances the heartbeat watermark only on flush', () => {
    vi.useFakeTimers();
    let eventSeqA = 0;
    let eventSeqB = 0;
    const sentA: ServerMessage[] = [];
    const sentB: ServerMessage[] = [];
    const runA = createRunDeltaBatcher(
      message => {
        if ('runId' in message) (message as ServerMessage & { seq?: number }).seq = ++eventSeqA;
        sentA.push(message);
      },
      { maxDelayMs: 100 }
    );
    const runB = createRunDeltaBatcher(
      message => {
        if ('runId' in message) (message as ServerMessage & { seq?: number }).seq = ++eventSeqB;
        sentB.push(message);
      },
      { maxDelayMs: 100 }
    );

    runA.send(delta('A1'));
    runA.send(delta('A2'));
    runB.send(delta('B1', 'run-2', 'session-2'));
    expect(eventSeqA).toBe(0);
    expect(eventSeqB).toBe(0);

    runA.flush();
    expect(eventSeqA).toBe(1);
    expect(eventSeqB).toBe(0);
    expect(sentA).toEqual([{ ...delta('A1A2'), seq: 1 }]);
    expect(sentB).toEqual([]);

    runB.flush();
    expect(sentB).toEqual([{ ...delta('B1', 'run-2', 'session-2'), seq: 1 }]);
  });
});
