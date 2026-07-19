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

  it('clearMessages resets list and pagination', () => {
    useChatMessageStore
      .getState()
      .setMessages('s1', [msg('a', 'user', 1)], { total: 1, hasMore: true });
    useChatMessageStore.getState().clearMessages('s1');
    expect(useChatMessageStore.getState().messages.s1).toEqual([]);
    expect(useChatMessageStore.getState().pagination.s1.hasMore).toBe(false);
  });
});
