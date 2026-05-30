import { describe, test, expect, afterEach } from 'vitest';
import { createBrowser, type BrowserAdapter } from '../../helpers/browser-adapter';
import { getEnabledModes } from '../../helpers/modes';
import { switchToMode, verifyMode } from '../../helpers/connection';

describe('Mode Switching', () => {
  const modes = getEnabledModes();
  let browser: BrowserAdapter;

  afterEach(async () => {
    if (browser) {
      await browser.close();
    }
  });

  test('should switch between all available modes', async () => {
    browser = await createBrowser();
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
    await browser.waitForTimeout(2000);

    for (const mode of modes) {
      console.log(`Switching to ${mode.name}...`);

      await switchToMode(browser, mode);
      await verifyMode(browser, mode);

      console.log(`✓ ${mode.name} working`);
    }

    console.log('✓ All mode switches successful');
  });

  test.skipIf(modes.length < 2)('should maintain server selector after switching', async () => {
    browser = await createBrowser();
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
    await browser.waitForTimeout(2000);

    // Switch to first mode
    await switchToMode(browser, modes[0]);

    // Verify server selector shows mode name
    const serverSelector = browser.locator('[data-testid="server-selector"]');
    const text1 = await serverSelector.textContent();
    expect(text1).toContain(modes[0].name);

    // Switch to second mode
    await switchToMode(browser, modes[1]);

    // Verify server selector shows new mode name
    const text2 = await serverSelector.textContent();
    expect(text2).toContain(modes[1].name);

    console.log('✓ Server selector updates correctly when switching modes');
  });
});
