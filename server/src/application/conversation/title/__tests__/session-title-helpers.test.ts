import { describe, it, expect } from 'vitest';
import {
  TITLE_REGEN_THRESHOLD,
  shouldRegenerateTitle,
  pickTitleWindow,
  extractTitle,
} from '../session-title-helpers.js';

describe('shouldRegenerateTitle', () => {
  it('generates on the first user message', () => {
    expect(shouldRegenerateTitle({ autoTitle: undefined, autoTitleMsgCount: undefined, userMsgCount: 1 })).toBe(true);
  });
  it('does not generate again until the threshold delta is reached', () => {
    expect(shouldRegenerateTitle({ autoTitle: 'X', autoTitleMsgCount: 1, userMsgCount: 2 })).toBe(false);
    expect(shouldRegenerateTitle({ autoTitle: 'X', autoTitleMsgCount: 1, userMsgCount: 1 + TITLE_REGEN_THRESHOLD })).toBe(true);
  });
  it('never generates with zero user messages', () => {
    expect(shouldRegenerateTitle({ autoTitle: undefined, autoTitleMsgCount: undefined, userMsgCount: 0 })).toBe(false);
  });
});

describe('pickTitleWindow', () => {
  it('returns all messages when small', () => {
    const msgs = [{ role: 'user' }, { role: 'assistant' }] as any;
    expect(pickTitleWindow(msgs, 8)).toHaveLength(2);
  });
  it('keeps the first user message plus the recent tail when large', () => {
    const msgs = [
      { role: 'user', id: 'first' },
      ...Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', id: `m${i}` })),
    ] as any;
    const out = pickTitleWindow(msgs, 4);
    expect(out[0]).toBe(msgs[0]);       // first user message anchored
    expect(out).toHaveLength(5);        // first + last 4
    expect(out[out.length - 1]).toBe(msgs[msgs.length - 1]);
  });
});

describe('extractTitle', () => {
  it('joins text content, strips quotes, collapses whitespace, truncates to 40', () => {
    expect(extractTitle([{ type: 'text', text: '  "Hello   world"  ' }] as any)).toBe('Hello world');
    const long = 'x'.repeat(60);
    expect(extractTitle([{ type: 'text', text: long }] as any)).toHaveLength(40);
  });
  it('ignores non-text content and returns empty string when none', () => {
    expect(extractTitle([{ type: 'thinking' }] as any)).toBe('');
  });
});
