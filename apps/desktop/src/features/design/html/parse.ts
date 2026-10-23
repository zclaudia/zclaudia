import { parse, type DefaultTreeAdapterMap } from 'parse5';

export type P5Document = DefaultTreeAdapterMap['document'];
export type P5Element = DefaultTreeAdapterMap['element'];
export type P5ParentNode = DefaultTreeAdapterMap['parentNode'];

/** Half-open [start, end) range of offsets into the original source string. */
export interface Span {
  start: number;
  end: number;
}

export interface DesignParseError {
  code: string;
  startOffset: number;
  endOffset: number;
}

export interface ParsedDocument {
  document: P5Document;
  body: P5Element | null;
  errors: DesignParseError[];
}

/** Parse HTML keeping source code locations and collecting parse errors. */
export function parseDocument(source: string): ParsedDocument {
  const errors: DesignParseError[] = [];
  const document = parse(source, {
    sourceCodeLocationInfo: true,
    onParseError: error => {
      errors.push({ code: error.code, startOffset: error.startOffset, endOffset: error.endOffset });
    },
  });
  return { document, body: findBody(document), errors };
}

/** Child elements of a node, skipping text/comment/doctype nodes. */
export function childElements(node: P5ParentNode): P5Element[] {
  return (node.childNodes ?? []).filter(
    (child): child is P5Element => !child.nodeName.startsWith('#')
  );
}

/** Type guard for parse5 text nodes. */
export function isTextNode(node: DefaultTreeAdapterMap['childNode']): node is DefaultTreeAdapterMap['textNode'] {
  return node.nodeName === '#text';
}

/** The body element of a parsed document (may be implicitly created, without a source location). */
export function findBody(document: P5Document): P5Element | null {
  const html = childElements(document).find(el => el.nodeName === 'html');
  if (!html) return null;
  return childElements(html).find(el => el.nodeName === 'body') ?? null;
}

/**
 * Walk element children from the document body following `path`
 * ("body 起的子元素序号"). Returns null when the path leaves the tree.
 */
export function findElement(document: P5Document, path: number[]): P5Element | null {
  let node: P5Element | null = findBody(document);
  if (!node) return null;
  for (const index of path) {
    if (!Number.isSafeInteger(index) || index < 0 || !node) return null;
    const children = childElements(node);
    const next = children[index];
    if (!next) return null;
    node = next;
  }
  return node;
}

/** Full span of an element (start of start tag to end of end tag), or null for implicit nodes. */
export function elementSpan(el: P5Element): Span | null {
  const loc = el.sourceCodeLocation;
  if (!loc) return null;
  return { start: loc.startOffset, end: loc.endOffset };
}

/** Span of the element's start tag, or null for implicit nodes. */
export function startTagSpan(el: P5Element): Span | null {
  const startTag = el.sourceCodeLocation?.startTag;
  if (!startTag) return null;
  return { start: startTag.startOffset, end: startTag.endOffset };
}

/**
 * Full span of an attribute inside the start tag (including quotes and the name),
 * e.g. `style="color: red"`. parse5 exposes it on the start tag location.
 */
export function attributeSpan(el: P5Element, name: string): Span | null {
  for (const map of attrLocationMaps(el)) {
    const attrLoc = map[name];
    if (attrLoc) return { start: attrLoc.startOffset, end: attrLoc.endOffset };
  }
  return null;
}

/** Decoded attribute value from the element's attribute list. */
export function attrValue(el: P5Element, name: string): string | undefined {
  return el.attrs.find(attr => attr.name === name)?.value;
}

/**
 * Span covering all text-node children of an element (first start to last end).
 * Returns null when there are no text children or a location is missing.
 */
export function textChildSpan(el: P5Element): Span | null {
  const texts = el.childNodes.filter(child => child.nodeName === '#text');
  if (texts.length === 0) return null;
  const first = texts[0]?.sourceCodeLocation;
  const last = texts[texts.length - 1]?.sourceCodeLocation;
  if (!first || !last) return null;
  return { start: first.startOffset, end: last.endOffset };
}

/**
 * Offset just before the `>` that closes the start tag — before the `/` for
 * self-closing tags (`<hr/>`), so insertions land inside the tag.
 */
export function startTagInsertOffset(source: string, el: P5Element): number | null {
  const startTag = el.sourceCodeLocation?.startTag;
  if (!startTag) return null;
  const close = startTag.endOffset - 1;
  if (source[close - 1] === '/') return close - 1;
  return close;
}

/**
 * Offset at which a new attribute can be inserted: after the last existing
 * attribute span when the start tag has attributes, otherwise before the
 * closing `>` (or the `/` of a self-closing tag).
 */
export function newAttributeInsertOffset(source: string, el: P5Element): number | null {
  const startTag = el.sourceCodeLocation?.startTag;
  if (!startTag) return null;
  const spans: OffsetSpan[] = [];
  for (const map of attrLocationMaps(el)) spans.push(...Object.values(map));
  if (spans.length > 0) return Math.max(...spans.map(span => span.endOffset));
  return startTagInsertOffset(source, el);
}

interface OffsetSpan {
  startOffset: number;
  endOffset: number;
}

type AttrLocationMap = Record<string, OffsetSpan>;

/**
 * Attribute span maps of an element. parse5 v8 (verified at runtime) exposes
 * them both on the element location and on its start tag location, although
 * the shipped `.d.ts` only types the former.
 */
function attrLocationMaps(el: P5Element): AttrLocationMap[] {
  const loc = el.sourceCodeLocation;
  if (!loc) return [];
  const maps: AttrLocationMap[] = [];
  if (loc.attrs) maps.push(loc.attrs as AttrLocationMap);
  const startTagAttrs = (loc.startTag as ElementLocationWithAttrs | undefined)?.attrs;
  if (startTagAttrs) maps.push(startTagAttrs);
  return maps;
}

interface ElementLocationWithAttrs extends OffsetSpan {
  attrs?: AttrLocationMap;
}
