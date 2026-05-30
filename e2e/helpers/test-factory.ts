/**
 * Parameterized test factory for multi-mode testing
 *
 * Replaces Playwright's test-factory with Vitest-compatible implementation.
 */
import { test } from 'vitest';
import { getEnabledModes, type ModeConfig } from './modes';
import { switchToMode, verifyMode, ensureActiveSession } from './connection';
import { BrowserAdapter, createBrowser } from './browser-adapter';

/**
 * Wait for the app to be fully loaded and ready
 */
async function waitForAppReady(browser: BrowserAdapter) {
  await browser.goto('/');
  await browser.waitForLoadState('networkidle');
  await browser.waitForTimeout(500);
}

/**
 * Create parameterized tests that run on all enabled modes
 */
export function testAllModes(
  description: string,
  testFn: (browser: BrowserAdapter, mode: ModeConfig) => Promise<void>
) {
  const enabledModes = getEnabledModes();

  for (const mode of enabledModes) {
    test(`${description} [${mode.name}]`, async () => {
      const browser = await createBrowser();
      try {
        await waitForAppReady(browser);
        await switchToMode(browser, mode);
        await verifyMode(browser, mode);
        await ensureActiveSession(browser);
        await testFn(browser, mode);
      } finally {
        await browser.close();
      }
    });
  }
}

/**
 * Create parameterized tests for specific modes only
 */
export function testModes(
  modeIds: string[],
  description: string,
  testFn: (browser: BrowserAdapter, mode: ModeConfig) => Promise<void>
) {
  const enabledModes = getEnabledModes().filter(m => modeIds.includes(m.id));

  for (const mode of enabledModes) {
    test(`${description} [${mode.name}]`, async () => {
      const browser = await createBrowser();
      try {
        await waitForAppReady(browser);
        await switchToMode(browser, mode);
        await verifyMode(browser, mode);
        await ensureActiveSession(browser);
        await testFn(browser, mode);
      } finally {
        await browser.close();
      }
    });
  }
}
