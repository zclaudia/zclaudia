import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { attributeSpan, elementSpan, findElement, newAttributeInsertOffset, parseDocument, textChildSpan } from '../../html/parse';
import { applyEditTransaction } from '../../html/edit-engine';
import { sha256HexSync } from '../../html/hash';
import type {
  DesignAttributeName,
  DesignEditErrorCode,
  DesignEditTransaction,
  DesignSelection,
  DesignStyleProperty,
  DesignStructureAction,
} from '../../types';

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

// ---------------------------------------------------------------------------
// P3 (L10): style whitelist, attribute and structure operations
// ---------------------------------------------------------------------------

const styleTxnP = (
  source: string,
  locator: DesignSelection,
  property: DesignStyleProperty,
  value: string | null
): DesignEditTransaction => ({
  baseRevision: sha(source),
  locator,
  operations: [{ kind: 'style', property, value }],
});

const plainLocator = (path: number[], tagName: string): DesignSelection => ({
  elementPath: path,
  tagName,
  text: '',
  sourceText: '',
});

const attributeTxn = (
  source: string,
  locator: DesignSelection,
  name: DesignAttributeName,
  value: string | null
): DesignEditTransaction => ({
  baseRevision: sha(source),
  locator,
  operations: [{ kind: 'attribute', name, value }],
});

const structureTxn = (
  source: string,
  locator: DesignSelection,
  action: DesignStructureAction
): DesignEditTransaction => ({
  baseRevision: sha(source),
  locator,
  operations: [{ kind: 'structure', action }],
});

describe('applyEditTransaction — P3 style whitelist', () => {
  const simple = (): DesignSelection => ({
    elementPath: [0, 0],
    tagName: 'p',
    text: 'hi',
    sourceText: 'hi',
  });

  it.each([
    ['font-family', 'JetBrains Mono, monospace'],
    ['font-size', '1.25rem'],
    ['font-weight', 'bold'],
    ['line-height', '1.5'],
    ['text-align', 'center'],
    ['color', '#369'],
    ['background-color', 'rgb(1, 2, 3)'],
    ['width', 'auto'],
    ['height', '50vh'],
    ['margin', '8px 12px'],
    ['margin-top', '-4px'],
    ['padding', '0'],
    ['padding-top', '2em'],
    ['border-width', '1px 2px'],
    ['border-style', 'dashed'],
    ['border-color', 'red'],
    ['border-radius', '4px'],
    ['object-fit', 'cover'],
  ])('writes %s: %s into a fresh style attribute, byte-exactly', async (property, value) => {
    const before = '<main><p>hi</p></main>';
    const result = await applyEditTransaction(before, styleTxnP(before, simple(), property, value));
    // Byte-exact: everything outside the inserted attribute is unchanged.
    expect(result.source).toBe(`<main><p style="${property}: ${value}">hi</p></main>`);
    expect(result.revision).toBe(sha(result.source));
  });

  it('does not mirror non-color style values into the selection', async () => {
    const before = load('cascade.html');
    const locator: DesignSelection = {
      elementPath: [1],
      tagName: 'p',
      text: 'multi declaration',
      sourceText: 'multi declaration',
    };
    const result = await applyEditTransaction(before, styleTxnP(before, locator, 'margin-top', '4px'));
    expect(result.selection).toEqual({
      elementPath: [1],
      tagName: 'p',
      text: 'multi declaration',
      sourceText: 'multi declaration',
      base: result.revision,
    });
  });

  it('appends margin-top after an existing margin shorthand (later writer wins)', async () => {
    const before = load('cascade.html');
    const locator: DesignSelection = {
      elementPath: [1],
      tagName: 'p',
      text: 'multi declaration',
      sourceText: 'multi declaration',
    };
    const result = await applyEditTransaction(before, styleTxnP(before, locator, 'margin-top', '4px'));
    const attrSpan = attributeSpan(findElement(parseDocument(before).document, [1])!, 'style')!;
    expect(before.slice(attrSpan.start, attrSpan.end)).toBe('style="color: blue; margin : 0"');
    expect(result.source).toBe(
      `${before.slice(0, attrSpan.start)}style="color: blue; margin : 0; margin-top: 4px"${before.slice(attrSpan.end)}`
    );
  });

  it('clearing a missing margin-top above a margin shorthand is a no-op (EMPTY_TRANSACTION)', async () => {
    const before = load('cascade.html');
    const locator: DesignSelection = {
      elementPath: [1],
      tagName: 'p',
      text: 'multi declaration',
      sourceText: 'multi declaration',
    };
    await expectErrorCode(
      () => applyEditTransaction(before, styleTxnP(before, locator, 'margin-top', null)),
      'EMPTY_TRANSACTION'
    );
  });

  it('clearing the margin shorthand removes the whole declaration', async () => {
    const before = load('cascade.html');
    const locator: DesignSelection = {
      elementPath: [1],
      tagName: 'p',
      text: 'multi declaration',
      sourceText: 'multi declaration',
    };
    const result = await applyEditTransaction(before, styleTxnP(before, locator, 'margin', null));
    expect(result.source).toContain('<p class="multi" style="color: blue">');
  });

  it('validates non-color values through the per-property rules (INVALID_VALUE)', async () => {
    const before = load('basic.html');
    await expectErrorCode(
      () => applyEditTransaction(before, styleTxnP(before, h1Locator(), 'font-size', 'xx')),
      'INVALID_VALUE'
    );
    await expectErrorCode(
      () => applyEditTransaction(before, styleTxnP(before, h1Locator(), 'margin', '-1px auto bogus')),
      'INVALID_VALUE'
    );
  });

  it('keeps the original keyword spelling (case-insensitive match)', async () => {
    const before = '<main><p>hi</p></main>';
    const result = await applyEditTransaction(before, styleTxnP(before, simple(), 'text-align', 'CENTER'));
    expect(result.source).toBe('<main><p style="text-align: CENTER">hi</p></main>');
  });
});

describe('applyEditTransaction — attribute operations', () => {
  const imgLocator = (attrs?: DesignSelection['attrs']): DesignSelection => ({
    elementPath: [1, 1],
    tagName: 'img',
    text: '',
    ...(attrs ? { attrs } : {}),
  });

  it('replaces an existing attribute in place and escapes the value', async () => {
    const before = load('basic.html');
    const result = await applyEditTransaction(before, attributeTxn(before, imgLocator(), 'alt', 'Coffee & Co logo'));
    const span = attributeSpan(findElement(parseDocument(before).document, [1, 1])!, 'alt')!;
    expect(before.slice(span.start, span.end)).toBe('alt="logo"');
    expect(result.source).toBe(
      `${before.slice(0, span.start)}alt="Coffee &amp; Co logo"${before.slice(span.end)}`
    );
    expect(result.selection.attrs).toEqual({ alt: 'Coffee & Co logo' });
    expect(result.selection.base).toBe(result.revision);
  });

  it('inserts a new attribute after the last existing attribute', async () => {
    const before = '<main><img alt="logo"></main>';
    const result = await applyEditTransaction(before, attributeTxn(before, plainLocator([0, 0], 'img'), 'src', 'images/pic.png'));
    expect(result.source).toBe('<main><img alt="logo" src="images/pic.png"></main>');
    expect(result.selection.attrs).toEqual({ src: 'images/pic.png' });
  });

  it('inserts several new attributes in operation order', async () => {
    const before = '<main><img></main>';
    const result = await applyEditTransaction(before, {
      baseRevision: sha(before),
      locator: plainLocator([0, 0], 'img'),
      operations: [
        { kind: 'attribute', name: 'alt', value: 'x' },
        { kind: 'attribute', name: 'src', value: 'y.png' },
      ],
    });
    expect(result.source).toBe('<main><img alt="x" src="y.png"></main>');
    expect(result.selection.attrs).toEqual({ alt: 'x', src: 'y.png' });
  });

  it('merges same-name attribute operations, the last one wins (single splice)', async () => {
    const before = '<main><img alt="one" src="a.png"></main>';
    const result = await applyEditTransaction(before, {
      baseRevision: sha(before),
      locator: plainLocator([0, 0], 'img'),
      operations: [
        { kind: 'attribute', name: 'alt', value: 'two' },
        { kind: 'attribute', name: 'alt', value: 'three' },
      ],
    });
    expect(result.source).toBe('<main><img alt="three" src="a.png"></main>');
    expect(result.selection.attrs).toEqual({ alt: 'three' });
  });

  it('deletes an attribute and reflects it in selection.attrs', async () => {
    const before = load('basic.html');
    const result = await applyEditTransaction(
      before,
      attributeTxn(before, imgLocator({ src: 'images/logo.svg', alt: 'logo' }), 'alt', null)
    );
    const span = attributeSpan(findElement(parseDocument(before).document, [1, 1])!, 'alt')!;
    expect(result.source).toBe(`${before.slice(0, span.start)}${before.slice(span.end)}`);
    expect(result.selection.attrs).toEqual({ src: 'images/logo.svg' });
  });

  it('omits selection.attrs when nothing remains after a delete', async () => {
    const before = load('basic.html');
    const result = await applyEditTransaction(before, attributeTxn(before, imgLocator(), 'alt', null));
    expect(result.selection.attrs).toBeUndefined();
  });

  it('deleting an absent attribute is a no-op (EMPTY_TRANSACTION)', async () => {
    const before = '<main><img src="a.png"></main>';
    await expectErrorCode(
      () => applyEditTransaction(before, attributeTxn(before, plainLocator([0, 0], 'img'), 'alt', null)),
      'EMPTY_TRANSACTION'
    );
  });

  it('rejects attributes whose tag does not match (ATTRIBUTE_NOT_ALLOWED)', async () => {
    const anchor = '<main><a href="#top">x</a></main>';
    await expectErrorCode(
      () => applyEditTransaction(anchor, attributeTxn(anchor, plainLocator([0, 0], 'a'), 'src', 'a.png')),
      'ATTRIBUTE_NOT_ALLOWED'
    );
    const img = '<main><img src="a.png"></main>';
    await expectErrorCode(
      () => applyEditTransaction(img, attributeTxn(img, plainLocator([0, 0], 'img'), 'href', '#top')),
      'ATTRIBUTE_NOT_ALLOWED'
    );
    const div = '<main><div>x</div></main>';
    await expectErrorCode(
      () => applyEditTransaction(div, attributeTxn(div, plainLocator([0, 0], 'div'), 'alt', 'x')),
      'ATTRIBUTE_NOT_ALLOWED'
    );
  });

  it('rejects values failing safeAttrValue (INVALID_VALUE)', async () => {
    const before = '<main><img src="a.png"></main>';
    await expectErrorCode(
      () => applyEditTransaction(before, attributeTxn(before, plainLocator([0, 0], 'img'), 'src', 'a.txt')),
      'INVALID_VALUE'
    );
    await expectErrorCode(
      () => applyEditTransaction(before, attributeTxn(before, plainLocator([0, 0], 'img'), 'src', ' a.png')),
      'INVALID_VALUE'
    );
    const anchor = '<main><a href="#top">x</a></main>';
    await expectErrorCode(
      () =>
        applyEditTransaction(anchor, attributeTxn(anchor, plainLocator([0, 0], 'a'), 'href', 'javascript:alert(1)')),
      'INVALID_VALUE'
    );
  });

  it('rewrites an href on an anchor in place', async () => {
    const before = '<main><a id="lnk" href="#old">x</a></main>';
    const result = await applyEditTransaction(
      before,
      attributeTxn(before, plainLocator([0, 0], 'a'), 'href', 'https://example.com/page')
    );
    expect(result.source).toBe('<main><a id="lnk" href="https://example.com/page">x</a></main>');
    expect(result.selection.attrs).toEqual({ href: 'https://example.com/page' });
  });
});

describe('applyEditTransaction — structure: duplicate', () => {
  it('duplicates a subtree after span.end, renaming ids and rewriting inner anchors', async () => {
    const before = '<main><section id="wrap"><a id="lnk" href="#inner">go</a><div id="inner">t</div></section><p id="other">o</p></main>';
    const result = await applyEditTransaction(before, structureTxn(before, plainLocator([0, 0], 'section'), 'duplicate'));

    const span = elementSpan(findElement(parseDocument(before).document, [0, 0])!)!;
    const copy = before.slice(span.start, span.end);
    const renamedCopy = copy
      .replace('id="wrap"', 'id="wrap-copy"')
      .replace('id="lnk"', 'id="lnk-copy"')
      .replace('href="#inner"', 'href="#inner-copy"')
      .replace('id="inner"', 'id="inner-copy"');
    expect(result.source).toBe(`${before.slice(0, span.end)}${renamedCopy}${before.slice(span.end)}`);
    // The original subtree keeps its ids and its external anchor target.
    expect(result.source).toContain('<section id="wrap"><a id="lnk" href="#inner">go</a>');
    expect(result.selection).toEqual({
      elementPath: [0, 1],
      tagName: 'section',
      text: 'got',
      sourceText: 'got',
      base: result.revision,
    });
  });

  it('resolves -copy conflicts with -copy-2 inside the uniqueness domain', async () => {
    const before = '<main><p id="a">x</p><p id="a-copy">y</p><div id="z"><span id="a">w</span></div></main>';
    const result = await applyEditTransaction(before, structureTxn(before, plainLocator([0, 2], 'div'), 'duplicate'));

    const span = elementSpan(findElement(parseDocument(before).document, [0, 2])!)!;
    const expected = `${before.slice(0, span.end)}<div id="z-copy"><span id="a-copy-2">w</span></div>${before.slice(span.end)}`;
    expect(result.source).toBe(expected);
    expect(result.selection.elementPath).toEqual([0, 3]);
    expect(result.selection.text).toBe('w');
  });

  it('keeps anchors pointing outside the copied subtree untouched', async () => {
    const before = '<main><nav id="n"><a href="#sec">go</a></nav><section id="sec">s</section></main>';
    const result = await applyEditTransaction(before, structureTxn(before, plainLocator([0, 0], 'nav'), 'duplicate'));
    // The copy is inserted directly after `</nav>`; the external #sec anchor is not rewritten.
    expect(result.source).toBe(
      before.replace('</nav>', '</nav><nav id="n-copy"><a href="#sec">go</a></nav>')
    );
    expect(result.selection.elementPath).toEqual([0, 1]);
    expect(result.selection.tagName).toBe('nav');
  });
});

describe('applyEditTransaction — structure: delete', () => {
  it('rejects when an id is referenced by an anchor outside the subtree (ANCHOR_REFERENCED)', async () => {
    const before = '<main><p id="x">a</p></main>\n<footer><a href="#x">jump</a></footer>';
    try {
      await applyEditTransaction(before, structureTxn(before, plainLocator([0, 0], 'p'), 'delete'));
      throw new Error('Expected ANCHOR_REFERENCED');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('ANCHOR_REFERENCED');
      expect((error as { message?: string }).message).toContain('x');
    }
  });

  it('allows anchors that live inside the deleted subtree', async () => {
    const before = '<main><div id="wrap"><a href="#wrap">up</a><p id="x">t</p></div></main>';
    const result = await applyEditTransaction(before, structureTxn(before, plainLocator([0, 0], 'div'), 'delete'));
    expect(result.source).toBe('<main></main>');
    expect(result.selection).toEqual({
      elementPath: [0],
      tagName: 'main',
      text: 'upt',
      sourceText: 'upt',
      base: result.revision,
    });
  });

  it('removes exactly the element bytes and selects the parent', async () => {
    const before = '<main>\n  <p>one</p>\n  <p>two</p>\n</main>';
    const result = await applyEditTransaction(before, structureTxn(before, plainLocator([0, 1], 'p'), 'delete'));

    const span = elementSpan(findElement(parseDocument(before).document, [0, 1])!)!;
    expect(result.source).toBe(`${before.slice(0, span.start)}${before.slice(span.end)}`);
    // Parent text comes from the parse tree (contract §3.3), so it still
    // contains the deleted child's text here.
    expect(result.selection).toEqual({
      elementPath: [0],
      tagName: 'main',
      text: 'one\n  two',
      sourceText: 'one\n  two',
      base: result.revision,
    });
  });
});

describe('applyEditTransaction — structure: move-up / move-down', () => {
  const NAV = '<main>\n  <p id="a">A</p>\n  <span id="b">B</span>\n  <em id="c">C</em>\n</main>';

  const navSpan = (source: string, index: number) =>
    elementSpan(findElement(parseDocument(source).document, [0, index])!)!;

  it('moves an element down, preserving the bytes between the two elements', async () => {
    const before = NAV;
    const result = await applyEditTransaction(before, structureTxn(before, plainLocator([0, 0], 'p'), 'move-down'));

    const t = navSpan(before, 0);
    const n = navSpan(before, 1);
    // Region [t.start, n.end) becomes n + middle + t.
    const expected =
      before.slice(0, t.start) +
      before.slice(n.start, n.end) +
      before.slice(t.end, n.start) +
      before.slice(t.start, t.end) +
      before.slice(n.end);
    expect(result.source).toBe(expected);
    expect(result.selection).toEqual({
      elementPath: [0, 1],
      tagName: 'p',
      text: 'A',
      sourceText: 'A',
      base: result.revision,
    });
  });

  it('moves an element up, preserving the bytes between the two elements', async () => {
    const before = NAV;
    const result = await applyEditTransaction(before, structureTxn(before, plainLocator([0, 2], 'em'), 'move-up'));

    const t = navSpan(before, 2);
    const p = navSpan(before, 1);
    // Region [p.start, t.end) becomes t + middle + p.
    const expected =
      before.slice(0, p.start) +
      before.slice(t.start, t.end) +
      before.slice(p.end, t.start) +
      before.slice(p.start, p.end) +
      before.slice(t.end);
    expect(result.source).toBe(expected);
    expect(result.selection.elementPath).toEqual([0, 1]);
    expect(result.selection.tagName).toBe('em');
  });

  it('rejects moving the first element up and the last element down', async () => {
    await expectErrorCode(
      () => applyEditTransaction(NAV, structureTxn(NAV, plainLocator([0, 0], 'p'), 'move-up')),
      'STRUCTURE_NOT_ALLOWED'
    );
    await expectErrorCode(
      () => applyEditTransaction(NAV, structureTxn(NAV, plainLocator([0, 2], 'em'), 'move-down')),
      'STRUCTURE_NOT_ALLOWED'
    );
  });
});

describe('applyEditTransaction — structure guards', () => {
  const NAV = '<main>\n  <p>A</p>\n</main>';

  it('rejects structure operations mixed with other kinds', async () => {
    await expectErrorCode(
      () =>
        applyEditTransaction(NAV, {
          baseRevision: sha(NAV),
          locator: plainLocator([0, 0], 'p'),
          operations: [
            { kind: 'structure', action: 'delete' },
            { kind: 'style', property: 'color', value: 'red' },
          ],
        }),
      'STRUCTURE_NOT_ALLOWED'
    );
    await expectErrorCode(
      () =>
        applyEditTransaction(NAV, {
          baseRevision: sha(NAV),
          locator: plainLocator([0, 0], 'p'),
          operations: [
            { kind: 'text', value: 'x' },
            { kind: 'structure', action: 'delete' },
          ],
        }),
      'STRUCTURE_NOT_ALLOWED'
    );
    await expectErrorCode(
      () =>
        applyEditTransaction(NAV, {
          baseRevision: sha(NAV),
          locator: plainLocator([0, 0], 'p'),
          operations: [
            { kind: 'structure', action: 'duplicate' },
            { kind: 'structure', action: 'delete' },
          ],
        }),
      'STRUCTURE_NOT_ALLOWED'
    );
  });

  it('rejects structure operations on the body root', async () => {
    await expectErrorCode(
      () => applyEditTransaction(NAV, structureTxn(NAV, plainLocator([], 'body'), 'delete')),
      'STRUCTURE_NOT_ALLOWED'
    );
  });
});
