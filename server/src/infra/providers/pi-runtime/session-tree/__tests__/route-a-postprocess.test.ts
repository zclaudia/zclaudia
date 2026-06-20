import { describe, it, expect } from 'vitest';
import type { Message } from '@earendil-works/pi-ai';
import { trimMessagesToBudget, estimateMessageTokens } from '../route-a-postprocess.js';

const userMsg = (content: string): Message => ({ role: 'user', content } as Message);

describe('trimMessagesToBudget', () => {
  it('keeps the newest message even when over budget', () => {
    const msgs = [userMsg('a'.repeat(4000)), userMsg('b'.repeat(4000)), userMsg('c'.repeat(4000))];
    const out = trimMessagesToBudget(msgs, 10); // tiny budget
    expect(out[out.length - 1]).toBe(msgs[msgs.length - 1]);
    expect(out.length).toBeLessThan(msgs.length);
  });

  it('returns all messages when budget is ample', () => {
    const msgs = [userMsg('a'), userMsg('b')];
    expect(trimMessagesToBudget(msgs, 1_000_000)).toEqual(msgs);
  });

  it('does not start the kept slice on an orphaned toolResult', () => {
    const msgs = [
      userMsg('x'.repeat(8000)),
      { role: 'assistant', content: [{ type: 'text', text: 'call' }] } as Message,
      { role: 'toolResult', toolCallId: 't1', toolName: 'edit', content: [{ type: 'text', text: 'r' }] } as unknown as Message,
      userMsg('newest'),
    ];
    // Budget small enough to want to cut into the middle; ensure result doesn't lead with toolResult.
    const out = trimMessagesToBudget(msgs, 5);
    expect((out[0] as { role: string }).role).not.toBe('toolResult');
  });

  it('estimateMessageTokens counts string and block content', () => {
    expect(estimateMessageTokens(userMsg('hello world'))).toBeGreaterThan(0);
    const blockMsg = { role: 'assistant', content: [{ type: 'text', text: 'hi' }, { type: 'image' }] } as unknown as Message;
    expect(estimateMessageTokens(blockMsg)).toBeGreaterThan(1000); // image adds a flat estimate
  });
});
