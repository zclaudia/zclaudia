import { useLayoutEffect, type RefObject } from 'react';

/**
 * Shared inline style for highlight marks. Mirrors the code view's highlight
 * colors (see FileViewerPanel's `renderTokenWithMatches`) so in-file search
 * looks consistent across rendered code and rendered markdown.
 */
const MARK_STYLE = 'background-color: hsl(var(--primary) / 0.25); color: inherit;';
const MARK_ACTIVE_STYLE = 'background-color: hsl(var(--primary) / 0.45); color: inherit;';
export const MARK_CLASS = 'search-mark';
export const MARK_ACTIVE_CLASS = 'search-mark-active';

/** Skip text inside nodes that shouldn't be matched or visually altered. */
function isSkippableElement(node: Element | null): boolean {
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT';
}

/**
 * Walk the text nodes under `root`, wrapping every occurrence of `query` in a
 * `<mark class="search-mark">` element tagged with `data-match-index` (0-based,
 * in document order). Returns the created marks so the caller can scroll to /
 * style the active one.
 *
 * Pure DOM helper — no React — so it is straightforward to unit test. Each call
 * is expected to be preceded by clearing prior highlights (see
 * `clearHighlights`); this function does not mutate existing marks.
 */
export function highlightTextNodes(
  root: HTMLElement,
  query: string,
  caseSensitive = false
): HTMLElement[] {
  if (!query) return [];

  const flags = caseSensitive ? 'g' : 'gi';
  // Escape regex metacharacters so the query is treated as a literal string.
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, flags);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      // Skip our own previously-created marks and non-content elements.
      if (parent.classList?.contains(MARK_CLASS)) return NodeFilter.FILTER_REJECT;
      if (isSkippableElement(parent)) return NodeFilter.FILTER_REJECT;
      return node.nodeValue && re.test(node.nodeValue)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const targets: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    targets.push(current as Text);
    // Reset because the global regex carried lastIndex during the acceptNode test.
    re.lastIndex = 0;
    current = walker.nextNode();
  }

  const marks: HTMLElement[] = [];
  for (const textNode of targets) {
    const text = textNode.nodeValue ?? '';
    re.lastIndex = 0;
    const matches: { index: number; length: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      matches.push({ index: m.index, length: m[0].length });
      if (m[0].length === 0) re.lastIndex++; // guard against zero-length matches
    }
    if (matches.length === 0) continue;

    const parent = textNode.parentElement;
    if (!parent) continue;

    let cursor = 0;
    for (const { index, length } of matches) {
      if (index > cursor) {
        parent.insertBefore(document.createTextNode(text.slice(cursor, index)), textNode);
      }
      const mark = document.createElement('mark');
      mark.className = MARK_CLASS;
      mark.setAttribute('style', MARK_STYLE);
      mark.setAttribute('data-match-index', String(marks.length));
      mark.textContent = text.slice(index, index + length);
      parent.insertBefore(mark, textNode);
      marks.push(mark);
      cursor = index + length;
    }
    if (cursor < text.length) {
      parent.insertBefore(document.createTextNode(text.slice(cursor)), textNode);
    }
    parent.removeChild(textNode);
  }

  return marks;
}

/**
 * Remove every `<mark class="search-mark">` under `root`, replacing each with
 * its text content and merging adjacent text nodes via `normalize()`. Safe to
 * call when nothing is highlighted.
 */
export function clearHighlights(root: HTMLElement): void {
  const existing = root.querySelectorAll(`mark.${MARK_CLASS}`);
  existing.forEach(mark => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  });
}

/**
 * React hook that highlights all occurrences of `query` inside the element
 * referenced by `rootRef`, marks `marks[activeIndex]` as active, and scrolls it
 * into view. Re-runs whenever any dep changes; on cleanup (or before re-running)
 * it clears prior highlights.
 *
 * `contentSignature` should change whenever the rendered content changes (e.g.
 * the markdown source) so highlights are recomputed after React re-renders new
 * text. It is otherwise unused.
 */
export function useTextHighlight(
  rootRef: RefObject<HTMLElement | null>,
  query: string,
  caseSensitive: boolean,
  activeIndex: number,
  contentSignature: string
): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !query) {
      // Even with no query, clear any leftovers from a previous search.
      if (root) clearHighlights(root);
      return;
    }

    clearHighlights(root);
    const marks = highlightTextNodes(root, query, caseSensitive);
    if (marks.length === 0) return;

    const clamped = Math.max(0, Math.min(activeIndex, marks.length - 1));
    const active = marks[clamped];
    active.setAttribute('style', MARK_ACTIVE_STYLE);
    active.classList.add(MARK_ACTIVE_CLASS);
    try {
      active.scrollIntoView({ block: 'center', behavior: 'auto' });
    } catch {
      // scrollIntoView can throw in some test/non-DOM environments; ignore.
    }

    return () => {
      clearHighlights(root);
    };
  }, [rootRef, query, caseSensitive, activeIndex, contentSignature]);
}
