import type {
  DesignEditOperation,
  DesignEditResult,
  DesignSelection,
  DesignStyleProperty,
  DesignEditTransaction,
} from '../types';
import { DesignEditError } from '../types';
import { sha256Hex } from './hash';
import {
  attributeSpan,
  attrValue,
  findElement,
  isTextNode,
  newAttributeInsertOffset,
  parseDocument,
  textChildSpan,
  type P5Element,
} from './parse';
import { setDeclaration } from './style-declarations';
import { escapeAttr, escapeText, safeColor } from './values';

type TextOperation = Extract<DesignEditOperation, { kind: 'text' }>;
type StyleOperation = Extract<DesignEditOperation, { kind: 'style' }>;

interface Splice {
  start: number;
  end: number;
  replacement: string;
}

/** Map a CSS property name to the matching DesignSelection field. */
const SELECTION_STYLE_KEYS: Record<DesignStyleProperty, 'color' | 'backgroundColor'> = {
  color: 'color',
  'background-color': 'backgroundColor',
};

function inSpan(error: { startOffset: number }, span: { startOffset: number; endOffset: number }): boolean {
  return error.startOffset >= span.startOffset && error.startOffset < span.endOffset;
}

function buildTextSplice(
  element: P5Element,
  operation: TextOperation,
  locator: DesignSelection
): Splice {
  if (element.childNodes.length === 0) {
    // Empty element: insert escaped text right after the start tag unless the
    // locator claims prior text content. (The zero-width splice sits at
    // startTag.endOffset so `<figure></figure>` becomes
    // `<figure>text</figure>`; inserting before the `>` would fuse the text
    // into the tag name. A self-closing `<div/>` followed by text re-parses
    // as `<div>text</div>` because parse5 ignores the stray solidus.)
    if (locator.sourceText !== undefined && locator.sourceText.trim() !== '') {
      throw new DesignEditError(
        'TEXT_MISMATCH',
        'The element had no text content, but the selection carried one.'
      );
    }
    const startTag = element.sourceCodeLocation?.startTag;
    if (!startTag) {
      throw new DesignEditError('IMPLICIT_ELEMENT', 'The target element has no source location.');
    }
    const at = startTag.endOffset;
    return { start: at, end: at, replacement: escapeText(operation.value) };
  }

  if (!element.childNodes.every(isTextNode)) {
    throw new DesignEditError(
      'NOT_PLAIN_TEXT',
      'Text can only be replaced on an element whose children are a single text node.'
    );
  }
  const decoded = element.childNodes.map(child => (isTextNode(child) ? child.value : '')).join('');
  if (locator.sourceText !== undefined && decoded.trim() !== locator.sourceText.trim()) {
    throw new DesignEditError('TEXT_MISMATCH', 'The element text no longer matches the selection.');
  }
  const span = textChildSpan(element);
  if (!span) {
    throw new DesignEditError('IMPLICIT_ELEMENT', 'The text node has no source location.');
  }
  return { start: span.start, end: span.end, replacement: escapeText(operation.value) };
}

interface StyleFold {
  splice: Splice | null;
  applied: Map<DesignStyleProperty, string>;
  cleared: Set<DesignStyleProperty>;
}

function buildStyleFold(source: string, element: P5Element, operations: StyleOperation[]): StyleFold {
  const applied = new Map<DesignStyleProperty, string>();
  const cleared = new Set<DesignStyleProperty>();
  const hasStyleAttr = element.attrs.some(attr => attr.name === 'style');

  if (!hasStyleAttr) {
    let declaration = '';
    let changed = false;
    for (const operation of operations) {
      if (operation.value === null) continue; // nothing to clear
      const safe = safeColor(operation.value);
      if (!safe) {
        throw new DesignEditError('INVALID_VALUE', `Invalid color value: ${operation.value}`);
      }
      declaration = setDeclaration(declaration, operation.property, safe);
      changed = true;
      cleared.delete(operation.property);
      applied.set(operation.property, safe);
    }
    if (!changed) return { splice: null, applied, cleared };
    const at = newAttributeInsertOffset(source, element);
    if (at === null) {
      throw new DesignEditError('IMPLICIT_ELEMENT', 'The target element has no source location.');
    }
    return {
      splice: { start: at, end: at, replacement: ` style="${escapeAttr(declaration)}"` },
      applied,
      cleared,
    };
  }

  const attrSpan = attributeSpan(element, 'style');
  if (!attrSpan) {
    throw new DesignEditError('IMPLICIT_ELEMENT', 'The style attribute has no source location.');
  }
  let value = attrValue(element, 'style') ?? '';
  let changed = false;
  for (const operation of operations) {
    let safeValue: string | null = null;
    if (operation.value !== null) {
      safeValue = safeColor(operation.value);
      if (!safeValue) {
        throw new DesignEditError('INVALID_VALUE', `Invalid color value: ${operation.value}`);
      }
    }
    const next = setDeclaration(value, operation.property, safeValue);
    if (next === value) continue; // e.g. clearing a declaration that does not exist
    value = next;
    changed = true;
    if (safeValue === null) {
      applied.delete(operation.property);
      cleared.add(operation.property);
    } else {
      cleared.delete(operation.property);
      applied.set(operation.property, safeValue);
    }
  }
  if (!changed) return { splice: null, applied, cleared };
  return {
    splice: { start: attrSpan.start, end: attrSpan.end, replacement: `style="${escapeAttr(value)}"` },
    applied,
    cleared,
  };
}

/**
 * Apply one edit transaction to a draft source string.
 *
 * The source is parsed once; the operations are turned into non-overlapping
 * splices which are applied highest-offset first. Any validation failure
 * throws a DesignEditError and the source is left untouched.
 */
export async function applyEditTransaction(
  source: string,
  txn: DesignEditTransaction
): Promise<DesignEditResult> {
  const revision = await sha256Hex(source);
  if (txn.baseRevision !== revision) {
    throw new DesignEditError(
      'REVISION_MISMATCH',
      'The transaction was built against a different draft revision.'
    );
  }

  const parsed = parseDocument(source);
  const element = findElement(parsed.document, txn.locator.elementPath);
  if (!element) {
    throw new DesignEditError('ELEMENT_NOT_FOUND', 'The element path no longer resolves.');
  }
  if (element.tagName.toLowerCase() !== txn.locator.tagName.toLowerCase()) {
    throw new DesignEditError('TAG_MISMATCH', 'The element at the path has a different tag name.');
  }
  const location = element.sourceCodeLocation;
  if (!location?.startTag) {
    throw new DesignEditError('IMPLICIT_ELEMENT', 'The target element has no source location.');
  }
  const startTagLocation = location.startTag;

  if (
    parsed.errors.some(
      error => error.code === 'duplicate-attribute' && inSpan(error, startTagLocation)
    )
  ) {
    throw new DesignEditError(
      'DUPLICATE_ATTRIBUTE',
      'The target start tag contains a duplicate attribute.'
    );
  }
  if (parsed.errors.some(error => inSpan(error, location))) {
    throw new DesignEditError(
      'MALFORMED_HTML',
      'The target element contains a parse error.'
    );
  }

  const textOperations = txn.operations.filter(
    (operation): operation is TextOperation => operation.kind === 'text'
  );
  const styleOperations = txn.operations.filter(
    (operation): operation is StyleOperation => operation.kind === 'style'
  );

  const splices: Splice[] = [];
  // Multiple text operations in one transaction: the last one wins.
  const lastTextOperation = textOperations.at(-1);
  if (lastTextOperation) {
    splices.push(buildTextSplice(element, lastTextOperation, txn.locator));
  }

  const styleFold = buildStyleFold(source, element, styleOperations);
  if (styleFold.splice) splices.push(styleFold.splice);

  if (
    splices.length === 0 ||
    splices.every(splice => source.slice(splice.start, splice.end) === splice.replacement)
  ) {
    throw new DesignEditError('EMPTY_TRANSACTION', 'The transaction does not change the source.');
  }

  splices.sort((a, b) => b.start - a.start);
  let nextSource = source;
  for (const splice of splices) {
    nextSource = nextSource.slice(0, splice.start) + splice.replacement + nextSource.slice(splice.end);
  }

  const nextRevision = await sha256Hex(nextSource);

  const selection: DesignSelection = { ...txn.locator, base: nextRevision };
  if (lastTextOperation) {
    selection.text = lastTextOperation.value;
    selection.sourceText = lastTextOperation.value.trim();
  }
  for (const [property, value] of styleFold.applied) {
    selection[SELECTION_STYLE_KEYS[property]] = value;
  }
  for (const property of styleFold.cleared) {
    delete selection[SELECTION_STYLE_KEYS[property]];
  }

  return { source: nextSource, revision: nextRevision, selection };
}
