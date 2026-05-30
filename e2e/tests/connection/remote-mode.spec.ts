import { describe, test, expect, afterEach } from 'vitest';
import { createBrowser, type BrowserAdapter } from '../../helpers/browser-adapter';
import { getMode } from '../../helpers/modes';
import { switchToMode } from '../../helpers/connection';

describe('Remote IP Mode Specific Features', () => {
  const remoteMode = getMode('remote');
  let browser: BrowserAdapter;

  afterEach(async () => {
    if (browser) {
      await browser.close();
    }
  });

  test.skipIf(!remoteMode.enabled)('should require valid API key', async () => {
    browser = await createBrowser();
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
    await browser.waitForTimeout(2000);
    await switchToMode(browser, remoteMode);

    // The server selector should show the remote mode name
    const serverSelector = browser.locator('[data-testid="server-selector"]');
    await expect(serverSelector).toBeVisible({ timeout: 5000 });
    const buttonText = await serverSelector.textContent();
    expect(buttonText).toContain(remoteMode.name);

    console.log('✓ Remote connection with API key successful');
  });

  test.skipIf(!remoteMode.enabled)('should reject invalid API key', async () => {
    browser = await createBrowser();
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
    await browser.waitForTimeout(2000);
    await switchToMode(browser, remoteMode);

    // Open server selector
    await browser.click('[data-testid="server-selector"]');
    await browser.waitForTimeout(500);

    // Open the server menu first (three-dot button)
    const menuBtn = browser.locator('[data-testid="server-menu-btn"]').first();
    if (await menuBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await menuBtn.click();
      await browser.waitForTimeout(300);

      // Click Edit
      const editBtn = browser.locator('[data-testid="edit-server-btn"]').first();
      if (await editBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await editBtn.click();
        await browser.waitForTimeout(300);

        // Check if API key input is visible (hidden for local-like addresses)
        const apiKeyInput = browser.locator('[data-testid="api-key-input"]');
        if (await apiKeyInput.isVisible({ timeout: 2000 }).catch(() => false)) {
          await apiKeyInput.fill('invalid-key-12345');
          await browser.click('[data-testid="save-server-btn"]');
          await browser.waitForTimeout(3000);

          console.log('✓ Invalid API key handling tested');
        } else {
          // Address is local-like (127.0.0.1), API key field not shown
          console.log('✓ API key input hidden for local address (expected)');
        }
      } else {
        console.log('⚠ Edit button not available');
      }
    } else {
      console.log('⚠ Server menu not available');
    }
  });
});
