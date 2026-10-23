import { describe, expect, it } from 'vitest';
import { lineDiff } from '../diff';

const texts = (result: { lines: Array<{ type: string; text: string }> }) =>
  result.lines.map(line => `${line.type}:${line.text}`);

describe('lineDiff', () => {
  it('returns a single run of same lines for identical inputs', () => {
    const result = lineDiff('a\nb\nc', 'a\nb\nc');
    expect(result.truncated).toBe(false);
    expect(result.lines).toEqual([
      { type: 'same', aLine: 1, bLine: 1, text: 'a' },
      { type: 'same', aLine: 2, bLine: 2, text: 'b' },
      { type: 'same', aLine: 3, bLine: 3, text: 'c' },
    ]);
  });

  it('marks every line as deleted when the text disappears', () => {
    const result = lineDiff('a\nb', '');
    expect(result.truncated).toBe(false);
    expect(result.lines).toEqual([
      { type: 'del', aLine: 1, text: 'a' },
      { type: 'del', aLine: 2, text: 'b' },
    ]);
  });

  it('marks every line as added when starting from empty text', () => {
    const result = lineDiff('', 'x\ny');
    expect(result.truncated).toBe(false);
    expect(result.lines).toEqual([
      { type: 'add', bLine: 1, text: 'x' },
      { type: 'add', bLine: 2, text: 'y' },
    ]);
  });

  it('treats two empty strings as no lines at all', () => {
    const result = lineDiff('', '');
    expect(result.lines).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('does not count a trailing newline as an extra line', () => {
    expect(lineDiff('a\n', 'a').lines).toEqual([{ type: 'same', aLine: 1, bLine: 1, text: 'a' }]);
  });

  it('interleaves same/add/del lines for crossed changes', () => {
    const result = lineDiff('a\nb\nc\nd', 'a\nx\nc\ne');
    expect(result.truncated).toBe(false);
    expect(texts(result)).toEqual([
      'same:a',
      'del:b',
      'add:x',
      'same:c',
      'del:d',
      'add:e',
    ]);
    expect(result.lines[1]).toMatchObject({ type: 'del', aLine: 2 });
    expect(result.lines[2]).toMatchObject({ type: 'add', bLine: 2 });
    expect(result.lines[3]).toMatchObject({ type: 'same', aLine: 3, bLine: 3 });
    expect(result.lines[4]).toMatchObject({ type: 'del', aLine: 4 });
    expect(result.lines[5]).toMatchObject({ type: 'add', bLine: 4 });
  });

  it('keeps line numbers aligned around an inserted block', () => {
    const result = lineDiff('a\nd', 'a\nb\nc\nd');
    expect(texts(result)).toEqual(['same:a', 'add:b', 'add:c', 'same:d']);
    expect(result.lines[3]).toMatchObject({ type: 'same', aLine: 2, bLine: 4 });
  });

  it('truncates inputs beyond the line cap and sets the flag', () => {
    const many = Array.from({ length: 6000 }, (_, i) => `line-${i}`).join('\n');
    const result = lineDiff(many, many);
    expect(result.truncated).toBe(true);
    expect(result.lines).toHaveLength(5000);
    expect(result.lines[0]).toMatchObject({ type: 'same', aLine: 1, bLine: 1 });
    expect(result.lines[4999]).toMatchObject({ type: 'same', aLine: 5000, bLine: 5000 });
  });

  it('truncates the output when a change inside the cap pushes it over', () => {
    const lines = Array.from({ length: 6000 }, (_, i) => `line-${i}`);
    const changed = [...lines.slice(0, 10), 'inserted', ...lines.slice(10)];
    const result = lineDiff(lines.join('\n'), changed.join('\n'));
    expect(result.truncated).toBe(true);
    expect(result.lines).toHaveLength(5000);
    expect(texts(result)).toContain('add:inserted');
  });

  it('honours a custom line cap', () => {
    const result = lineDiff('a\nb\nc', 'a\nb\nc', 2);
    expect(result.truncated).toBe(true);
    expect(result.lines).toHaveLength(2);
  });
});
