import { findContentMatches, matchesByLine } from '../contentSearch';

describe('findContentMatches', () => {
  it('returns empty array for empty query', () => {
    expect(findContentMatches('hello world', '')).toEqual([]);
  });

  it('finds single match on a line', () => {
    expect(findContentMatches('hello world', 'world')).toEqual([{ line: 1, start: 6, end: 11 }]);
  });

  it('finds multiple matches on one line', () => {
    expect(findContentMatches('foo foo foo', 'foo')).toEqual([
      { line: 1, start: 0, end: 3 },
      { line: 1, start: 4, end: 7 },
      { line: 1, start: 8, end: 11 },
    ]);
  });

  it('finds matches across multiple lines', () => {
    const content = 'line one\nline two\nline three';
    expect(findContentMatches(content, 'line')).toEqual([
      { line: 1, start: 0, end: 4 },
      { line: 2, start: 0, end: 4 },
      { line: 3, start: 0, end: 4 },
    ]);
  });

  it('is case insensitive by default', () => {
    expect(findContentMatches('Hello World', 'world')).toEqual([{ line: 1, start: 6, end: 11 }]);
  });

  it('respects case sensitive flag', () => {
    expect(findContentMatches('Hello World', 'world', true)).toEqual([]);
    expect(findContentMatches('Hello World', 'World', true)).toEqual([
      { line: 1, start: 6, end: 11 },
    ]);
  });

  it('escapes regex special characters in query', () => {
    expect(findContentMatches('foo.bar', '.bar')).toEqual([{ line: 1, start: 3, end: 7 }]);
    expect(findContentMatches('a(b)c', '(b')).toEqual([{ line: 1, start: 1, end: 3 }]);
  });

  it('handles empty lines and trailing newline', () => {
    expect(findContentMatches('first\n\nsecond', 'second')).toEqual([
      { line: 3, start: 0, end: 6 },
    ]);
  });
});

describe('matchesByLine', () => {
  it('groups matches by line number', () => {
    const matches = [
      { line: 1, start: 0, end: 3 },
      { line: 1, start: 5, end: 8 },
      { line: 3, start: 1, end: 4 },
    ];
    const map = matchesByLine(matches);
    expect(map.get(1)).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 8 },
    ]);
    expect(map.get(3)).toEqual([{ start: 1, end: 4 }]);
    expect(map.get(2)).toBeUndefined();
  });
});
