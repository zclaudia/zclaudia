import { describe, test, expect, afterEach } from 'vitest';
import { createBrowser, type BrowserAdapter } from '../../helpers/browser-adapter';
import { getMode } from '../../helpers/modes';
import { switchToMode, fetchGatewayBackendId } from '../../helpers/connection';

describe('Gateway Mode Specific Features', () => {
  const gatewayMode = getMode('gateway');
  let browser: BrowserAdapter;

  afterEach(async () => {
    if (browser) {
      await browser.close();
    }
  });

  test('should connect through gateway relay', async () => {
    browser = await createBrowser();
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
    await browser.waitForTimeout(2000);

    // Fetch backend ID dynamically
    if (!gatewayMode.backendId) {
      try {
        gatewayMode.backendId = await fetchGatewayBackendId(gatewayMode.apiKey!);
      } catch {
        return; // Skip - Gateway backend not registered
      }
    }

    await switchToMode(browser, gatewayMode);

    // Verify the server selector shows the gateway mode name
    const serverSelector = browser.locator('[data-testid="server-selector"]');
    await expect(serverSelector).toBeVisible({ timeout: 5000 });
    const buttonText = await serverSelector.textContent();
    expect(buttonText).toContain('Gateway Mode');

    console.log('✓ Gateway relay connection successful');
  });

  test.skip('should configure SOCKS5 proxy', async () => {
    // Gateway tab is only visible in local mode (isLocalServer === true).
    // When connected via Gateway, isLocalConnection is false, so the tab is hidden.
    // Gateway tab only visible in local mode - proxy config tested via API
  });

  test.skip('should save and update proxy credentials', async () => {
    // Gateway tab is only visible in local mode (isLocalServer === true).
    // When connected via Gateway, isLocalConnection is false, so the tab is hidden.
    // Gateway tab only visible in local mode - proxy config tested via API
  });
});
