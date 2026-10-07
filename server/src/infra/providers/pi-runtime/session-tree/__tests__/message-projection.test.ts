import { describe, it, expect } from 'vitest';
import type { SessionTreeEntry } from '@earendil-works/pi-agent-core';
import { projectEntriesToMessageRows } from '../message-projection.js';

function mEntry(id: string, parentId: string | null, message: unknown): SessionTreeEntry {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: '2026-06-20T00:00:00.000Z',
    message,
  } as SessionTreeEntry;
}

describe('projectEntriesToMessageRows', () => {
  it('projects a user message entry to a user row', () => {
    const rows = projectEntriesToMessageRows([mEntry('e1', null, { role: 'user', content: 'hi' })]);
    expect(rows).toEqual([
      {
        entryId: 'e1',
        timestamp: '2026-06-20T00:00:00.000Z',
        role: 'user',
        content: 'hi',
        metadata: undefined,
      },
    ]);
  });

  it('collapses assistant + trailing toolResults into one assistant row with metadata', () => {
    const assistant = mEntry('e2', 'e1', {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'hmm', thinkingSignature: 'sig' },
        { type: 'text', text: 'done' },
        { type: 'toolCall', id: 'tc1', name: 'edit', arguments: { path: 'x' } },
      ],
      usage: { input: 5, output: 7 },
    });
    const toolResult = mEntry('e3', 'e2', {
      role: 'toolResult',
      toolCallId: 'tc1',
      toolName: 'edit',
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    });

    const rows = projectEntriesToMessageRows([assistant, toolResult]);
    expect(rows).toHaveLength(1);
    expect(rows[0].entryId).toBe('e2');
    expect(rows[0].role).toBe('assistant');
    expect(rows[0].content).toBe('done');
    expect(rows[0].metadata).toMatchObject({
      thinkingBlocks: [{ text: 'hmm', signature: 'sig' }],
      toolCalls: [
        { toolUseId: 'tc1', name: 'edit', input: { path: 'x' }, output: 'ok', isError: false },
      ],
      usage: { input: 5, output: 7 },
    });
  });

  it('merges one turn of per-call assistant entries into a single row', () => {
    const rows = projectEntriesToMessageRows([
      mEntry('u1', null, { role: 'user', content: 'go' }),
      mEntry('a1', 'u1', {
        role: 'assistant',
        model: 'm',
        content: [
          { type: 'text', text: 'Reading. ' },
          { type: 'toolCall', id: 'tc1', name: 'Read', arguments: { file_path: 'a' } },
        ],
        usage: { input: 10, output: 2, cacheRead: 90, cacheWrite: 0, totalTokens: 102 },
      }),
      mEntry('r1', 'a1', {
        role: 'toolResult',
        toolCallId: 'tc1',
        toolName: 'Read',
        content: [{ type: 'text', text: 'body' }],
        isError: false,
      }),
      mEntry('a2', 'r1', {
        role: 'assistant',
        model: 'm',
        content: [{ type: 'text', text: 'Done.' }],
        usage: { input: 5, output: 3, cacheRead: 100, cacheWrite: 0, totalTokens: 108 },
      }),
      mEntry('u2', 'a2', { role: 'user', content: 'next' }),
      mEntry('a3', 'u2', { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }),
    ]);
    expect(rows.map(r => [r.role, r.entryId, r.content])).toEqual([
      ['user', 'u1', 'go'],
      // Linked to the turn's last assistant entry; text joins like the live stream.
      ['assistant', 'a2', 'Reading. Done.'],
      ['user', 'u2', 'next'],
      ['assistant', 'a3', 'ok'],
    ]);
    expect(rows[1].metadata).toMatchObject({
      toolCalls: [{ toolUseId: 'tc1', name: 'Read', output: 'body', isError: false }],
      usage: { input: 15, output: 5, cacheRead: 190, cacheWrite: 0, totalTokens: 210 },
    });
  });

  it('never merges a later assistant into a flattened (pre per-call) turn', () => {
    const rows = projectEntriesToMessageRows([
      mEntry('a1', null, {
        role: 'assistant',
        stopReason: 'toolUse',
        content: [{ type: 'toolCall', id: 'tc1', name: 'Read', arguments: {} }],
      }),
      mEntry('r1', 'a1', {
        role: 'toolResult',
        toolCallId: 'tc1',
        toolName: 'Read',
        content: [{ type: 'text', text: 'x' }],
      }),
      // A background follow-up run's assistant, no user message in between.
      mEntry('a2', 'r1', { role: 'assistant', content: [{ type: 'text', text: 'later' }] }),
    ]);
    expect(rows.map(r => r.entryId)).toEqual(['a1', 'a2']);
  });

  it('skips non-message entries (e.g. compaction)', () => {
    const compaction = {
      type: 'compaction',
      id: 'c1',
      parentId: 'e1',
      timestamp: '2026-06-20T00:00:01.000Z',
      summary: 'S',
      firstKeptEntryId: 'e1',
      tokensBefore: 1,
    } as SessionTreeEntry;
    const rows = projectEntriesToMessageRows([
      compaction,
      mEntry('e4', 'c1', { role: 'user', content: 'next' }),
    ]);
    expect(rows).toEqual([
      {
        entryId: 'e4',
        timestamp: '2026-06-20T00:00:00.000Z',
        role: 'user',
        content: 'next',
        metadata: undefined,
      },
    ]);
  });
});
