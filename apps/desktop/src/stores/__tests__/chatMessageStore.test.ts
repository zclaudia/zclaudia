import { describe, it, expect, beforeEach } from 'vitest';
import { useChatMessageStore } from '../chatMessageStore';
import type { MessageWithToolCalls } from '../chatMessageStore';

const msg = (
  id: string,
  role: 'user' | 'assistant',
  createdAt: number,
  content = ''
): MessageWithToolCalls => ({ id, role, content, createdAt }) as MessageWithToolCalls;

const reset = () => useChatMessageStore.setState({ messages: {}, pagination: {} });

describe('chatMessageStore', () => {
  beforeEach(reset);

  it('setMessages replaces the session list', () => {
    useChatMessageStore.getState().setMessages('s1', [msg('a', 'user', 1)]);
    expect(useChatMessageStore.getState().messages.s1).toHaveLength(1);
  });

  it('addMessage dedups by id', () => {
    useChatMessageStore.getState().addMessage('s1', msg('a', 'user', 1));
    useChatMessageStore.getState().addMessage('s1', msg('a', 'user', 1));
    expect(useChatMessageStore.getState().messages.s1).toHaveLength(1);
  });

  it('appendMessages dedups against existing ids', () => {
    useChatMessageStore.getState().setMessages('s1', [msg('a', 'user', 1)]);
    useChatMessageStore
      .getState()
      .appendMessages('s1', [msg('a', 'user', 1), msg('b', 'assistant', 2)]);
    expect(useChatMessageStore.getState().messages.s1.map(m => m.id)).toEqual(['a', 'b']);
  });

  it('appendToLastMessage appends to the last assistant message', () => {
    useChatMessageStore
      .getState()
      .setMessages('s1', [msg('a', 'user', 1), msg('b', 'assistant', 2, 'hi')]);
    useChatMessageStore.getState().appendToLastMessage('s1', ' there');
    expect(useChatMessageStore.getState().messages.s1[1].content).toBe('hi there');
  });

  it('appendToMessage targets the specified assistant instead of the latest one', () => {
    useChatMessageStore.getState().setMessages('s1', [
      { id: 'a1', sessionId: 's1', role: 'assistant', content: 'old', createdAt: 1 },
      { id: 'a2', sessionId: 's1', role: 'assistant', content: 'new', createdAt: 2 },
    ]);

    useChatMessageStore.getState().appendToMessage('s1', 'a1', ' tail');

    expect(useChatMessageStore.getState().messages.s1.map(message => message.content)).toEqual([
      'old tail',
      'new',
    ]);
  });

  it('mergeMessages merges by id and sorts by createdAt', () => {
    useChatMessageStore.getState().setMessages('s1', [msg('b', 'assistant', 2)]);
    useChatMessageStore.getState().mergeMessages('s1', [msg('a', 'user', 1)]);
    expect(useChatMessageStore.getState().messages.s1.map(m => m.id)).toEqual(['a', 'b']);
  });

  it('mergeMessages never shrinks a streaming assistant message with a stale tail snapshot', () => {
    // Live row is ahead of the last server periodic save; a bottom-refresh tail
    // snapshot carries only the earlier prefix. Merging must not truncate it.
    useChatMessageStore
      .getState()
      .setMessages('s1', [
        msg('a1', 'assistant', 1, 'Hello world, this is the full streamed reply'),
      ]);

    useChatMessageStore.getState().mergeMessages('s1', [msg('a1', 'assistant', 1, 'Hello world')]);

    expect(useChatMessageStore.getState().messages.s1[0].content).toBe(
      'Hello world, this is the full streamed reply'
    );
  });

  it('mergeMessages still grows content when the incoming snapshot is more complete', () => {
    // The lost-delta repair path: the client fell behind and the server tail is
    // longer. Merge must adopt the longer content.
    useChatMessageStore.getState().setMessages('s1', [msg('a1', 'assistant', 1, 'Hello world')]);

    useChatMessageStore
      .getState()
      .mergeMessages('s1', [msg('a1', 'assistant', 1, 'Hello world, now the complete reply')]);

    expect(useChatMessageStore.getState().messages.s1[0].content).toBe(
      'Hello world, now the complete reply'
    );
  });

  it('hydrates persisted display metadata at every message-ingestion boundary', () => {
    const persisted = {
      id: 'hydrated',
      sessionId: 's1',
      role: 'assistant' as const,
      content: 'full text',
      createdAt: 1,
      metadata: {
        contentBlocks: [{ type: 'text' as const, content: 'full text' }],
        toolCalls: [{ toolUseId: 't1', name: 'Read', input: { path: 'a' }, output: 'ok' }],
      },
    };
    const operations = [
      () => useChatMessageStore.getState().setMessages('s1', [persisted]),
      () => useChatMessageStore.getState().prependMessages('s1', [persisted]),
      () => useChatMessageStore.getState().appendMessages('s1', [persisted]),
      () => useChatMessageStore.getState().mergeMessages('s1', [persisted]),
      () => useChatMessageStore.getState().addMessage('s1', persisted),
    ];

    for (const ingest of operations) {
      reset();
      ingest();
      const hydrated = useChatMessageStore.getState().messages.s1[0];
      expect(hydrated.contentBlocks).toEqual([{ type: 'text', content: 'full text' }]);
      expect(hydrated.toolCalls).toEqual([
        expect.objectContaining({
          id: 't1',
          toolName: 'Read',
          status: 'completed',
          result: 'ok',
        }),
      ]);
    }
  });

  it('clearMessages resets list and pagination', () => {
    useChatMessageStore
      .getState()
      .setMessages('s1', [msg('a', 'user', 1)], { total: 1, hasMore: true });
    useChatMessageStore.getState().clearMessages('s1');
    expect(useChatMessageStore.getState().messages.s1).toEqual([]);
    expect(useChatMessageStore.getState().pagination.s1.hasMore).toBe(false);
  });
});

// A slow runtime launch (Claude spawns a CLI) lets a session-sync fetch return
// the persisted user row before run_started renames the optimistic copy.
describe('optimistic user message vs. its persisted row', () => {
  beforeEach(reset);

  const optimistic = (clientId: string, content: string, createdAt = 10) =>
    ({
      id: clientId,
      clientMessageId: clientId,
      sessionId: 's1',
      role: 'user',
      content,
      createdAt,
    }) as MessageWithToolCalls;

  const persisted = (id: string, content: string, offset: number, createdAt = 11) =>
    ({ id, sessionId: 's1', role: 'user', content, createdAt, offset }) as MessageWithToolCalls;

  const ids = () => useChatMessageStore.getState().messages.s1.map(m => m.id);

  it('run_started does not rename into an id the sync already added', () => {
    const store = useChatMessageStore.getState();
    store.setMessages('s1', [msg('u0', 'user', 1), msg('a0', 'assistant', 2)]);
    store.addMessage('s1', optimistic('client-1', 'Run it'));
    // Not content-matched (e.g. attachment-only text differs), so both coexist.
    store.mergeMessages('s1', [persisted('srv-1', '', 3)]);

    useChatMessageStore.getState().updateMessageIdByClientMessageId('s1', 'client-1', 'srv-1');

    expect(ids()).toEqual(['u0', 'a0', 'srv-1']);
    const row = useChatMessageStore.getState().messages.s1[2];
    expect(row.clientMessageId).toBe('client-1');
  });

  it('a merged server row adopts the matching unacked optimistic message', () => {
    const store = useChatMessageStore.getState();
    store.setMessages('s1', [msg('u0', 'user', 1), msg('a0', 'assistant', 2)]);
    store.addMessage('s1', optimistic('client-1', 'Run it'));

    store.mergeMessages('s1', [persisted('srv-1', 'Run it', 3)]);

    expect(ids()).toEqual(['u0', 'a0', 'srv-1']);
    const row = useChatMessageStore.getState().messages.s1[2];
    expect(row).toMatchObject({ offset: 3, clientMessageId: 'client-1' });

    // The late run_started is then a no-op rather than a duplicate.
    useChatMessageStore.getState().updateMessageIdByClientMessageId('s1', 'client-1', 'srv-1');
    expect(ids()).toEqual(['u0', 'a0', 'srv-1']);
  });

  it('an appended server row adopts the matching optimistic message too', () => {
    const store = useChatMessageStore.getState();
    store.setMessages('s1', [msg('u0', 'user', 1)]);
    store.addMessage('s1', optimistic('client-1', 'Run it'));

    store.appendMessages('s1', [persisted('srv-1', 'Run it', 2)]);

    expect(ids()).toEqual(['u0', 'srv-1']);
  });

  it('pairs repeated identical prompts one-to-one, oldest first', () => {
    const store = useChatMessageStore.getState();
    store.addMessage('s1', optimistic('client-1', 'again', 10));
    store.addMessage('s1', optimistic('client-2', 'again', 20));

    store.mergeMessages('s1', [persisted('srv-1', 'again', 1, 11)]);

    expect(ids()).toEqual(['srv-1', 'client-2']);
    expect(useChatMessageStore.getState().messages.s1[0].clientMessageId).toBe('client-1');
  });

  it('leaves acknowledged messages and other roles alone', () => {
    const store = useChatMessageStore.getState();
    store.addMessage('s1', optimistic('client-1', 'Run it'));
    store.updateMessageIdByClientMessageId('s1', 'client-1', 'srv-1');
    store.mergeMessages('s1', [
      { ...persisted('srv-2', 'Run it', 2, 12) },
      { ...persisted('srv-3', 'Run it', 3, 13), role: 'assistant' } as MessageWithToolCalls,
    ]);
    expect(ids()).toEqual(['srv-1', 'srv-2', 'srv-3']);
  });
});

// Server rows carry a per-session offset; createdAt mixes the client's clock
// (optimistic and placeholder messages) with the backend's, which can be skewed
// on a remote host.
describe('ordering without trusting createdAt across clocks', () => {
  beforeEach(reset);

  const row = (id: string, role: 'user' | 'assistant', offset: number, createdAt: number) =>
    ({ id, sessionId: 's1', role, content: id, createdAt, offset }) as MessageWithToolCalls;

  const ids = () => useChatMessageStore.getState().messages.s1.map(m => m.id);

  it('places merged rows by offset even when the client clock lags', () => {
    const store = useChatMessageStore.getState();
    // Client ~1h behind the backend: its placeholder looks older than every row.
    store.setMessages('s1', [
      row('u1', 'user', 1, 3_600_000),
      row('a1', 'assistant', 2, 3_600_100),
    ]);
    // A run started from another device: this client only gets the placeholder.
    store.addMessage('s1', {
      id: 'a2',
      sessionId: 's1',
      role: 'assistant',
      content: '',
      createdAt: 1_000,
    } as MessageWithToolCalls);

    // Its user row lands, then a gap fetch fills a missed row before it.
    store.mergeMessages('s1', [row('u2', 'user', 4, 3_600_300)]);
    store.mergeMessages('s1', [row('t3', 'assistant', 3, 3_600_200)]);

    expect(ids()).toEqual(['u1', 'a1', 't3', 'u2', 'a2']);
  });

  it('appends a missed row ahead of the placeholder for the run in flight', () => {
    const store = useChatMessageStore.getState();
    store.setMessages('s1', [row('u1', 'user', 1, 1_000), row('a1', 'assistant', 2, 1_100)]);
    store.addMessage('s1', {
      id: 'a2',
      sessionId: 's1',
      role: 'assistant',
      content: '',
      createdAt: 1_300,
    } as MessageWithToolCalls);
    store.appendMessages('s1', [row('u2', 'user', 3, 1_200), row('u2', 'user', 3, 1_200)]);
    expect(ids()).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('never moves messages that are already in the list', () => {
    const store = useChatMessageStore.getState();
    store.setMessages('s1', [row('u1', 'user', 1, 5_000), row('a1', 'assistant', 2, 1_000)]);
    store.mergeMessages('s1', [{ ...row('a1', 'assistant', 2, 1_000), content: 'grown' }]);
    expect(ids()).toEqual(['u1', 'a1']);
  });

  it('keeps a placeholder in place when its persisted row merges in', () => {
    const store = useChatMessageStore.getState();
    store.setMessages('s1', [row('u1', 'user', 1, 1_000)]);
    store.addMessage('s1', {
      id: 'a1',
      sessionId: 's1',
      role: 'assistant',
      content: '',
      createdAt: 9_999_999,
    } as MessageWithToolCalls);
    store.mergeMessages('s1', [row('u2', 'user', 3, 1_300), row('a1', 'assistant', 2, 1_100)]);
    expect(ids()).toEqual(['u1', 'a1', 'u2']);
    expect(useChatMessageStore.getState().messages.s1[1].offset).toBe(2);
  });
});

describe('prependMessages', () => {
  beforeEach(reset);

  it('skips messages that are already loaded or repeated in the page', () => {
    const store = useChatMessageStore.getState();
    store.setMessages('s1', [msg('c', 'user', 3), msg('d', 'assistant', 4)]);
    store.prependMessages('s1', [
      msg('a', 'user', 1),
      msg('b', 'assistant', 2),
      msg('b', 'assistant', 2),
      msg('c', 'user', 3),
    ]);
    expect(useChatMessageStore.getState().messages.s1.map(m => m.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
