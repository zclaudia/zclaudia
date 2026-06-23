import { describe, it, expect } from 'vitest';
import type { SessionTreeEntry } from '@earendil-works/pi-agent-core';
import { projectEntriesToMessageRows } from '../message-projection.js';

function mEntry(id: string, parentId: string | null, message: unknown): SessionTreeEntry {
  return { type: 'message', id, parentId, timestamp: '2026-06-20T00:00:00.000Z', message } as SessionTreeEntry;
}

describe('projectEntriesToMessageRows', () => {
  it('projects a user message entry to a user row', () => {
    const rows = projectEntriesToMessageRows([mEntry('e1', null, { role: 'user', content: 'hi' })]);
    expect(rows).toEqual([{ entryId: 'e1', timestamp: '2026-06-20T00:00:00.000Z', role: 'user', content: 'hi', metadata: undefined }]);
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
      role: 'toolResult', toolCallId: 'tc1', toolName: 'edit',
      content: [{ type: 'text', text: 'ok' }], isError: false,
    });

    const rows = projectEntriesToMessageRows([assistant, toolResult]);
    expect(rows).toHaveLength(1);
    expect(rows[0].entryId).toBe('e2');
    expect(rows[0].role).toBe('assistant');
    expect(rows[0].content).toBe('done');
    expect(rows[0].metadata).toMatchObject({
      thinkingBlocks: [{ text: 'hmm', signature: 'sig' }],
      toolCalls: [{ toolUseId: 'tc1', name: 'edit', input: { path: 'x' }, output: 'ok', isError: false }],
      usage: { input: 5, output: 7 },
    });
  });

  it('skips non-message entries (e.g. compaction)', () => {
    const compaction = { type: 'compaction', id: 'c1', parentId: 'e1', timestamp: '2026-06-20T00:00:01.000Z', summary: 'S', firstKeptEntryId: 'e1', tokensBefore: 1 } as SessionTreeEntry;
    const rows = projectEntriesToMessageRows([compaction, mEntry('e4', 'c1', { role: 'user', content: 'next' })]);
    expect(rows).toEqual([{ entryId: 'e4', timestamp: '2026-06-20T00:00:00.000Z', role: 'user', content: 'next', metadata: undefined }]);
  });
});
