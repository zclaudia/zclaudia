import { describe, test, expect, afterEach } from 'vitest';
import { createBrowser, type BrowserAdapter } from '../../helpers/browser-adapter';

/**
 * Minimal test - just navigate and check the page
 */
describe('Minimal', () => {
  let browser: BrowserAdapter;

  afterEach(async () => {
    await browser?.close();
  });

  test('minimal page load', async () => {
    browser = await createBrowser();
    await browser.goto('/');
    await browser.screenshot({ path: 'test-minimal-screenshot.png' });

    const title = await browser.title();
    console.log('Page title:', title);

    expect(title).toContain('Claudia');
  });
});
