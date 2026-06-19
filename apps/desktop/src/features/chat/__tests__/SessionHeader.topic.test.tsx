import { describe, it, expect } from 'vitest';
import { resolveTopicChip } from '../sessionTopicChip';

describe('resolveTopicChip', () => {
  it('prefers the AI autoTitle when present', () => {
    expect(resolveTopicChip('AI Title', 'first message')).toBe('AI Title');
  });
  it('falls back to the first user message when no autoTitle', () => {
    expect(resolveTopicChip(undefined, 'first message')).toBe('first message');
  });
  it('treats a blank autoTitle as absent', () => {
    expect(resolveTopicChip('   ', 'first message')).toBe('first message');
  });
  it('returns null when neither is available', () => {
    expect(resolveTopicChip(undefined, null)).toBeNull();
  });
});
