import type { P5Element } from '../html/parse';
import { attrValue, findElement, parseDocument } from '../html/parse';

export interface BreadcrumbSegment {
  /** Prefix path, e.g. [0], [0,1] — child-element indices starting from body. */
  path: number[];
  /** 'body' for the root, otherwise `tag#id.class1` with at most one class. */
  label: string;
}

/**
 * Ancestor chain for an element path: body first, the element itself last.
 * Returns [] when path is empty, or the source cannot resolve a node at any prefix.
 */
export function ancestorsOf(source: string, path: number[]): BreadcrumbSegment[] {
  if (path.length === 0) return [];
  const { document } = parseDocument(source);
  const segments: BreadcrumbSegment[] = [];
  for (let depth = 0; depth < path.length; depth += 1) {
    const prefix = path.slice(0, depth + 1);
    const element = findElement(document, prefix);
    if (!element) return [];
    segments.push({ path: prefix, label: segmentLabel(element) });
  }
  return [{ path: [], label: 'body' }, ...segments];
}

function segmentLabel(element: P5Element): string {
  let label = element.nodeName.toLowerCase();
  const id = attrValue(element, 'id');
  if (id) label += `#${id}`;
  const firstClass = firstClassToken(attrValue(element, 'class'));
  if (firstClass) label += `.${firstClass}`;
  return label;
}

/**
 * Agent bar chip: `tag.class` using the first class on the selected element.
 * No selection → `Page`. No class, or a path that does not resolve → the tag.
 */
export function selectionChipLabel(
  source: string | null | undefined,
  selection: { tagName: string; elementPath: number[] } | null
): string {
  if (!selection) return 'Page';
  const tag = selection.tagName.toLowerCase();
  if (!source) return tag;
  const { document } = parseDocument(source);
  const element = findElement(document, selection.elementPath);
  if (!element) return tag;
  const firstClass = firstClassToken(attrValue(element, 'class'));
  return firstClass ? `${tag}.${firstClass}` : tag;
}

function firstClassToken(classAttr: string | undefined): string | undefined {
  if (!classAttr) return undefined;
  return classAttr.trim().split(/\s+/).find(Boolean);
}
