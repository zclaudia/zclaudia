import { describe, it, expect } from 'vitest';
import { normalizeQuotes, findActualString, countOccurrences, applyEdit, findWhitespaceMatch } from '../edit-match.js';

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

describe('findWhitespaceMatch', () => {
  it('matches across a trailing-whitespace difference (Pass 1)', () => {
    const file = 'const a = 1;   \nconst b = 2;\n';
    const res = findWhitespaceMatch(file, 'const a = 1;', 'const a = 99;');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(file.slice(res.match.start, res.match.end)).toBe('const a = 1;');
    expect(res.match.adjustedNewString).toBe('const a = 99;');
  });

  it('matches a CRLF file with an LF search and preserves byte offsets', () => {
    const file = 'line one\r\nline two\r\nline three\r\n';
    const res = findWhitespaceMatch(file, 'line two', 'LINE TWO');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(file.slice(res.match.start, res.match.end)).toBe('line two');
    const spliced = file.slice(0, res.match.start) + res.match.adjustedNewString + file.slice(res.match.end);
    expect(spliced).toBe('line one\r\nLINE TWO\r\nline three\r\n');
  });

  it('matches under an indentation shift and re-indents the replacement (Pass 2)', () => {
    const file = 'function f() {\n    const a = 1;\n    const b = 2;\n}\n';
    const search = '  const a = 1;\n  const b = 2;';
    const replacement = '  const a = 1;\n  const c = 3;';
    const res = findWhitespaceMatch(file, search, replacement);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(file.slice(res.match.start, res.match.end)).toBe('    const a = 1;\n    const b = 2;');
    expect(res.match.adjustedNewString).toBe('    const a = 1;\n    const c = 3;');
  });

  it('returns ambiguous when the normalized block matches more than one location', () => {
    const file = 'x = 1;\ny = 2;\nx = 1;\n';
    const res = findWhitespaceMatch(file, 'x = 1; ', 'x = 9;');
    expect(res).toMatchObject({ ok: false, reason: 'ambiguous', count: 2 });
  });

  it('does not match when indentation uses different whitespace kinds (tabs vs spaces)', () => {
    const file = 'function f() {\n\tconst a = 1;\n}\n';
    const res = findWhitespaceMatch(file, '  const a = 1;', '  const a = 2;');
    expect(res).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('returns not_found when nothing matches', () => {
    const res = findWhitespaceMatch('abc\n', 'xyz', 'q');
    expect(res).toMatchObject({ ok: false, reason: 'not_found' });
  });
});
