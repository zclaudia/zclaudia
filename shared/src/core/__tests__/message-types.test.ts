import { describe, it, expect } from 'vitest';
import type { ContentBlock, MessageMetadata, ThinkingBlock } from '../message.js';

describe('ContentBlock', () => {
  it('accepts a thinking block with text and optional signature', () => {
    const block: ContentBlock = { type: 'thinking', content: 'reasoning text', signature: 'sig' };
    expect(block.type).toBe('thinking');
  });

  it('accepts a thinking block without signature', () => {
    const block: ContentBlock = { type: 'thinking', content: 'just reasoning' };
    expect(block.type).toBe('thinking');
  });
});

describe('MessageMetadata', () => {
  it('accepts thinkingBlocks array', () => {
    const meta: MessageMetadata = {
      thinkingBlocks: [{ text: 'a', signature: 's1' }, { text: 'b' }],
    };
    expect(meta.thinkingBlocks).toHaveLength(2);
  });
});

describe('ThinkingBlock', () => {
  it('has text and optional signature/redacted', () => {
    const b: ThinkingBlock = { text: 'hello', signature: 'sig', redacted: false };
    expect(b.text).toBe('hello');
  });
});
