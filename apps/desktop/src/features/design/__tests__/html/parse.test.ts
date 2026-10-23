import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  attributeSpan,
  attrValue,
  childElements,
  elementSpan,
  findBody,
  findElement,
  newAttributeInsertOffset,
  parseDocument,
  startTagInsertOffset,
  startTagSpan,
  textChildSpan,
} from '../../html/parse';
import { sha256Hex, sha256HexSync } from '../../html/hash';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const loadFixture = (name: string): string => readFileSync(join(fixtureDir, name), 'utf8');

describe('parseDocument', () => {
  it('collects parse errors with codes and offsets', () => {
    const { errors } = parseDocument(loadFixture('malformed.html'));
    const duplicates = errors.filter(error => error.code === 'duplicate-attribute');
    expect(duplicates).toHaveLength(2);
    for (const error of duplicates) {
      expect(error.startOffset).toBeGreaterThan(0);
      // parse5 reports duplicate-attribute errors as zero-width locations.
      expect(error.endOffset).toBeGreaterThanOrEqual(error.startOffset);
    }
  });

  it('reports no errors for well-formed fixtures', () => {
    for (const name of ['basic.html', 'duplicates.html', 'implicit.html', 'cascade.html']) {
      expect(parseDocument(loadFixture(name)).errors).toEqual([]);
    }
  });
});

describe('findElement / childElements', () => {
  it('walks element children from the body, skipping comments and text', () => {
    const source = loadFixture('basic.html');
    const parsed = parseDocument(source);
    const header = findElement(parsed.document, [0]);
    expect(header?.tagName).toBe('header');
    const h1 = findElement(parsed.document, [0, 0]);
    expect(h1?.tagName).toBe('h1');
    // body[0] is header even though a comment precedes it inside <body>
    expect(childElements(parsed.body!).map(el => el.tagName)).toEqual(['header', 'main', 'footer']);
  });

  it('returns null for paths that leave the tree', () => {
    const parsed = parseDocument(loadFixture('basic.html'));
    expect(findElement(parsed.document, [9])).toBeNull();
    expect(findElement(parsed.document, [0, 0, 0, 0])).toBeNull();
    expect(findElement(parsed.document, [-1])).toBeNull();
  });
});

describe('span helpers', () => {
  it('expose exact byte spans on basic.html', () => {
    const source = loadFixture('basic.html');
    const parsed = parseDocument(source);
    const h1 = findElement(parsed.document, [0, 0])!;

    const tagSpan = startTagSpan(h1)!;
    expect(source.slice(tagSpan.start, tagSpan.end)).toBe('<h1 id="title">');

    const elementSpanValue = elementSpan(h1)!;
    expect(source.slice(elementSpanValue.start, elementSpanValue.end)).toBe(
      '<h1 id="title">Café &amp; Co — brew &amp; books</h1>'
    );

    const attrSpan = attributeSpan(h1, 'id')!;
    expect(source.slice(attrSpan.start, attrSpan.end)).toBe('id="title"');
    expect(attrValue(h1, 'id')).toBe('title');

    const textSpan = textChildSpan(h1)!;
    // Entities cover their raw byte range: the slice contains &amp;, the decoded value does not.
    expect(source.slice(textSpan.start, textSpan.end)).toBe('Café &amp; Co — brew &amp; books');
    expect(h1.childNodes[0]!.nodeName).toBe('#text');
    expect((h1.childNodes[0] as { value: string }).value).toBe('Café & Co — brew & books');
  });

  it('keep whitespace text spans verbatim', () => {
    const source = loadFixture('basic.html');
    const parsed = parseDocument(source);
    const p = findElement(parsed.document, [2, 0])!;
    const span = textChildSpan(p)!;
    expect(source.slice(span.start, span.end)).toBe('  spaced  text  ');
  });

  it('return null spans for implicit nodes', () => {
    const parsed = parseDocument(loadFixture('implicit.html'));
    const tbody = findElement(parsed.document, [0, 0])!;
    expect(tbody.tagName).toBe('tbody');
    expect(tbody.sourceCodeLocation).toBeNull();
    expect(startTagSpan(tbody)).toBeNull();
    expect(elementSpan(tbody)).toBeNull();
    expect(attributeSpan(tbody, 'x')).toBeNull();
    expect(findBody(parsed.document)?.sourceCodeLocation).toBeNull();
  });

  it('locate insertion offsets before > and before self-closing /', () => {
    const plain = '<main><hr></main>';
    const hr = findElement(parseDocument(plain).document, [0, 0])!;
    const plainAt = startTagInsertOffset(plain, hr)!;
    expect(plain.slice(plainAt)).toBe('></main>');

    const selfClosing = '<main><hr/></main>';
    const hrSelf = findElement(parseDocument(selfClosing).document, [0, 0])!;
    const selfAt = startTagInsertOffset(selfClosing, hrSelf)!;
    expect(selfClosing.slice(selfAt)).toBe('/></main>');

    const withAttrs = '<main><img src="a.png" alt="x"></main>';
    const img = findElement(parseDocument(withAttrs).document, [0, 0])!;
    const attrAt = newAttributeInsertOffset(withAttrs, img)!;
    expect(withAttrs.slice(attrAt)).toBe('></main>');
  });

  it('hash a full fixture document stably', async () => {
    const source = loadFixture('basic.html');
    expect(await sha256Hex(source)).toBe(sha256HexSync(source));
  });
});
