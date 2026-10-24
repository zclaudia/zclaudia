import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import type postcss from 'postcss';
import {
  absOffset,
  byteLength,
  enumerateStyleBlocks,
  parseBlock,
  resolveRulePath,
  type BlockParse,
  type BlockParseResult,
  type StyleBlock,
} from '../css-source';
import type {
  DesignAttributeName,
  DesignEditOperation,
  DesignEditResult,
  DesignSelection,
  DesignStructureAction,
  DesignStyleProperty,
  DesignEditTransaction,
} from '../types';
import {
  STYLE_BLOCK_MAX_BYTES,
  STYLE_SOURCE_PROPERTY_MAX,
  STYLE_SOURCE_PROPERTY_PATTERN,
} from '../types';
import { DesignEditError } from '../types';
import { sha256Hex } from './hash';
import {
  attributeSpan,
  attrValue,
  childElements,
  elementSpan,
  findElement,
  isTextNode,
  newAttributeInsertOffset,
  parseDocument,
  textChildSpan,
  type P5Element,
  type P5ParentNode,
  type ParsedDocument,
  type Span,
} from './parse';
import { setDeclaration } from './style-declarations';
import { escapeAttr, escapeText, safeAttrValue, safeSourceCssValue, safeStyleValue } from './values';

type TextOperation = Extract<DesignEditOperation, { kind: 'text' }>;
type StyleOperation = Extract<DesignEditOperation, { kind: 'style' }>;
type AttributeOperation = Extract<DesignEditOperation, { kind: 'attribute' }>;
type StructureOperation = Extract<DesignEditOperation, { kind: 'structure' }>;
type StyleBlockOperation = Extract<DesignEditOperation, { kind: 'styleBlock' }>;
type P5Fragment = DefaultTreeAdapterMap['documentFragment'];

interface Splice {
  start: number;
  end: number;
  replacement: string;
}

/** Map a CSS property name to the matching DesignSelection field (colors only; P3). */
const SELECTION_STYLE_KEYS: Partial<Record<DesignStyleProperty, 'color' | 'backgroundColor'>> = {
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
      const safe = safeStyleValue(operation.property, operation.value);
      if (!safe) {
        throw new DesignEditError(
          'INVALID_VALUE',
          `Invalid ${operation.property} value: ${operation.value}`
        );
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
      safeValue = safeStyleValue(operation.property, operation.value);
      if (!safeValue) {
        throw new DesignEditError(
          'INVALID_VALUE',
          `Invalid ${operation.property} value: ${operation.value}`
        );
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
 * Build the splice for one merged attribute operation.
 * Returns null when there is nothing to change (e.g. clearing an absent attribute).
 */
function buildAttributeSplice(
  source: string,
  element: P5Element,
  name: DesignAttributeName,
  value: string | null
): Splice | null {
  const tagName = element.tagName.toLowerCase();
  const allowed = name === 'href' ? tagName === 'a' : tagName === 'img';
  if (!allowed) {
    throw new DesignEditError(
      'ATTRIBUTE_NOT_ALLOWED',
      `The ${name} attribute only applies to ${name === 'href' ? 'a' : 'img'} elements.`
    );
  }
  const existing = attributeSpan(element, name);
  if (value === null) {
    if (!existing) return null; // nothing to clear
    return { start: existing.start, end: existing.end, replacement: '' };
  }
  const safe = safeAttrValue(name, value, tagName);
  if (safe === null) {
    throw new DesignEditError('INVALID_VALUE', `Invalid ${name} value: ${value}`);
  }
  const replacement = `${name}="${escapeAttr(safe)}"`;
  if (existing) return { start: existing.start, end: existing.end, replacement };
  const at = newAttributeInsertOffset(source, element);
  if (at === null) {
    throw new DesignEditError('IMPLICIT_ELEMENT', 'The target element has no source location.');
  }
  return { start: at, end: at, replacement: ` ${replacement}` };
}

// ---------------------------------------------------------------------------
// Style-block source operations (P3.5 §4): declaration-level edits inside
// entry-document <style> blocks. Positioning reuses css-source.ts (parse5 block
// enumeration + postcss offsets); every failure to align rejects the whole
// transaction with STYLE_SOURCE_NOT_FOUND — never guess a location.
// ---------------------------------------------------------------------------

/** Same-target fold key (attributeFold pattern): the last operation on one declaration wins. */
const styleBlockFoldKey = (operation: StyleBlockOperation): string =>
  `${operation.styleOrdinal}|${operation.rulePath.join('.')}|${operation.property.toLowerCase()}`;

/** Engine-side entry validation (values/property names come from the UI, never trusted). */
function validateStyleBlockOperation(operation: StyleBlockOperation): void {
  if (operation.value === null && operation.create) {
    throw new DesignEditError(
      'INVALID_VALUE',
      'A styleBlock operation cannot delete the declaration and create it at the same time.'
    );
  }
  if (
    !STYLE_SOURCE_PROPERTY_PATTERN.test(operation.property) ||
    operation.property.length > STYLE_SOURCE_PROPERTY_MAX
  ) {
    throw new DesignEditError(
      'INVALID_VALUE',
      `Invalid style source property name: ${operation.property}`
    );
  }
  if (operation.value !== null && safeSourceCssValue(operation.value) === null) {
    throw new DesignEditError('INVALID_VALUE', `Invalid style source value: ${operation.value}`);
  }
}

/** One splice per folded operation; same-target operations were folded to their last one. */
function buildStyleBlockSplices(source: string, operations: StyleBlockOperation[]): Splice[] {
  if (operations.length === 0) return [];
  const fold = new Map<string, StyleBlockOperation>();
  for (const operation of operations) fold.set(styleBlockFoldKey(operation), operation);
  const blocks = enumerateStyleBlocks(source);
  const parses = new Map<number, BlockParseResult>();
  return [...fold.values()].map(operation =>
    buildStyleBlockSplice(source, operation, blocks, parses)
  );
}

function buildStyleBlockSplice(
  source: string,
  operation: StyleBlockOperation,
  blocks: Map<number, StyleBlock>,
  parses: Map<number, BlockParseResult>
): Splice {
  validateStyleBlockOperation(operation);

  const block = blocks.get(operation.styleOrdinal);
  // Unknown ordinal or a block without source location: there is nothing to align against.
  if (!block || block.text === null) {
    throw new DesignEditError(
      'STYLE_SOURCE_NOT_FOUND',
      `Style block #${operation.styleOrdinal} does not resolve to editable source.`
    );
  }
  if (byteLength(block.text) > STYLE_BLOCK_MAX_BYTES) {
    throw new DesignEditError(
      'STYLE_SOURCE_NOT_FOUND',
      `Style block #${operation.styleOrdinal} exceeds the editable size limit.`
    );
  }
  const parsed = parseBlock(block, parses);
  if ('error' in parsed) {
    throw new DesignEditError(
      'STYLE_SOURCE_NOT_FOUND',
      `Style block #${operation.styleOrdinal} does not parse as CSS.`
    );
  }
  const rule = resolveRulePath(parsed.root, operation.rulePath);
  if (!rule) {
    throw new DesignEditError(
      'STYLE_SOURCE_NOT_FOUND',
      `The rule path [${operation.rulePath.join(', ')}] does not resolve in style block #${operation.styleOrdinal}.`
    );
  }
  const ruleEnd = rule.source?.end;
  if (!ruleEnd) {
    throw new DesignEditError('STYLE_SOURCE_NOT_FOUND', 'The rule has no source location.');
  }
  const closeOffset = absOffset(block, parsed, ruleEnd); // position of the closing '}'

  const declarations: postcss.Declaration[] = [];
  let target: postcss.Declaration | null = null;
  for (const node of rule.nodes ?? []) {
    if (node.type !== 'decl') continue;
    declarations.push(node);
    // Same-name declarations: operate on the LAST one (setDeclaration semantics).
    if (node.prop.toLowerCase() === operation.property.toLowerCase()) target = node;
  }

  if (!target) {
    if (!operation.create) {
      throw new DesignEditError(
        'STYLE_SOURCE_NOT_FOUND',
        `The rule has no ${operation.property} declaration to modify.`
      );
    }
    return createStyleDeclarationSplice(source, operation, rule, closeOffset, declarations, block, parsed);
  }
  if (operation.create) {
    throw new DesignEditError(
      'INVALID_VALUE',
      `The rule already has a ${operation.property} declaration.`
    );
  }
  const declStart = target.source?.start;
  const declEnd = target.source?.end;
  if (!declStart || !declEnd) {
    throw new DesignEditError('STYLE_SOURCE_NOT_FOUND', 'The declaration has no source location.');
  }
  const start = absOffset(block, parsed, declStart);
  const end = absOffset(block, parsed, declEnd);

  if (operation.value === null) {
    return deleteStyleDeclarationSplice(source, target, start, end);
  }
  // Change the value sub-range only: separators, whitespace and !important stay verbatim.
  const between = typeof target.raws.between === 'string' ? target.raws.between : '';
  const valueStart = start + target.prop.length + between.length;
  return { start: valueStart, end: valueStart + target.value.length, replacement: operation.value };
}

/** Remove the whole declaration plus its leading whitespace (raws.before) and its ';'. */
function deleteStyleDeclarationSplice(
  source: string,
  target: postcss.Declaration,
  start: number,
  end: number
): Splice {
  // postcss ends the node span on the ';' itself when one directly follows.
  let removeEnd = end + 1;
  if (source[end] !== ';') {
    // Unterminated trailing declaration: still eat an immediately following ';'
    // so no orphan delimiter is left behind.
    let cursor = removeEnd;
    while (source[cursor] === ' ' || source[cursor] === '\t') cursor += 1;
    if (source[cursor] === ';') removeEnd = cursor + 1;
  }
  const rawsBefore = typeof target.raws.before === 'string' ? target.raws.before : '';
  return { start: start - rawsBefore.length, end: removeEnd, replacement: '' };
}

/** Insert `prop: value;` right before the rule's closing '}', keeping the block's style. */
function createStyleDeclarationSplice(
  source: string,
  operation: StyleBlockOperation,
  rule: postcss.Rule,
  closeOffset: number,
  declarations: postcss.Declaration[],
  block: StyleBlock,
  parsed: BlockParse
): Splice {
  const declaration = `${operation.property}: ${operation.value};`;
  if (declarations.length === 0) {
    // Empty rule: selector-line indentation + two spaces.
    const ruleBefore = typeof rule.raws.before === 'string' ? rule.raws.before : '';
    const newlineAt = ruleBefore.lastIndexOf('\n');
    const lineIndent = newlineAt >= 0 ? ruleBefore.slice(newlineAt + 1) : ruleBefore;
    const lineBreak = newlineAt >= 0 ? '\n' : '';
    return {
      start: closeOffset,
      end: closeOffset,
      replacement: `${lineBreak}${lineIndent}  ${declaration}`,
    };
  }
  const last = declarations[declarations.length - 1];
  const rawsBefore = typeof last.raws.before === 'string' ? last.raws.before : '';
  // When the last declaration carries no ';' of its own, add one: the insertion
  // would otherwise be swallowed into that declaration's value.
  const lastEnd = last.source?.end ? absOffset(block, parsed, last.source.end) : null;
  const needsSemicolon = lastEnd !== null && source[lastEnd] !== ';';
  return {
    start: closeOffset,
    end: closeOffset,
    replacement: `${needsSemicolon ? ';' : ''}${rawsBefore}${declaration}`,
  };
}

/**
 * Apply the splices highest-offset first. Zero-width insertions sharing an
 * offset are applied in reverse operation order, so the first operation's
 * text ends up first in the resulting source.
 */
function applySplices(source: string, splices: Splice[]): string {
  const order = new Map<Splice, number>();
  splices.forEach((splice, index) => order.set(splice, index));
  const sorted = [...splices].sort(
    (a, b) => b.start - a.start || (order.get(b) ?? 0) - (order.get(a) ?? 0)
  );
  let nextSource = source;
  for (const splice of sorted) {
    nextSource = nextSource.slice(0, splice.start) + splice.replacement + nextSource.slice(splice.end);
  }
  return nextSource;
}

/** Depth-first pre-order walk over all elements below (and not including) a node. */
function walkElements(node: P5ParentNode, visit: (element: P5Element) => void): void {
  for (const child of childElements(node)) {
    visit(child);
    walkElements(child, visit);
  }
}

/** Decoded text content of a subtree (text nodes concatenated, document order). */
function textContentOf(node: P5ParentNode): string {
  let text = '';
  for (const child of node.childNodes) {
    if (isTextNode(child)) {
      text += child.value;
    } else if (!child.nodeName.startsWith('#')) {
      text += textContentOf(child as P5ParentNode);
    }
  }
  return text;
}

const trimmedText = (node: P5ParentNode): string => textContentOf(node).trim().slice(0, 2000);

function isInside(span: Span, outer: Span): boolean {
  return span.start >= outer.start && span.end <= outer.end;
}

// ---------------------------------------------------------------------------
// Structure operations (§3.3): duplicate / delete / move-up / move-down
// ---------------------------------------------------------------------------

function buildDuplicate(
  source: string,
  span: Span,
  parsed: ParsedDocument
): { splice: Splice; text: string } {
  const copy = source.slice(span.start, span.end);
  const fragment: P5Fragment = parseFragment(copy, { sourceCodeLocationInfo: true });

  // All ids in the document excluding the copied subtree itself.
  const docIds = new Set<string>();
  walkElements(parsed.document, node => {
    const id = attrValue(node, 'id');
    if (id === undefined) return;
    const nodeSpan = elementSpan(node);
    if (nodeSpan && isInside(nodeSpan, span)) return;
    docIds.add(id);
  });

  // Ids inside the copy subtree, document order.
  const copyIds: string[] = [];
  const seen = new Set<string>();
  walkElements(fragment, node => {
    const id = attrValue(node, 'id');
    if (id !== undefined && !seen.has(id)) {
      seen.add(id);
      copyIds.push(id);
    }
  });

  // Uniqueness domain: remaining document ids ∪ all copy ids ∪ names assigned below.
  const used = new Set<string>(docIds);
  for (const id of copyIds) used.add(id);
  const renamed = new Map<string, string>();
  for (const oldId of copyIds) {
    let candidate = `${oldId}-copy`;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${oldId}-copy-${suffix}`;
      suffix += 1;
    }
    renamed.set(oldId, candidate);
    used.add(candidate);
  }

  // Rewrite ids and inner self-referencing anchors in place inside the copy string.
  const replacements: Splice[] = [];
  walkElements(fragment, node => {
    for (const attr of node.attrs) {
      let newValue: string | undefined;
      if (attr.name === 'id') {
        newValue = renamed.get(attr.value);
      } else if (attr.name === 'href') {
        const anchor = /^#(.+)$/.exec(attr.value)?.[1];
        const mapped = anchor === undefined ? undefined : renamed.get(anchor);
        if (mapped !== undefined) newValue = `#${mapped}`;
      }
      if (newValue === undefined) continue;
      const attrSpan = attributeSpan(node, attr.name);
      if (!attrSpan) continue;
      replacements.push({
        start: attrSpan.start,
        end: attrSpan.end,
        replacement: `${attr.name}="${escapeAttr(newValue)}"`,
      });
    }
  });
  let renamedCopy = copy;
  for (const replacement of [...replacements].sort((a, b) => b.start - a.start)) {
    renamedCopy =
      renamedCopy.slice(0, replacement.start) + replacement.replacement + renamedCopy.slice(replacement.end);
  }
  const copyElement = childElements(fragment)[0];
  return {
    splice: { start: span.end, end: span.end, replacement: renamedCopy },
    text: copyElement ? trimmedText(copyElement) : '',
  };
}

function buildDelete(element: P5Element, span: Span, parsed: ParsedDocument): Splice {
  const subtreeIds = new Set<string>();
  const selfId = attrValue(element, 'id');
  if (selfId !== undefined) subtreeIds.add(selfId);
  walkElements(element, node => {
    const id = attrValue(node, 'id');
    if (id !== undefined) subtreeIds.add(id);
  });
  if (subtreeIds.size > 0) {
    const referenced = new Set<string>();
    walkElements(parsed.document, node => {
      const href = attrValue(node, 'href');
      if (!href || !href.startsWith('#')) return;
      const id = href.slice(1);
      if (!subtreeIds.has(id) || referenced.has(id)) return;
      const nodeSpan = elementSpan(node);
      if (!nodeSpan || isInside(nodeSpan, span)) return; // inside the deleted subtree: goes away with it
      referenced.add(id);
    });
    if (referenced.size > 0) {
      throw new DesignEditError(
        'ANCHOR_REFERENCED',
        `These ids are referenced by anchors outside the deleted subtree: ${[...referenced].sort().join(', ')}`
      );
    }
  }
  return { start: span.start, end: span.end, replacement: '' };
}

function buildMove(
  source: string,
  action: 'move-up' | 'move-down',
  span: Span,
  parent: P5Element,
  index: number
): Splice {
  const siblings = childElements(parent);
  const neighborIndex = action === 'move-up' ? index - 1 : index + 1;
  const neighbor = siblings[neighborIndex];
  if (!neighbor) {
    throw new DesignEditError('STRUCTURE_NOT_ALLOWED', 'There is no adjacent sibling element to swap with.');
  }
  const neighborSpan = elementSpan(neighbor);
  if (!neighborSpan) {
    throw new DesignEditError('IMPLICIT_ELEMENT', 'The adjacent sibling element has no source location.');
  }
  if (action === 'move-up') {
    // Defensive: sibling spans of the same parent must not overlap.
    if (neighborSpan.end > span.start) {
      throw new DesignEditError('MALFORMED_HTML', 'Sibling element spans unexpectedly overlap.');
    }
    // Region [prev.start, target.end) becomes target + middle bytes + prev.
    return {
      start: neighborSpan.start,
      end: span.end,
      replacement:
        source.slice(span.start, span.end) +
        source.slice(neighborSpan.end, span.start) +
        source.slice(neighborSpan.start, neighborSpan.end),
    };
  }
  // Defensive: sibling spans of the same parent must not overlap.
  if (neighborSpan.start < span.end) {
    throw new DesignEditError('MALFORMED_HTML', 'Sibling element spans unexpectedly overlap.');
  }
  // Region [target.start, next.end) becomes next + middle bytes + target.
  return {
    start: span.start,
    end: neighborSpan.end,
    replacement:
      source.slice(neighborSpan.start, neighborSpan.end) +
      source.slice(span.end, neighborSpan.start) +
      source.slice(span.start, span.end),
  };
}

/**
 * Apply one structure action. Structure operations are self-contained: they
 * must be the only operation of a transaction (checked by the caller) and the
 * returned selection carries base only (no styles/attrs/inlineStyle — the
 * panel re-selects to refresh computed values).
 */
async function applyStructureAction(
  source: string,
  parsed: ParsedDocument,
  element: P5Element,
  locator: DesignSelection,
  action: DesignStructureAction
): Promise<DesignEditResult> {
  const span = elementSpan(element);
  if (!span) {
    throw new DesignEditError('IMPLICIT_ELEMENT', 'The target element has no source location.');
  }
  const parentPath = locator.elementPath.slice(0, -1);
  const index = locator.elementPath[locator.elementPath.length - 1] ?? 0;
  const parent = findElement(parsed.document, parentPath);
  if (!parent) {
    throw new DesignEditError('ELEMENT_NOT_FOUND', 'The parent element no longer resolves.');
  }

  let splice: Splice;
  let selection: DesignSelection;
  switch (action) {
    case 'duplicate': {
      const duplicate = buildDuplicate(source, span, parsed);
      splice = duplicate.splice;
      selection = {
        elementPath: [...parentPath, index + 1],
        tagName: locator.tagName,
        text: duplicate.text,
        sourceText: duplicate.text,
      };
      break;
    }
    case 'delete': {
      splice = buildDelete(element, span, parsed);
      selection = {
        elementPath: parentPath,
        tagName: parent.tagName,
        text: trimmedText(parent),
        sourceText: trimmedText(parent),
      };
      break;
    }
    default: {
      splice = buildMove(source, action, span, parent, index);
      const targetText = trimmedText(element);
      selection = {
        elementPath: [...parentPath, action === 'move-up' ? index - 1 : index + 1],
        tagName: locator.tagName,
        text: targetText,
        sourceText: targetText,
      };
      break;
    }
  }

  const nextSource = source.slice(0, splice.start) + splice.replacement + source.slice(splice.end);
  const nextRevision = await sha256Hex(nextSource);
  selection.base = nextRevision;
  return { source: nextSource, revision: nextRevision, selection };
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

  // Structure operations must own the transaction and never target the body.
  const structureOperations = txn.operations.filter(
    (operation): operation is StructureOperation => operation.kind === 'structure'
  );
  if (structureOperations.length > 0) {
    if (txn.operations.length !== 1) {
      throw new DesignEditError(
        'STRUCTURE_NOT_ALLOWED',
        'A structure operation cannot be combined with other operations.'
      );
    }
    if (txn.locator.elementPath.length === 0) {
      throw new DesignEditError(
        'STRUCTURE_NOT_ALLOWED',
        'Structure operations are not allowed on the document body.'
      );
    }
  }

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

  if (structureOperations.length > 0) {
    const structureOperation = structureOperations[0];
    if (structureOperation) {
      return applyStructureAction(source, parsed, element, txn.locator, structureOperation.action);
    }
  }

  const textOperations = txn.operations.filter(
    (operation): operation is TextOperation => operation.kind === 'text'
  );
  const styleOperations = txn.operations.filter(
    (operation): operation is StyleOperation => operation.kind === 'style'
  );
  const attributeOperations = txn.operations.filter(
    (operation): operation is AttributeOperation => operation.kind === 'attribute'
  );
  const styleBlockOperations = txn.operations.filter(
    (operation): operation is StyleBlockOperation => operation.kind === 'styleBlock'
  );
  // Hardening: any operation kind not consumed above must not be silently dropped.
  if (
    textOperations.length +
      styleOperations.length +
      attributeOperations.length +
      styleBlockOperations.length !==
    txn.operations.length
  ) {
    throw new DesignEditError(
      'INVALID_VALUE',
      'The transaction contains an unsupported operation kind.'
    );
  }

  // Same-name attribute operations merge in order; the last one wins.
  const attributeFold = new Map<DesignAttributeName, string | null>();
  for (const operation of attributeOperations) {
    attributeFold.set(operation.name, operation.value);
  }

  const splices: Splice[] = [];
  // Multiple text operations in one transaction: the last one wins.
  const lastTextOperation = textOperations.at(-1);
  if (lastTextOperation) {
    splices.push(buildTextSplice(element, lastTextOperation, txn.locator));
  }

  const styleFold = buildStyleFold(source, element, styleOperations);
  if (styleFold.splice) splices.push(styleFold.splice);

  for (const [name, value] of attributeFold) {
    const splice = buildAttributeSplice(source, element, name, value);
    if (splice) splices.push(splice);
  }

  // <style> block declaration edits target the source by (block, rule, property),
  // independent of the selected element; their splices join the same array.
  splices.push(...buildStyleBlockSplices(source, styleBlockOperations));

  if (
    splices.length === 0 ||
    splices.every(splice => source.slice(splice.start, splice.end) === splice.replacement)
  ) {
    throw new DesignEditError('EMPTY_TRANSACTION', 'The transaction does not change the source.');
  }

  const nextSource = applySplices(source, splices);

  const nextRevision = await sha256Hex(nextSource);

  const selection: DesignSelection = { ...txn.locator, base: nextRevision };
  if (lastTextOperation) {
    selection.text = lastTextOperation.value;
    selection.sourceText = lastTextOperation.value.trim();
  }
  for (const [property, value] of styleFold.applied) {
    const key = SELECTION_STYLE_KEYS[property];
    if (key) selection[key] = value;
  }
  for (const property of styleFold.cleared) {
    const key = SELECTION_STYLE_KEYS[property];
    if (key) delete selection[key];
  }
  if (attributeFold.size > 0) {
    selection.attrs = { ...txn.locator.attrs };
    for (const [name, value] of attributeFold) {
      if (value === null) delete selection.attrs[name];
      else selection.attrs[name] = value;
    }
    if (Object.keys(selection.attrs).length === 0) delete selection.attrs;
  }

  return { source: nextSource, revision: nextRevision, selection };
}
