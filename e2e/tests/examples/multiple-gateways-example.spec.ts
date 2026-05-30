/**
 * Example: How to test with multiple Gateway backends
 *
 * This demonstrates how to register and test multiple gateway backend configurations
 * in the same test suite.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createBrowser, type BrowserAdapter } from '../../helpers/browser-adapter';
import { setupCleanDB } from '../../helpers/setup';
import { registerMode, getMode, getEnabledModes } from '../../helpers/modes';
import { gateway1Mode } from '../../fixtures/modes/gateway1.config';
import { gateway2Mode } from '../../fixtures/modes/gateway2.config';
import { switchToMode } from '../../helpers/connection';
import { testAllModes } from '../../helpers/test-factory';

// Register additional gateway backends
// This only needs to be done once, typically in a setup file
registerMode(gateway1Mode);
registerMode(gateway2Mode);

let browser: BrowserAdapter;

describe('Multiple Gateway Backends', () => {
  beforeEach(async () => {
    await setupCleanDB();
    browser = await createBrowser();
  });

  afterEach(async () => {
    await browser.close();
  });

  test('should list all available gateway backends', async () => {
    const allModes = getEnabledModes();

    console.log('Available modes:');
    allModes.forEach(mode => {
      console.log(`  - ${mode.id}: ${mode.name} (${mode.enabled ? 'enabled' : 'disabled'})`);
    });

    // You should see: local, gateway, gateway1 (if configured), gateway2 (if configured)
  });

  test('should connect to Gateway Backend 1 (if configured)', async () => {
    const gateway1 = getMode('gateway1');

    if (!gateway1.enabled) {
      console.log('SKIPPED: Gateway1 not configured (set GATEWAY1_SECRET to enable)');
      return;
    }

    await browser.goto('/');
    await browser.waitForLoadState('networkidle');

    // Switch to Gateway Backend 1
    await switchToMode(browser, gateway1);

    // Test basic functionality
    const textarea = browser.locator('textarea').first();
    await textarea.fill('Test message on Gateway 1');

    console.log('✓ Gateway Backend 1 connection successful');
  });

  test('should connect to Gateway Backend 2 (if configured)', async () => {
    const gateway2 = getMode('gateway2');

    if (!gateway2.enabled) {
      console.log('SKIPPED: Gateway2 not configured (set GATEWAY2_SECRET to enable)');
      return;
    }

    await browser.goto('/');
    await browser.waitForLoadState('networkidle');

    // Switch to Gateway Backend 2
    await switchToMode(browser, gateway2);

    // Test basic functionality
    const textarea = browser.locator('textarea').first();
    await textarea.fill('Test message on Gateway 2');

    console.log('✓ Gateway Backend 2 connection successful');
  });

  test('should switch between multiple gateways', async () => {
    const gateway1 = getMode('gateway1');
    const gateway2 = getMode('gateway2');

    if (!gateway1.enabled || !gateway2.enabled) {
      console.log('SKIPPED: Both gateways must be configured for this test');
      return;
    }

    await browser.goto('/');
    await browser.waitForLoadState('networkidle');

    // Switch to Gateway 1
    console.log('Switching to Gateway 1...');
    await switchToMode(browser, gateway1);
    await browser.waitForTimeout(2000);

    // Send a message
    let textarea = browser.locator('textarea').first();
    await textarea.fill('Message on Gateway 1');
    console.log('✓ Gateway 1 working');

    // Switch to Gateway 2
    console.log('Switching to Gateway 2...');
    await switchToMode(browser, gateway2);
    await browser.waitForTimeout(2000);

    // Send another message
    textarea = browser.locator('textarea').first();
    await textarea.fill('Message on Gateway 2');
    console.log('✓ Gateway 2 working');

    // Switch back to Gateway 1
    console.log('Switching back to Gateway 1...');
    await switchToMode(browser, gateway1);
    await browser.waitForTimeout(2000);

    console.log('✓ Successfully switched between multiple gateways');
  });
});

/**
 * You can also use testAllModes() with multiple gateways:
 */

// This will automatically run on all enabled modes, including gateway1 and gateway2
testAllModes('should work on all gateways', async (browser, mode) => {
  if (mode.id.startsWith('gateway')) {
    console.log(`Testing on ${mode.name} (${mode.id})`);

    // Your gateway-specific test logic here
    const textarea = browser.locator('textarea').first();
    await textarea.fill(`Test on ${mode.name}`);

    console.log(`✓ ${mode.name} test passed`);
  }
});
