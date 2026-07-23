import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as React from 'react';
import {
  highlightTextNodes,
  clearHighlights,
  MARK_CLASS,
  MARK_ACTIVE_CLASS,
  useTextHighlight,
} from '../useTextHighlight';

/**
 * JSDoc still runs useLayoutEffect synchronously, and the helpers below use real
 * DOM APIs (TreeWalker, splitText-style replacement, normalize) that JSDoc
 * supports, so these tests exercise the actual implementation rather than mocks.
 */

describe('highlightTextNodes', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    document.body.removeChild(root);
  });

  it('wraps every occurrence in a <mark> with sequential data-match-index', () => {
    root.innerHTML = '<p>foo bar foo</p>';
    const marks = highlightTextNodes(root, 'foo');
    expect(marks).toHaveLength(2);
    expect(marks.map(m => m.dataset.matchIndex)).toEqual(['0', '1']);
    expect(marks[0].textContent).toBe('foo');
    expect(marks[1].textContent).toBe('foo');
    expect(marks.every(m => m.classList.contains(MARK_CLASS))).toBe(true);
  });

  it('is case-insensitive by default', () => {
    root.innerHTML = '<p>Foo FOO foo</p>';
    const marks = highlightTextNodes(root, 'foo');
    expect(marks).toHaveLength(3);
    expect(marks.map(m => m.textContent)).toEqual(['Foo', 'FOO', 'foo']);
  });

  it('respects caseSensitive flag', () => {
    root.innerHTML = '<p>Foo FOO foo</p>';
    const marks = highlightTextNodes(root, 'foo', true);
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('foo');
  });

  it('treats regex metacharacters in the query as literals', () => {
    root.innerHTML = '<p>a.b + c.d</p>';
    const marks = highlightTextNodes(root, '.', false);
    expect(marks).toHaveLength(2);
    expect(marks.map(m => m.textContent)).toEqual(['.', '.']);
  });

  it('skips <script> and <style> content', () => {
    root.innerHTML = '<style>foo { color: red }</style><p>foo</p><script>foo</script>';
    const marks = highlightTextNodes(root, 'foo');
    // Only the <p>foo</p> match counts.
    expect(marks).toHaveLength(1);
  });

  it('preserves surrounding text when splitting a node', () => {
    root.innerHTML = '<p>alpha foo beta</p>';
    const marks = highlightTextNodes(root, 'foo');
    expect(marks).toHaveLength(1);
    expect(root.querySelector('p')?.textContent).toBe('alpha foo beta');
    expect(root.querySelector('p')?.firstChild?.textContent).toBe('alpha ');
    expect(root.querySelector('p')?.lastChild?.textContent).toBe(' beta');
  });

  it('returns [] and makes no changes when query is empty', () => {
    root.innerHTML = '<p>foo</p>';
    expect(highlightTextNodes(root, '')).toEqual([]);
    expect(root.innerHTML).toBe('<p>foo</p>');
  });

  it('returns [] when there is no match', () => {
    root.innerHTML = '<p>nothing here</p>';
    expect(highlightTextNodes(root, 'absent')).toEqual([]);
    expect(root.querySelector('p')?.textContent).toBe('nothing here');
  });
});

describe('clearHighlights', () => {
  it('unwraps marks back into plain text and merges adjacent text nodes', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>alpha foo beta</p>';
    highlightTextNodes(root, 'foo');
    expect(root.querySelectorAll('mark')).toHaveLength(1);

    clearHighlights(root);
    expect(root.querySelectorAll('mark')).toHaveLength(0);
    // Text content is fully restored.
    expect(root.querySelector('p')?.textContent).toBe('alpha foo beta');
    // normalize() merges the three text nodes back into one.
    expect(root.querySelector('p')?.childNodes.length).toBe(1);
  });

  it('is a no-op when there is nothing to clear', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>plain text</p>';
    expect(() => clearHighlights(root)).not.toThrow();
    expect(root.innerHTML).toBe('<p>plain text</p>');
  });
});

// Minimal harness for the hook: render a div whose ref we pass to useTextHighlight.
function HighlightBox({
  rootRef,
  query,
  caseSensitive,
  activeIndex,
}: {
  rootRef: React.RefObject<HTMLDivElement | null>;
  query: string;
  caseSensitive: boolean;
  activeIndex: number;
}) {
  useTextHighlight(rootRef, query, caseSensitive, activeIndex, 'sig');
  return (
    <div ref={rootRef}>
      <p>foo bar foo</p>
    </div>
  );
}

describe('useTextHighlight', () => {
  beforeEach(() => {
    // jsdom does not implement scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('highlights all matches and marks the active one', () => {
    const rootRef: React.RefObject<HTMLDivElement | null> = { current: null };
    render(<HighlightBox rootRef={rootRef} query="foo" caseSensitive={false} activeIndex={1} />);

    const marks = screen.getAllByText('foo');
    expect(marks).toHaveLength(2);
    // activeIndex 1 → second match is the active one.
    expect(marks[0].classList.contains(MARK_ACTIVE_CLASS)).toBe(false);
    expect(marks[1].classList.contains(MARK_ACTIVE_CLASS)).toBe(true);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('removes highlights when the query is cleared', () => {
    const rootRef: React.RefObject<HTMLDivElement | null> = { current: null };
    const { rerender } = render(
      <HighlightBox rootRef={rootRef} query="foo" caseSensitive={false} activeIndex={0} />
    );
    expect(screen.getAllByText('foo').length).toBeGreaterThan(0);

    rerender(<HighlightBox rootRef={rootRef} query="" caseSensitive={false} activeIndex={0} />);
    expect(screen.queryAllByClassName?.(MARK_CLASS) ?? []).toHaveLength(0);
    // The original text is still readable.
    expect(screen.getByText(/foo bar foo/)).toBeInTheDocument();
  });
});
