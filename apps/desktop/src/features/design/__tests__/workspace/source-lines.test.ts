import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { elementLineRange } from '../../workspace/source-lines';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const loadFixture = (name: string): string => readFileSync(join(fixtureDir, name), 'utf8');

describe('elementLineRange', () => {
  it('locates single-line elements with 1-based line numbers', () => {
    const source = '<html><body>\n  <h1>Title</h1>\n  <p>Text</p>\n</body></html>';
    expect(elementLineRange(source, [0], 'h1')).toEqual({ startLine: 2, endLine: 2 });
    expect(elementLineRange(source, [1], 'p')).toEqual({ startLine: 3, endLine: 3 });
  });

  it('compares tag names case-insensitively and rejects mismatched ones', () => {
    const source = '<html><body>\n  <h1>Title</h1>\n</body></html>';
    expect(elementLineRange(source, [0], 'H1')).toEqual({ startLine: 2, endLine: 2 });
    expect(elementLineRange(source, [0], 'span')).toBeNull();
  });

  it('offsets startLine by preceding newlines and extends endLine across a multi-line element', () => {
    const source = [
      '<html><body>',
      '  <div>',
      '    <p>a</p>',
      '    <p>b</p>',
      '  </div>',
      '</body></html>',
    ].join('\n');
    expect(elementLineRange(source, [0], 'div')).toEqual({ startLine: 2, endLine: 5 });
    expect(elementLineRange(source, [0, 0], 'p')).toEqual({ startLine: 3, endLine: 3 });
    expect(elementLineRange(source, [0, 1], 'p')).toEqual({ startLine: 4, endLine: 4 });
  });

  it('rejects a sourceText that does not match the element even among duplicate siblings', () => {
    const source = loadFixture('duplicates.html');
    // All three <p> siblings carry the same text; the path disambiguates the element.
    expect(elementLineRange(source, [0, 1], 'p', 'dup')).toEqual({ startLine: 7, endLine: 7 });
    expect(elementLineRange(source, [0, 1], 'p', 'nope')).toBeNull();
    expect(elementLineRange(source, [0, 2], 'p', 'dup')).toEqual({ startLine: 8, endLine: 8 });
  });

  it('trims both sides of the sourceText comparison', () => {
    const source = '<html><body><p>  spaced  </p></body></html>';
    expect(elementLineRange(source, [0], 'p', 'spaced')).toEqual({ startLine: 1, endLine: 1 });
  });

  it('returns null for paths that leave the tree', () => {
    const source = '<html><body><p>x</p></body></html>';
    expect(elementLineRange(source, [9], 'p')).toBeNull();
    expect(elementLineRange(source, [0, 0], 'p')).toBeNull();
  });

  it('returns null for implicit nodes without a source location', () => {
    const source = loadFixture('implicit.html');
    // <tbody> is inserted implicitly by the parser.
    expect(elementLineRange(source, [0, 0], 'tbody')).toBeNull();
    // The body itself is implicit: the fixture has no <body> tag.
    expect(elementLineRange(source, [], 'body')).toBeNull();
    // Explicit elements in the same document still resolve
    // (table → tbody → tr → td: parse5 inserts tbody and tr implicitly but td keeps its location).
    expect(elementLineRange(source, [0, 0, 0, 0], 'td')).toEqual({ startLine: 6, endLine: 6 });
    expect(elementLineRange(source, [1], 'p')).toEqual({ startLine: 9, endLine: 9 });
  });

  it('resolves elements inside real fixtures with entities and comments', () => {
    const source = loadFixture('basic.html');
    expect(elementLineRange(source, [0, 0], 'h1', 'Café & Co — brew & books')).toEqual({
      startLine: 11,
      endLine: 11,
    });
    expect(elementLineRange(source, [2], 'footer')).toEqual({ startLine: 24, endLine: 24 });
  });
});
