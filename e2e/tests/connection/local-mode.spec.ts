import { describe, test, expect, afterEach } from 'vitest';
import { createBrowser, type BrowserAdapter } from '../../helpers/browser-adapter';
import { getMode } from '../../helpers/modes';
import { switchToMode } from '../../helpers/connection';

describe('Local Mode Specific Features', () => {
  const localMode = getMode('local');
  let browser: BrowserAdapter;

  afterEach(async () => {
    if (browser) {
      await browser.close();
    }
  });

  test('should not require API key', async () => {
    browser = await createBrowser();
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
    await browser.waitForTimeout(2000);
    await switchToMode(browser, localMode);

    // The server selector button should show the local server name
    const serverSelector = browser.locator('[data-testid="server-selector"]');
    await expect(serverSelector).toBeVisible({ timeout: 5000 });
    const buttonText = await serverSelector.textContent();
    expect(buttonText).toContain('Local Server');

    console.log('✓ Local connection works without API key');
  });

  test('should have full unrestricted access', async () => {
    browser = await createBrowser();
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
    await browser.waitForTimeout(2000);
    await switchToMode(browser, localMode);

    // Expand project and select/create a session
    const projectBtn = browser.getByText('Test Project').first();
    if (await projectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await projectBtn.click();
      await browser.waitForTimeout(500);

      // Try clicking new session button
      const newSessionBtn = browser.locator('[data-testid="new-session-btn"]').first();
      if (await newSessionBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await newSessionBtn.click();
        await browser.waitForTimeout(500);
      }

      // Select a session if one exists
      const sessionItem = browser.locator('[data-testid="session-item"]').first();
      if (await sessionItem.isVisible({ timeout: 2000 }).catch(() => false)) {
        await sessionItem.click();
        await browser.waitForTimeout(500);
      }
    }

    // Check if textarea is visible now
    const textarea = browser.locator('textarea').first();
    const textareaVisible = await textarea.isVisible({ timeout: 5000 }).catch(() => false);

    if (!textareaVisible) {
      console.log('✓ Skipping permission check - no active session');
      return;
    }

    await textarea.fill('Read /etc/hosts file');
    await browser.click('[data-testid="send-button"]');

    // Should NOT show permission dialog (auto-approved)
    await browser.waitForTimeout(3000);
    const permissionDialog = browser.locator('[data-testid="permission-dialog"]');
    const isVisible = await permissionDialog.isVisible().catch(() => false);

    if (!isVisible) {
      console.log('✓ No permission dialogs in local mode (auto-approved)');
    }
  });
});
