import { describe, it, expect } from 'vitest';
import { normalizeQuotes, findActualString, countOccurrences, applyEdit } from '../edit-match.js';

describe('edit-match', () => {
  it('normalizeQuotes maps curly quotes to straight', () => {
    expect(normalizeQuotes('“hi” ‘x’')).toBe('"hi" \'x\'');
  });

  it('findActualString returns exact match', () => {
    expect(findActualString('abc def', 'def')).toBe('def');
  });

  it('findActualString falls back through quote normalization, returning the real file substring', () => {
    const file = 'say “hello” now';
    expect(findActualString(file, 'say “hello” now')).toBe('say “hello” now');
  });

  it('findActualString returns null when absent', () => {
    expect(findActualString('abc', 'zzz')).toBeNull();
  });

  it('countOccurrences counts non-overlapping hits', () => {
    expect(countOccurrences('aaaa', 'aa')).toBe(2);
    expect(countOccurrences('abc', 'x')).toBe(0);
  });

  it('applyEdit replaces first occurrence by default', () => {
    expect(applyEdit('a x a', 'a', 'b', false)).toBe('b x a');
  });

  it('applyEdit replaces all when replaceAll is true', () => {
    expect(applyEdit('a x a', 'a', 'b', true)).toBe('b x b');
  });

  it('applyEdit treats $ in replacement literally', () => {
    expect(applyEdit('a', 'a', '$1 cost', false)).toBe('$1 cost');
  });
});
