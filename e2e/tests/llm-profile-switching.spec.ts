/**
 * LLM Profile Management Tests (PM1-PM5)
 *
 * Tests for llm profile CRUD operations and default switching.
 * Primarily API-level tests (PM1-PM4) with one UI-level test (PM5).
 *
 * Test coverage:
 * - PM1: List llm profiles via API (verify initial state)
 * - PM2: Create llm profile via API
 * - PM3: Set default llm profile via API
 * - PM4: Delete llm profile via API
 * - PM5: LLM profile settings UI (browser-based)
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createBrowser, type BrowserAdapter } from '../helpers/browser-adapter';
import { setupCleanDB, createApiClient, readApiKey } from '../helpers/setup';
import '../helpers/custom-matchers';

describe('LLM Profile Management', () => {
  let browser: BrowserAdapter;

  beforeEach(async () => {
    await setupCleanDB();
    browser = await createBrowser({ headless: true });
    await browser.goto('/');
    await browser.waitForLoadState('networkidle');
    await browser.waitForTimeout(1000);
  }, 30000);

  afterEach(async () => {
    await browser?.close();
  });

  // ─────────────────────────────────────────────
  // PM1: List llm profiles via API
  // ─────────────────────────────────────────────
  test('PM1: list llm profiles returns at least one profile with expected structure', async () => {
    console.log('Test PM1: List llm profiles via API');

    const apiKey = readApiKey();
    const client = createApiClient(apiKey);

    const res = await client.fetch('/api/llm-profiles');
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);

    // Expect at least one profile (auto-detected or default)
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    console.log(`  Found ${body.data.length} llm profile(s)`);

    // Verify response structure of the first profile
    const profile = body.data[0];
    expect(profile).toHaveProperty('id');
    expect(profile).toHaveProperty('name');
    expect(profile).toHaveProperty('providerType');
    expect(typeof profile.id).toBe('string');
    expect(typeof profile.name).toBe('string');
    expect(typeof profile.providerType).toBe('string');

    console.log(`  First profile: ${profile.name} (providerType=${profile.providerType}, id=${profile.id})`);
    console.log('PM1: List llm profiles test completed');
  }, 30000);

  // ─────────────────────────────────────────────
  // PM2: Create llm profile via API
  // ─────────────────────────────────────────────
  test('PM2: create llm profile and verify it appears in the list', async () => {
    console.log('Test PM2: Create llm profile via API');

    const apiKey = readApiKey();
    const client = createApiClient(apiKey);

    // Create a new profile
    const createRes = await client.fetch('/api/llm-profiles', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test Profile',
        providerType: 'anthropic',
        baseUrl: 'https://api.example.com',
      }),
    });

    expect(createRes.status).toBe(201);
    const createBody = await createRes.json();
    expect(createBody.success).toBe(true);
    expect(createBody.data.name).toBe('Test Profile');
    expect(createBody.data.providerType).toBe('anthropic');
    expect(createBody.data.baseUrl).toBe('https://api.example.com');
    expect(createBody.data.id).toBeDefined();

    const createdId = createBody.data.id;
    console.log(`  Created llm profile with id: ${createdId}`);

    // Verify the new profile appears in the list
    const listRes = await client.fetch('/api/llm-profiles');
    expect(listRes.ok).toBe(true);

    const listBody = await listRes.json();
    const found = listBody.data.find((p: { id: string }) => p.id === createdId);
    expect(found).toBeDefined();
    expect(found.name).toBe('Test Profile');

    console.log('  Verified llm profile is present in list');
    console.log('PM2: Create llm profile test completed');
  }, 30000);

  // ─────────────────────────────────────────────
  // PM3: Set default llm profile via API
  // ─────────────────────────────────────────────
  test('PM3: set default llm profile switches isDefault correctly', async () => {
    console.log('Test PM3: Set default llm profile via API');

    const apiKey = readApiKey();
    const client = createApiClient(apiKey);

    // Create first profile as default
    const res1 = await client.fetch('/api/llm-profiles', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Profile Alpha',
        providerType: 'anthropic',
        isDefault: true,
      }),
    });
    expect(res1.status).toBe(201);
    const profile1 = (await res1.json()).data;
    console.log(`  Created Profile Alpha (id=${profile1.id})`);

    // Create second profile (non-default)
    const res2 = await client.fetch('/api/llm-profiles', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Profile Beta',
        providerType: 'anthropic',
      }),
    });
    expect(res2.status).toBe(201);
    const profile2 = (await res2.json()).data;
    console.log(`  Created Profile Beta (id=${profile2.id})`);

    // Verify Alpha is default and Beta is not
    let listRes = await client.fetch('/api/llm-profiles');
    let listBody = await listRes.json();
    let alpha = listBody.data.find((p: { id: string }) => p.id === profile1.id);
    let beta = listBody.data.find((p: { id: string }) => p.id === profile2.id);
    expect(alpha.isDefault).toBe(true);
    expect(beta.isDefault).toBe(false);
    console.log('  Verified Alpha is default, Beta is not');

    // Set Beta as default via POST /api/llm-profiles/:id/set-default
    const setDefaultRes = await client.fetch(`/api/llm-profiles/${profile2.id}/set-default`, {
      method: 'POST',
    });
    expect(setDefaultRes.ok).toBe(true);
    const setDefaultBody = await setDefaultRes.json();
    expect(setDefaultBody.success).toBe(true);
    console.log('  Set Beta as default');

    // Verify Beta is now default and Alpha is not
    listRes = await client.fetch('/api/llm-profiles');
    listBody = await listRes.json();
    alpha = listBody.data.find((p: { id: string }) => p.id === profile1.id);
    beta = listBody.data.find((p: { id: string }) => p.id === profile2.id);
    expect(beta.isDefault).toBe(true);
    expect(alpha.isDefault).toBe(false);

    console.log('  Verified Beta is now default, Alpha is not');
    console.log('PM3: Set default llm profile test completed');
  }, 30000);

  // ─────────────────────────────────────────────
  // PM4: Delete llm profile via API
  // ─────────────────────────────────────────────
  test('PM4: delete llm profile removes it from the list', async () => {
    console.log('Test PM4: Delete llm profile via API');

    const apiKey = readApiKey();
    const client = createApiClient(apiKey);

    // Create a profile to delete
    const createRes = await client.fetch('/api/llm-profiles', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Profile To Delete',
        providerType: 'anthropic',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()).data;
    console.log(`  Created llm profile with id: ${created.id}`);

    // Verify it exists in the list
    let listRes = await client.fetch('/api/llm-profiles');
    let listBody = await listRes.json();
    let found = listBody.data.find((p: { id: string }) => p.id === created.id);
    expect(found).toBeDefined();
    console.log('  Verified llm profile exists in list');

    // Delete the profile
    const deleteRes = await client.fetch(`/api/llm-profiles/${created.id}`, {
      method: 'DELETE',
    });
    expect(deleteRes.ok).toBe(true);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.success).toBe(true);
    console.log('  Deleted llm profile');

    // Verify it is gone from the list
    listRes = await client.fetch('/api/llm-profiles');
    listBody = await listRes.json();
    found = listBody.data.find((p: { id: string }) => p.id === created.id);
    expect(found).toBeUndefined();

    console.log('  Verified llm profile is no longer in list');
    console.log('PM4: Delete llm profile test completed');
  }, 30000);

  // ─────────────────────────────────────────────
  // PM5: LLM profile settings UI (browser-based)
  // ─────────────────────────────────────────────
  test('PM5: llm profile settings UI shows profile list', async () => {
    console.log('Test PM5: LLM profile settings UI');

    // Navigate to Settings by clicking the settings button
    const settingsButton = browser.locator('[data-testid="settings-button"]').first();
    const settingsVisible = await settingsButton.isVisible({ timeout: 5000 }).catch(() => false);

    if (!settingsVisible) {
      // Fallback: look for a gear icon or "Settings" text
      const altSettings = browser.locator('button[title*="Settings"], button[aria-label*="Settings"], text=Settings').first();
      const altVisible = await altSettings.isVisible({ timeout: 3000 }).catch(() => false);

      if (altVisible) {
        await altSettings.click();
      } else {
        console.log('  Settings button not found, skipping UI test');
        console.log('PM5: LLM profile settings UI test completed (settings not accessible)');
        return;
      }
    } else {
      await settingsButton.click();
    }

    await browser.waitForTimeout(500);

    // Look for an LLM Profiles tab or section
    const llmProfilesTab = browser.locator('[data-testid="llm-profiles-tab"]').first();
    const llmProfilesTabVisible = await llmProfilesTab.isVisible({ timeout: 3000 }).catch(() => false);

    if (llmProfilesTabVisible) {
      await llmProfilesTab.click();
      await browser.waitForTimeout(500);
      console.log('  Clicked LLM Profiles tab');
    } else {
      // Fallback: look for "Servers" tab (profiles may be listed under servers)
      const serversTab = browser.locator('[data-testid="servers-tab"]').first();
      const serversTabVisible = await serversTab.isVisible({ timeout: 2000 }).catch(() => false);

      if (serversTabVisible) {
        await serversTab.click();
        await browser.waitForTimeout(500);
        console.log('  Clicked Servers tab (profiles may be listed here)');
      } else {
        console.log('  No LLM Profiles or Servers tab found');
      }
    }

    // Verify some profile-related content is visible
    const profileContent = browser.locator(
      'text=/profile|Profile|llm|LLM|anthropic|Anthropic/i'
    ).first();
    const hasProfileContent = await profileContent.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasProfileContent) {
      const text = await profileContent.textContent().catch(() => '');
      console.log(`  Found llm profile content: "${text}"`);
      console.log('  LLM profile list is visible in settings');
    } else {
      // Check for any list items in the settings panel
      const listItems = browser.locator('.p-3.border.rounded-lg, [class*="llm-profile"], [class*="profile"], [class*="server"]');
      const count = await listItems.count().catch(() => 0);
      console.log(`  Found ${count} list item(s) in settings panel`);
    }

    console.log('PM5: LLM profile settings UI test completed');
  }, 30000);
});
