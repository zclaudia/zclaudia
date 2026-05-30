/**
 * Simple working test - demonstrates the recommended approach
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createBrowser, type BrowserAdapter } from '../../helpers/browser-adapter';
import { setupCleanDB } from '../../helpers/setup';

let browser: BrowserAdapter;

describe('Simple Tests (Recommended Approach)', () => {
  beforeEach(async () => {
    await setupCleanDB();
    browser = await createBrowser();
  });

  afterEach(async () => {
    await browser.close();
  });

  test('should load app and see Local Server connection', async () => {
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
    await browser.waitForTimeout(1000);

    // Check for server selector - it should show "Local Server"
    const serverText = await browser.textContent('body');
    expect(serverText).toContain('Local Server');

    console.log('✓ App loaded, Local Server visible');
  });

  test('should be able to see projects in sidebar', async () => {
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
    await browser.waitForTimeout(1000);

    // Check for projects section (case-insensitive)
    const bodyText = await browser.textContent('body');
    expect(bodyText?.toLowerCase()).toContain('projects');

    console.log('✓ Projects section visible');
  });

  test('should have settings button', async () => {
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
    await browser.waitForTimeout(1000);

    // Look for Settings
    const settingsBtn = browser.getByText('Settings');
    await expect(settingsBtn.isVisible({ timeout: 5000 })).resolves.toBe(true);

    console.log('✓ Settings button found');
  });
});
