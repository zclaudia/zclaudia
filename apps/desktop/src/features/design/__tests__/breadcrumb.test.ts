import { describe, expect, it } from 'vitest';
import { ancestorsOf } from '../inspector/breadcrumb';

const SOURCE = '<body><main class="hero"><h1 id="t" class="a b">x</h1></main></body>';

describe('ancestorsOf', () => {
  it('returns the body-to-element chain with tag, id and the first class only', () => {
    expect(ancestorsOf(SOURCE, [0, 0])).toEqual([
      { path: [], label: 'body' },
      { path: [0], label: 'main.hero' },
      { path: [0, 0], label: 'h1#t.a' },
    ]);
  });

  it('returns an empty list for an empty path', () => {
    expect(ancestorsOf(SOURCE, [])).toEqual([]);
  });

  it('returns an empty list when a numeric path does not resolve', () => {
    expect(ancestorsOf(SOURCE, [5])).toEqual([]);
    expect(ancestorsOf(SOURCE, [0, 0, 0])).toEqual([]);
    expect(ancestorsOf(SOURCE, [-1])).toEqual([]);
  });

  it('labels elements without id or class by tag name only', () => {
    const source = '<body><div><p>text</p></div></body>';
    expect(ancestorsOf(source, [0, 0])).toEqual([
      { path: [], label: 'body' },
      { path: [0], label: 'div' },
      { path: [0, 0], label: 'p' },
    ]);
  });

  it('does not throw on malformed source', () => {
    expect(() => ancestorsOf('<body><main class="hero><h1', [0])).not.toThrow();
    expect(ancestorsOf('<p>no explicit body', [0, 0])).toEqual([]);
  });
});
