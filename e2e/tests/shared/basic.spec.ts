import { describe, test, expect, afterEach } from 'vitest';
import { createBrowser, type BrowserAdapter } from '../../helpers/browser-adapter';

/**
 * Basic smoke test to verify the framework works
 * Uses the default local server (no mode switching)
 */
describe('Basic Framework Test', () => {
  let browser: BrowserAdapter;

  afterEach(async () => {
    if (browser) {
      await browser.close();
    }
  });

  test('should load app and connect to local server', async () => {
    browser = await createBrowser();
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
    await browser.waitForTimeout(2000);

    // Verify we can see the main UI elements
    const bodyText = await browser.textContent('body');
    expect(bodyText).toBeTruthy();

    // Verify server selector is present
    const serverSelector = browser.locator('[data-testid="server-selector"]');
    await expect(serverSelector).toBeVisible({ timeout: 10000 });

    console.log('✓ App loaded successfully');
  });

  test('should have server selector visible', async () => {
    browser = await createBrowser();
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
    await browser.waitForTimeout(2000);

    // Check for server selector
    const serverSelector = browser.locator('[data-testid="server-selector"]');
    await expect(serverSelector).toBeVisible({ timeout: 10000 });

    console.log('✓ Server selector is visible');
  });
});
