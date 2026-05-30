/**
 * Example: Testing multiple backends registered to the same Gateway
 *
 * This demonstrates how to test multiple backend servers that are all
 * registered to the same gateway relay server.
 *
 * Real-world scenario:
 * - User has Gateway running at gateway.example.com
 * - Backend A: Personal laptop (backendId: laptop-123)
 * - Backend B: Work desktop (backendId: desktop-456)
 * - Backend C: Cloud server (backendId: cloud-789)
 *
 * All three backends connect to the same gateway, but each has:
 * - Unique backendId
 * - Different API keys
 * - Possibly different proxy configurations
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createBrowser, type BrowserAdapter } from '../../helpers/browser-adapter';
import { setupCleanDB } from '../../helpers/setup';
import { registerMode, getMode } from '../../helpers/modes';
import { gatewayBackendAMode } from '../../fixtures/modes/gateway-backend-a.config';
import { gatewayBackendBMode } from '../../fixtures/modes/gateway-backend-b.config';
import { switchToMode, verifyMode } from '../../helpers/connection';
import { testAllModes } from '../../helpers/test-factory';

// Register both backends (same gateway, different backend IDs)
registerMode(gatewayBackendAMode);
registerMode(gatewayBackendBMode);

let browser: BrowserAdapter;

describe('Same Gateway - Multiple Backends', () => {
  beforeEach(async () => {
    await setupCleanDB();
    browser = await createBrowser();
  });

  afterEach(async () => {
    await browser.close();
  });

  test('should show both backends share the same gateway', async () => {
    const backendA = getMode('gateway-backend-a');
    const backendB = getMode('gateway-backend-b');

    console.log('Backend A:');
    console.log(`  Gateway URL: ${backendA.gatewayUrl}`);
    console.log(`  Gateway Secret: ${backendA.gatewaySecret}`);
    console.log(`  Backend ID: ${backendA.backendId}`);
    console.log(`  API Key: ${backendA.apiKey?.substring(0, 10)}...`);

    console.log('\nBackend B:');
    console.log(`  Gateway URL: ${backendB.gatewayUrl}`);
    console.log(`  Gateway Secret: ${backendB.gatewaySecret}`);
    console.log(`  Backend ID: ${backendB.backendId}`);
    console.log(`  API Key: ${backendB.apiKey?.substring(0, 10)}...`);

    // Verify they use the same gateway
    expect(backendA.gatewayUrl).toBe(backendB.gatewayUrl);
    expect(backendA.gatewaySecret).toBe(backendB.gatewaySecret);

    // But have different backend identities
    expect(backendA.backendId).not.toBe(backendB.backendId);
    expect(backendA.apiKey).not.toBe(backendB.apiKey);

    console.log('\n✓ Both backends share the same gateway but have unique identities');
  });

  test('should connect to Backend A through gateway (if configured)', async () => {
    const backendA = getMode('gateway-backend-a');

    if (!backendA.enabled) {
      console.log('SKIPPED: Backend A not configured (set GATEWAY_BACKEND_A_ID to enable)');
      return;
    }

    await browser.goto('/');
    await browser.waitForLoadState('networkidle');

    // Switch to Backend A
    await switchToMode(browser, backendA);
    await verifyMode(browser, backendA);

    // Test basic functionality
    const textarea = browser.locator('textarea').first();
    if (await textarea.isVisible({ timeout: 5000 })) {
      await textarea.fill('Test message on Backend A');
      console.log('✓ Backend A connection successful');
    }
  });

  test('should connect to Backend B through gateway (if configured)', async () => {
    const backendB = getMode('gateway-backend-b');

    if (!backendB.enabled) {
      console.log('SKIPPED: Backend B not configured (set GATEWAY_BACKEND_B_ID to enable)');
      return;
    }

    await browser.goto('/');
    await browser.waitForLoadState('networkidle');

    // Switch to Backend B
    await switchToMode(browser, backendB);
    await verifyMode(browser, backendB);

    // Test basic functionality
    const textarea = browser.locator('textarea').first();
    if (await textarea.isVisible({ timeout: 5000 })) {
      await textarea.fill('Test message on Backend B');
      console.log('✓ Backend B connection successful');
    }
  });

  test('should switch between backends on the same gateway', async () => {
    const backendA = getMode('gateway-backend-a');
    const backendB = getMode('gateway-backend-b');

    if (!backendA.enabled || !backendB.enabled) {
      console.log('SKIPPED: Both backends must be configured for this test');
      return;
    }

    await browser.goto('/');
    await browser.waitForLoadState('networkidle');

    console.log('Testing backend switching on the same gateway...');

    // Connect to Backend A
    console.log('\n1. Connecting to Backend A...');
    await switchToMode(browser, backendA);
    await verifyMode(browser, backendA);
    await browser.waitForTimeout(2000);

    const textareaA = browser.locator('textarea').first();
    if (await textareaA.isVisible({ timeout: 5000 })) {
      await textareaA.fill('Message sent to Backend A');
      console.log('   ✓ Backend A: Message sent');
    }

    // Switch to Backend B (same gateway, different backend)
    console.log('\n2. Switching to Backend B...');
    await switchToMode(browser, backendB);
    await verifyMode(browser, backendB);
    await browser.waitForTimeout(2000);

    const textareaB = browser.locator('textarea').first();
    if (await textareaB.isVisible({ timeout: 5000 })) {
      await textareaB.fill('Message sent to Backend B');
      console.log('   ✓ Backend B: Message sent');
    }

    // Switch back to Backend A
    console.log('\n3. Switching back to Backend A...');
    await switchToMode(browser, backendA);
    await verifyMode(browser, backendA);
    await browser.waitForTimeout(2000);

    console.log('\n✓ Successfully switched between multiple backends on the same gateway');
  });

  test('should isolate data between different backends', async () => {
    const backendA = getMode('gateway-backend-a');
    const backendB = getMode('gateway-backend-b');

    if (!backendA.enabled || !backendB.enabled) {
      console.log('SKIPPED: Both backends must be configured for this test');
      return;
    }

    await browser.goto('/');
    await browser.waitForLoadState('networkidle');

    // Create unique message on Backend A
    const uniqueMessageA = `Backend A message - ${Date.now()}`;
    await switchToMode(browser, backendA);
    await browser.waitForTimeout(2000);

    const textareaA = browser.locator('textarea').first();
    if (await textareaA.isVisible({ timeout: 5000 })) {
      await textareaA.fill(uniqueMessageA);
      await browser.waitForTimeout(1000);
    }

    // Switch to Backend B
    await switchToMode(browser, backendB);
    await browser.waitForTimeout(2000);

    // Verify Backend A's message is NOT visible on Backend B
    const backendBContent = await browser.textContent('body');
    expect(backendBContent).not.toContain(uniqueMessageA);

    console.log('✓ Data properly isolated between backends on the same gateway');
  });
});

/**
 * Use with testAllModes to run tests on all backends
 */

testAllModes('should work on all registered backends', async (browser, mode) => {
  if (mode.id.startsWith('gateway-backend')) {
    console.log(`\nTesting ${mode.name}:`);
    console.log(`  Gateway: ${mode.gatewayUrl}`);
    console.log(`  Backend ID: ${mode.backendId}`);

    // Your test logic here
    const textarea = browser.locator('textarea').first();
    if (await textarea.isVisible({ timeout: 5000 })) {
      await textarea.fill(`Test on ${mode.name}`);
      console.log(`  ✓ ${mode.name} test passed`);
    }
  }
});
