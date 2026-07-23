// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { trapTab, getFocusable } from '../focusTrap';

// jsdom has no layout, so getClientRects() is empty for every element. The
// helper filters on visibility via getClientRects, so mark elements "visible"
// by stubbing it to return a non-empty list.
function visible<T extends HTMLElement>(el: T): T {
  el.getClientRects = () => [{} as DOMRect] as unknown as DOMRectList;
  return el;
}

function tabEvent(shiftKey: boolean): React.KeyboardEvent {
  let defaultPrevented = false;
  return {
    key: 'Tab',
    shiftKey,
    preventDefault: () => {
      defaultPrevented = true;
    },
    get defaultPrevented() {
      return defaultPrevented;
    },
  } as unknown as React.KeyboardEvent;
}

describe('focusTrap', () => {
  let dialog: HTMLDivElement;
  let first: HTMLButtonElement;
  let last: HTMLButtonElement;

  beforeEach(() => {
    dialog = document.createElement('div');
    dialog.tabIndex = -1;
    first = visible(document.createElement('button'));
    first.textContent = 'first';
    last = visible(document.createElement('button'));
    last.textContent = 'last';
    dialog.append(first, last);
    document.body.appendChild(visible(dialog));
  });

  afterEach(() => {
    dialog.remove();
  });

  it('getFocusable returns visible tabbable elements in order', () => {
    const found = getFocusable(dialog);
    expect(found).toEqual([first, last]);
  });

  it('getFocusable skips disabled and hidden elements', () => {
    const disabled = visible(document.createElement('button'));
    disabled.disabled = true;
    const hidden = document.createElement('button'); // no visible() → no rects
    dialog.append(disabled, hidden);
    expect(getFocusable(dialog)).toEqual([first, last]);
  });

  it('Tab on the last element wraps to the first', () => {
    last.focus();
    const e = tabEvent(false);
    trapTab(e, dialog);
    expect(document.activeElement).toBe(first);
    expect(e.defaultPrevented).toBe(true);
  });

  it('Shift+Tab on the first element wraps to the last', () => {
    first.focus();
    const e = tabEvent(true);
    trapTab(e, dialog);
    expect(document.activeElement).toBe(last);
    expect(e.defaultPrevented).toBe(true);
  });

  it('Tab in the middle is left to the browser', () => {
    first.focus();
    const e = tabEvent(false);
    trapTab(e, dialog);
    expect(document.activeElement).toBe(first);
    expect(e.defaultPrevented).toBe(false);
  });

  it('Tab from the dialog shell (no inner focus yet) enters via wrap', () => {
    dialog.focus();
    const e = tabEvent(true);
    trapTab(e, dialog);
    expect(document.activeElement).toBe(last);
  });

  it('ignores non-Tab keys and a null container', () => {
    first.focus();
    const enter = { key: 'Enter', preventDefault: () => {} } as unknown as React.KeyboardEvent;
    trapTab(enter, dialog);
    expect(document.activeElement).toBe(first);
    // null container must not throw
    expect(() => trapTab(tabEvent(false), null)).not.toThrow();
  });
});
