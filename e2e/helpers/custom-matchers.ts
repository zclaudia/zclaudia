/**
 * Custom Vitest matchers for BrowserAdapter / LocatorAdapter
 *
 * Replaces Playwright's built-in expect(locator).toBeVisible() etc.
 */
import { expect } from 'vitest';
import type { LocatorAdapter } from './browser-adapter';
import type { BrowserAdapter } from './browser-adapter';

interface CustomMatchers<R = unknown> {
  toBeVisible(opts?: { timeout?: number }): Promise<R>;
  toContainText(text: string, opts?: { timeout?: number }): Promise<R>;
  toHaveText(text: string | RegExp, opts?: { timeout?: number }): Promise<R>;
  toHaveTitle(title: string | RegExp): Promise<R>;
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion<T = any> extends CustomMatchers<T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}

expect.extend({
  async toBeVisible(received: LocatorAdapter, opts?: { timeout?: number }) {
    const timeout = opts?.timeout ?? 5000;
    const startTime = Date.now();
    let visible = false;

    while (Date.now() - startTime < timeout) {
      visible = await received.isVisible();
      if (visible) break;
      await new Promise(r => setTimeout(r, 100));
    }

    return {
      pass: visible,
      message: () =>
        visible
          ? `Expected element NOT to be visible, but it was`
          : `Expected element to be visible within ${timeout}ms, but it was not`,
    };
  },

  async toContainText(received: LocatorAdapter, text: string, opts?: { timeout?: number }) {
    const timeout = opts?.timeout ?? 5000;
    const startTime = Date.now();
    let lastContent: string | null = null;

    while (Date.now() - startTime < timeout) {
      lastContent = await received.textContent();
      if (lastContent?.includes(text)) {
        return {
          pass: true,
          message: () => `Expected element NOT to contain text "${text}", but it did`,
        };
      }
      await new Promise(r => setTimeout(r, 100));
    }

    return {
      pass: false,
      message: () =>
        `Expected element to contain text "${text}" within ${timeout}ms, but got "${lastContent}"`,
    };
  },

  async toHaveText(received: LocatorAdapter, text: string | RegExp, opts?: { timeout?: number }) {
    const timeout = opts?.timeout ?? 5000;
    const startTime = Date.now();
    let lastContent: string | null = null;

    while (Date.now() - startTime < timeout) {
      lastContent = await received.textContent();
      if (lastContent !== null) {
        const trimmed = lastContent.trim();
        if (text instanceof RegExp) {
          if (text.test(trimmed)) {
            return { pass: true, message: () => `Expected element NOT to match ${text}` };
          }
        } else if (trimmed === text) {
          return { pass: true, message: () => `Expected element NOT to have text "${text}"` };
        }
      }
      await new Promise(r => setTimeout(r, 100));
    }

    return {
      pass: false,
      message: () =>
        `Expected element to have text "${text}" within ${timeout}ms, but got "${lastContent}"`,
    };
  },

  async toHaveTitle(received: BrowserAdapter, title: string | RegExp) {
    const actualTitle = await received.title();
    const pass = title instanceof RegExp ? title.test(actualTitle) : actualTitle === title;

    return {
      pass,
      message: () =>
        pass
          ? `Expected page NOT to have title "${title}", but it did`
          : `Expected page to have title "${title}", but got "${actualTitle}"`,
    };
  },
});
