import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { attributeSpan, findElement, newAttributeInsertOffset, parseDocument, textChildSpan } from '../../html/parse';
import { applyEditTransaction } from '../../html/edit-engine';
import { sha256HexSync } from '../../html/hash';
import type { DesignEditErrorCode, DesignEditTransaction, DesignSelection } from '../../types';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const load = (name: string): string => readFileSync(join(fixtureDir, name), 'utf8');

const sha = (source: string): string => sha256HexSync(source);

const H1_TEXT = 'Café & Co — brew & books';
const H1_RAW = 'Café &amp; Co — brew &amp; books';

const h1Locator = (sourceText: string = H1_TEXT): DesignSelection => ({
  elementPath: [0, 0],
  tagName: 'h1',
  text: sourceText,
  sourceText,
});

const textTxn = (source: string, locator: DesignSelection, value: string): DesignEditTransaction => ({
  baseRevision: sha(source),
  locator,
  operations: [{ kind: 'text', value }],
});

const styleTxn = (
  source: string,
  locator: DesignSelection,
  property: 'color' | 'background-color',
  value: string | null
): DesignEditTransaction => ({
  baseRevision: sha(source),
  locator,
  operations: [{ kind: 'style', property, value }],
});

async function expectErrorCode(run: () => Promise<unknown>, code: DesignEditErrorCode): Promise<void> {
  try {
    await run();
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
    expect((error as { name?: string }).name).toBe('DesignEditError');
    return;
  }
  throw new Error(`Expected DesignEditError ${code}, but the transaction succeeded`);
}

describe('applyEditTransaction — text edits', () => {
  it('rewrites exactly the h1 text bytes of basic.html and escapes the new text', async () => {
    const before = load('basic.html');
    const value = 'Tea & Co <now> & more';
    const result = await applyEditTransaction(before, textTxn(before, h1Locator(), value));

    const start = before.indexOf(H1_RAW);
    const end = start + H1_RAW.length;
    // Byte-for-byte: everything outside the h1 text node is untouched.
    expect(result.source).toBe(`${before.slice(0, start)}Tea &amp; Co &lt;now&gt; &amp; more${before.slice(end)}`);

    expect(result.revision).toBe(sha(result.source));
    expect(result.selection).toEqual({
      elementPath: [0, 0],
      tagName: 'h1',
      text: value,
      sourceText: value,
      base: result.revision,
    });
  });

  it('keeps comments, entities and unquoted attributes byte-for-byte', async () => {
    const before = load('basic.html');
    const result = await applyEditTransaction(before, textTxn(before, h1Locator(), 'Hello'));
    expect(result.source).toContain('<!-- hero comment: must survive edits byte-for-byte -->');
    expect(result.source).toContain('<section id=menu>');
    expect(result.source).toContain('<h2 style=color:#333>');
    expect(result.source).toContain('<title>Café &amp; Co</title>');
    expect(result.source).toContain('<li>Espresso — ¥18</li>');
  });

  it('leaves unrelated bytes untouched in a CRLF variant', async () => {
    const before = load('basic.html').replaceAll('\n', '\r\n');
    const start = before.indexOf(H1_RAW);
    const end = start + H1_RAW.length;
    const result = await applyEditTransaction(before, textTxn(before, h1Locator(), 'Hello'));

    expect(result.source).toBe(`${before.slice(0, start)}Hello${before.slice(end)}`);
    expect(result.source.match(/\r\n/g)).toHaveLength(before.match(/\r\n/g)!.length);
  });

  it('rejects a stale base revision', async () => {
    const before = load('basic.html');
    await expectErrorCode(
      () =>
        applyEditTransaction(before, {
          baseRevision: 'deadbeef',
          locator: h1Locator(),
          operations: [{ kind: 'text', value: 'Hello' }],
        }),
      'REVISION_MISMATCH'
    );
  });

  it('rejects a mismatching tag name at the path', async () => {
    const before = load('basic.html');
    await expectErrorCode(
      () =>
        applyEditTransaction(before, {
          baseRevision: sha(before),
          locator: { ...h1Locator(), tagName: 'h2' },
          operations: [{ kind: 'text', value: 'Hello' }],
        }),
      'TAG_MISMATCH'
    );
  });

  it('rejects a path that no longer resolves', async () => {
    const before = load('basic.html');
    await expectErrorCode(
      () =>
        applyEditTransaction(before, {
          baseRevision: sha(before),
          locator: { ...h1Locator(), elementPath: [9, 9] },
          operations: [{ kind: 'text', value: 'Hello' }],
        }),
      'ELEMENT_NOT_FOUND'
    );
  });

  it('rejects when the text fingerprint does not match', async () => {
    const before = load('basic.html');
    await expectErrorCode(
      () => applyEditTransaction(before, textTxn(before, h1Locator('Different'), 'Hello')),
      'TEXT_MISMATCH'
    );
  });

  it('rejects elements whose children are not a single text node', async () => {
    const before = load('basic.html');
    const header = { elementPath: [0], tagName: 'header', text: '', sourceText: '' };
    await expectErrorCode(
      () => applyEditTransaction(before, textTxn(before, header, 'Hello')),
      'NOT_PLAIN_TEXT'
    );

    const commentChild = '<main><div>text<!--c--></div></main>';
    await expectErrorCode(
      () =>
        applyEditTransaction(
          commentChild,
          textTxn(commentChild, { elementPath: [0, 0], tagName: 'div', text: 'text', sourceText: 'text' }, 'Hello')
        ),
      'NOT_PLAIN_TEXT'
    );
  });

  it('inserts escaped text into empty elements', async () => {
    const before = '<main><figure></figure></main>';
    const result = await applyEditTransaction(
      before,
      textTxn(before, { elementPath: [0, 0], tagName: 'figure', text: '' }, 'Hello <world>')
    );
    expect(result.source).toBe('<main><figure>Hello &lt;world&gt;</figure></main>');
    expect(result.selection.sourceText).toBe('Hello <world>');
  });

  it('allows an empty sourceText fingerprint on empty elements and rejects a non-empty one', async () => {
    const before = '<main><figure></figure></main>';
    const allowed = await applyEditTransaction(
      before,
      textTxn(before, { elementPath: [0, 0], tagName: 'figure', text: '', sourceText: '' }, 'Hi')
    );
    expect(allowed.source).toBe('<main><figure>Hi</figure></main>');

    await expectErrorCode(
      () =>
        applyEditTransaction(
          before,
          textTxn(before, { elementPath: [0, 0], tagName: 'figure', text: '', sourceText: 'old' }, 'Hi')
        ),
      'TEXT_MISMATCH'
    );
  });
});

describe('applyEditTransaction — style edits', () => {
  it('inserts a style attribute after the last attribute span', async () => {
    const before = load('basic.html');
    const locator: DesignSelection = {
      elementPath: [1, 1],
      tagName: 'img',
      text: '',
    };
    const result = await applyEditTransaction(before, styleTxn(before, locator, 'color', 'red'));

    const img = findElement(parseDocument(before).document, [1, 1])!;
    const at = newAttributeInsertOffset(before, img)!;
    expect(result.source).toBe(`${before.slice(0, at)} style="color: red"${before.slice(at)}`);
    expect(result.source).toContain('<img src="images/logo.svg" alt="logo" style="color: red">');
    expect(result.selection.color).toBe('red');
    expect(result.selection.base).toBe(result.revision);
  });

  it('inserts into start tags without attributes and self-closing tags', async () => {
    const plain = '<main><hr></main>';
    const plainResult = await applyEditTransaction(
      plain,
      styleTxn(plain, { elementPath: [0, 0], tagName: 'hr', text: '' }, 'color', 'red')
    );
    expect(plainResult.source).toBe('<main><hr style="color: red"></main>');

    const selfClosing = '<main><hr/></main>';
    const selfResult = await applyEditTransaction(
      selfClosing,
      styleTxn(selfClosing, { elementPath: [0, 0], tagName: 'hr', text: '' }, 'color', 'red')
    );
    expect(selfResult.source).toBe('<main><hr style="color: red"/></main>');
  });

  it('rewrites only the color segment of an existing style attribute, byte-preserving the rest', async () => {
    const before = load('cascade.html');
    const locator: DesignSelection = {
      elementPath: [1],
      tagName: 'p',
      text: 'multi declaration',
      sourceText: 'multi declaration',
    };
    const result = await applyEditTransaction(before, styleTxn(before, locator, 'color', 'green'));

    const p = findElement(parseDocument(before).document, [1])!;
    const attrSpan = attributeSpan(p, 'style')!;
    expect(before.slice(attrSpan.start, attrSpan.end)).toBe('style="color: blue; margin : 0"');
    expect(result.source).toBe(
      `${before.slice(0, attrSpan.start)}style="color: green; margin : 0"${before.slice(attrSpan.end)}`
    );
    expect(result.source).toContain('<p class="multi" style="color: green; margin : 0">');
    expect(result.selection.color).toBe('green');
  });

  it('sets multiple style properties in one transaction', async () => {
    const before = load('cascade.html');
    const locator: DesignSelection = {
      elementPath: [1],
      tagName: 'p',
      text: 'multi declaration',
      sourceText: 'multi declaration',
    };
    const result = await applyEditTransaction(before, {
      baseRevision: sha(before),
      locator,
      operations: [
        { kind: 'style', property: 'color', value: 'green' },
        { kind: 'style', property: 'background-color', value: 'yellow' },
      ],
    });
    expect(result.source).toBe(
      before.replace(
        'style="color: blue; margin : 0"',
        'style="color: green; margin : 0; background-color: yellow"'
      )
    );
    expect(result.selection.color).toBe('green');
    expect(result.selection.backgroundColor).toBe('yellow');
  });

  it('clears a declaration and keeps the remaining ones', async () => {
    const before = load('cascade.html');
    const locator: DesignSelection = {
      elementPath: [1],
      tagName: 'p',
      text: 'multi declaration',
      sourceText: 'multi declaration',
      color: 'blue',
    };
    const result = await applyEditTransaction(before, styleTxn(before, locator, 'color', null));
    expect(result.source).toContain('<p class="multi" style=" margin : 0">');
    expect(result.selection.color).toBeUndefined();
  });

  it('treats clearing a missing declaration as a no-op (EMPTY_TRANSACTION)', async () => {
    const before = load('cascade.html');
    const locator: DesignSelection = {
      elementPath: [1],
      tagName: 'p',
      text: 'multi declaration',
      sourceText: 'multi declaration',
    };
    await expectErrorCode(
      () => applyEditTransaction(before, styleTxn(before, locator, 'background-color', null)),
      'EMPTY_TRANSACTION'
    );

    const basic = load('basic.html');
    await expectErrorCode(
      () => applyEditTransaction(basic, styleTxn(basic, h1Locator(), 'color', null)),
      'EMPTY_TRANSACTION'
    );
  });

  it('treats setting the identical color as a no-op (EMPTY_TRANSACTION)', async () => {
    const before = load('cascade.html');
    const locator: DesignSelection = {
      elementPath: [1],
      tagName: 'p',
      text: 'multi declaration',
      sourceText: 'multi declaration',
    };
    await expectErrorCode(
      () => applyEditTransaction(before, styleTxn(before, locator, 'color', 'blue')),
      'EMPTY_TRANSACTION'
    );
  });

  it('rejects invalid color values', async () => {
    const basic = load('basic.html');
    await expectErrorCode(
      () => applyEditTransaction(basic, styleTxn(basic, h1Locator(), 'color', 'not-a-color')),
      'INVALID_VALUE'
    );
    const cascade = load('cascade.html');
    await expectErrorCode(
      () =>
        applyEditTransaction(
          cascade,
          styleTxn(
            cascade,
            {
              elementPath: [1],
              tagName: 'p',
              text: 'multi declaration',
              sourceText: 'multi declaration',
            },
            'color',
            'url(x)'
          )
        ),
      'INVALID_VALUE'
    );
  });

  it('rejects an empty operation list', async () => {
    const before = load('basic.html');
    await expectErrorCode(
      () => applyEditTransaction(before, { baseRevision: sha(before), locator: h1Locator(), operations: [] }),
      'EMPTY_TRANSACTION'
    );
  });
});

describe('applyEditTransaction — duplicate nodes', () => {
  const dupLocator = (path: number[], sourceText = 'dup'): DesignSelection => ({
    elementPath: path,
    tagName: 'p',
    text: sourceText,
    sourceText,
  });

  it('edits the second duplicate at [0,1]', async () => {
    const before = load('duplicates.html');
    const result = await applyEditTransaction(before, textTxn(before, dupLocator([0, 1]), 'changed'));

    const p = findElement(parseDocument(before).document, [0, 1])!;
    const span = textChildSpan(p)!;
    expect(result.source).toBe(`${before.slice(0, span.start)}changed${before.slice(span.end)}`);
    expect(result.source).toContain('<p class="q" id="same">changed</p>');
    // exactly one of the two id="same" paragraphs changed
    expect(result.source.match(/id="same">changed/g)).toHaveLength(1);
  });

  it('rejects a locator whose fingerprint belongs to a different node', async () => {
    const before = load('duplicates.html');
    await expectErrorCode(
      () => applyEditTransaction(before, textTxn(before, dupLocator([0, 1], 'belongs-elsewhere'), 'x')),
      'TEXT_MISMATCH'
    );
  });

  it('rejects a locator built on old source after a sibling insertion (TEXT_MISMATCH)', async () => {
    const oldSource = load('basic.html');
    const staleLocator = h1Locator();
    const newSource = oldSource.replace('<h1 id="title">', '<h1>Drifted</h1><h1 id="title">');
    await expectErrorCode(
      () =>
        applyEditTransaction(newSource, {
          baseRevision: sha(newSource),
          locator: staleLocator,
          operations: [{ kind: 'text', value: 'x' }],
        }),
      'TEXT_MISMATCH'
    );
  });

  it('rejects a drifted path that no longer resolves (ELEMENT_NOT_FOUND)', async () => {
    const oldSource = load('duplicates.html');
    const staleLocator = dupLocator([0, 2]);
    const newSource = oldSource.replace('    <p class="q">dup</p>\n', '');
    await expectErrorCode(
      () =>
        applyEditTransaction(newSource, {
          baseRevision: sha(newSource),
          locator: staleLocator,
          operations: [{ kind: 'text', value: 'x' }],
        }),
      'ELEMENT_NOT_FOUND'
    );
  });

  it('applies at the path without fuzzy search when the fingerprint matches', async () => {
    const oldSource = load('duplicates.html');
    const staleLocator = dupLocator([0, 1]);
    const newSource = oldSource.replace(
      '<p class="q" id="same">dup</p>',
      '<p class="q">newer</p><p class="q" id="same">dup</p>'
    );
    const result = await applyEditTransaction(newSource, {
      baseRevision: sha(newSource),
      locator: staleLocator,
      operations: [{ kind: 'text', value: 'changed' }],
    });
    expect(result.source).toBe(
      newSource.replace('<p class="q" id="same">dup</p>', '<p class="q" id="same">changed</p>')
    );
    expect(result.source).toContain('<p class="q">newer</p>');
  });
});

describe('applyEditTransaction — implicit elements', () => {
  it('edits a td below the implicit tbody', async () => {
    const before = load('implicit.html');
    const locator: DesignSelection = {
      elementPath: [0, 0, 0, 0],
      tagName: 'td',
      text: 'cell text',
      sourceText: 'cell text',
    };
    const result = await applyEditTransaction(before, textTxn(before, locator, 'new text'));
    expect(result.source).toContain('<td id="cell">new text</td>');
  });

  it('rejects the implicit tbody', async () => {
    const before = load('implicit.html');
    await expectErrorCode(
      () =>
        applyEditTransaction(before, {
          baseRevision: sha(before),
          locator: { elementPath: [0, 0], tagName: 'tbody', text: '', sourceText: '' },
          operations: [{ kind: 'text', value: 'x' }],
        }),
      'IMPLICIT_ELEMENT'
    );
  });

  it('rejects the implicit body itself', async () => {
    const before = load('implicit.html');
    await expectErrorCode(
      () =>
        applyEditTransaction(before, {
          baseRevision: sha(before),
          locator: { elementPath: [], tagName: 'body', text: '', sourceText: '' },
          operations: [{ kind: 'text', value: 'x' }],
        }),
      'IMPLICIT_ELEMENT'
    );
  });
});

describe('applyEditTransaction — malformed source', () => {
  it('rejects targets whose start tag contains a duplicate attribute', async () => {
    const before = load('malformed.html');
    // The div is a direct body child; the span (with the second duplicate
    // attribute) sits inside the unclosed second <p>.
    for (const [path, tagName] of [
      [[0], 'div'],
      [[2, 0], 'span'],
    ] as const) {
      await expectErrorCode(
        () =>
          applyEditTransaction(before, {
            baseRevision: sha(before),
            locator: { elementPath: [...path], tagName, text: 'x', sourceText: 'x' },
            operations: [{ kind: 'text', value: 'y' }],
          }),
        'DUPLICATE_ATTRIBUTE'
      );
    }
  });

  it('edits the first unclosed paragraph byte-exactly', async () => {
    const before = load('malformed.html');
    const locator: DesignSelection = {
      elementPath: [1],
      tagName: 'p',
      text: 'unclosed paragraph',
      sourceText: 'unclosed paragraph',
    };
    const result = await applyEditTransaction(before, textTxn(before, locator, 'closed now'));

    const raw = 'unclosed paragraph\n  ';
    const start = before.indexOf(raw);
    const end = start + raw.length;
    expect(result.source).toBe(`${before.slice(0, start)}closed now${before.slice(end)}`);
  });

  it('rejects an element whose span contains a parse error (MALFORMED_HTML)', async () => {
    const before = load('malformed.html');
    // The second unclosed <p> spans the <span data-x="1" data-x="2"> child with duplicated attrs.
    await expectErrorCode(
      () =>
        applyEditTransaction(before, {
          baseRevision: sha(before),
          locator: { elementPath: [2], tagName: 'p', text: 'second', sourceText: 'second' },
          operations: [{ kind: 'text', value: 'y' }],
        }),
      'MALFORMED_HTML'
    );
  });
});

describe('applyEditTransaction — chaining', () => {
  it('applies a second transaction using the selection returned by the first', async () => {
    const before = load('basic.html');
    const first = await applyEditTransaction(
      before,
      textTxn(before, h1Locator(), 'Tea & Co — sip & read')
    );
    expect(first.selection.sourceText).toBe('Tea & Co — sip & read');
    expect(first.selection.base).toBe(first.revision);

    const second = await applyEditTransaction(first.source, {
      baseRevision: first.revision,
      locator: first.selection,
      operations: [{ kind: 'style', property: 'color', value: 'green' }],
    });

    const expected = before
      .replace(H1_RAW, 'Tea &amp; Co — sip &amp; read')
      .replace('<h1 id="title">', '<h1 id="title" style="color: green">');
    expect(second.source).toBe(expected);
    expect(second.revision).toBe(sha(second.source));
    expect(second.selection.sourceText).toBe('Tea & Co — sip & read');
    expect(second.selection.color).toBe('green');
    expect(second.selection.base).toBe(second.revision);
  });

  it('keeps text fields of the locator for style-only transactions', async () => {
    const before = load('basic.html');
    const result = await applyEditTransaction(before, styleTxn(before, h1Locator(), 'color', 'red'));
    expect(result.selection.text).toBe(H1_TEXT);
    expect(result.selection.sourceText).toBe(H1_TEXT);
    expect(result.selection.color).toBe('red');
  });
});
