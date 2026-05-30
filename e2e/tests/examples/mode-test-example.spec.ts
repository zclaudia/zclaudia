/**
 * Example: How to use the cross-mode testing framework
 *
 * This file demonstrates the testAllModes() pattern which automatically
 * runs the same test across all enabled connection modes (Local, Remote IP, Gateway)
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createBrowser, type BrowserAdapter } from '../../helpers/browser-adapter';
import { setupCleanDB } from '../../helpers/setup';
import { testAllModes, testModes } from '../../helpers/test-factory';
import { getMode } from '../../helpers/modes';
import { switchToMode } from '../../helpers/connection';

// Example 1: Test that runs in ALL enabled modes
testAllModes('can access main UI elements', async (browser, mode) => {
  // At this point:
  // - Page is loaded
  // - Connection is established
  // - Mode is verified

  // Your test logic here - it will run once per enabled mode
  const serverSelector = browser.locator('[data-testid="server-selector"]').first();
  await expect(serverSelector.isVisible()).resolves.toBe(true);

  console.log(`✓ UI accessible in ${mode.name}`);
});

// Example 2: Test that only runs in specific modes
testModes(['local', 'gateway'], 'can create project without API key validation', async (browser, mode) => {
  // This test only runs in Local and Gateway modes
  // (skipped in Remote mode which has stricter auth)

  const addProjectBtn = browser.locator('button[title="Add Project"]');
  if (await addProjectBtn.isVisible({ timeout: 3000 })) {
    await addProjectBtn.click();
    console.log(`✓ Project creation available in ${mode.name}`);
  }
});

// Example 3: For simpler cases, you can also use regular tests
// and manually call connection helpers if needed
let browser: BrowserAdapter;

describe('Manual mode switching', () => {
  beforeEach(async () => {
    await setupCleanDB();
    browser = await createBrowser();
  });

  afterEach(async () => {
    await browser.close();
  });

  test('manual mode switching example', async () => {
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');

    // Get a specific mode
    const gatewayMode = getMode('gateway');

    // Manually switch to it
    if (gatewayMode.enabled) {
      await switchToMode(browser, gatewayMode);

      // Your test logic for gateway mode
      console.log('✓ Now testing in Gateway mode');
    }
  });
});
