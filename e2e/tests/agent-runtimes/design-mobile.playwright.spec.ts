import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../../helpers/agent-runtime-harness';
import { AgentRuntimeGatewayHarness } from '../../helpers/agent-runtime-gateway-harness';

test.skip(!process.env.ZCLAUDIA_E2E_GATEWAY_ENTRY, 'Requires a built Gateway artifact');

test('mobile Design: gateway presentation, touch editing, back, and handoff to chat', async ({
  app,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const { project, session, cwd } = await app.configureCodingProject('claude');
  const gateway = new AgentRuntimeGatewayHarness();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await gateway.start({ issuedCredentials: true });
    await app.api('/api/server/gateway/config', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: true,
        gatewayUrl: gateway.url,
        gatewaySecret: gateway.backendSecret,
        backendName: 'Mobile Design backend',
        registerAsBackend: true,
      }),
    });
    await expect
      .poll(async () => (await app.api('/api/server/gateway/status')).connected)
      .toBe(true);
    await page.goto(app.url);
    await page.getByPlaceholder('http://gateway.example.com:3200').fill(gateway.url);
    await page.getByPlaceholder('Enter gateway secret').fill(gateway.clientSecret);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button', { name: /Mobile Design backend/ }).click();
    if (!(await page.getByRole('button', { name: 'Close menu', exact: true }).isVisible())) {
      await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    }
    await page.getByRole('button', { name: project.name, exact: true }).click();
    await page.getByTestId('session-item').getByText(session.name, { exact: true }).click();
    const composer = page.getByPlaceholder(/^Type a message/);
    await composer.fill(
      'Create a new settings UI mockup and show it in Design. E2E_DESIGN_CHAT_NEW'
    );
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const panel = page.getByTestId('design-panel');
    await expect(panel).toBeVisible();
    const frame = page.frameLocator('iframe[title="Design preview"]');
    await expect(frame.getByRole('heading', { name: 'New settings' })).toBeVisible();
    const observed = JSON.parse(await readFile(path.join(cwd, 'design-agent-result.json'), 'utf8'));
    expect(observed.presented).toMatchObject({ ok: true, displayed: true });

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const name of [
        'Toggle pages panel',
        'Save',
        'More actions',
        'Desktop viewport',
        'Mobile viewport',
        'Zoom in',
        'Send to chat',
      ]) {
        const button = panel.getByRole('button', { name, exact: true });
        const box = await button.boundingBox();
        expect(box, name).not.toBeNull();
        expect(box!.height, name).toBeGreaterThanOrEqual(44);
        expect(box!.width, name).toBeGreaterThanOrEqual(44);
        expect(box!.x, name).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, name).toBeLessThanOrEqual(width);
      }
      await page.screenshot({ path: testInfo.outputPath(`design-mobile-${width}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await frame.getByRole('heading').tap();
    await expect(panel.getByLabel('Element text', { exact: true })).toHaveValue('New settings');
    const inspectorHandle = panel.getByRole('button', { name: 'Collapse inspector', exact: true });
    expect((await inspectorHandle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await inspectorHandle.locator('span').boundingBox())!.height).toBe(4);
    await panel.getByLabel('Element text', { exact: true }).fill('Mobile edited heading');
    await panel.getByRole('button', { name: 'Apply changes', exact: true }).tap();
    await expect(panel.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    await page.setViewportSize({ width: 320, height: 844 });
    const handoffSave = await panel
      .getByRole('button', { name: 'Save before hand off', exact: true })
      .boundingBox();
    expect(handoffSave!.x + handoffSave!.width).toBeLessThanOrEqual(320);
    await page.screenshot({ path: testInfo.outputPath('design-mobile-dirty-320.png') });
    await page.getByRole('button', { name: 'Close panel', exact: true }).tap();
    await expect(panel).toHaveCount(0);
    expect(await readFile(path.join(cwd, 'design/settings-mockup.html'), 'utf8')).toContain(
      'New settings'
    );
    await page.getByRole('button', { name: 'Add attachment or open tools', exact: true }).tap();
    await page.getByRole('button', { name: 'Design', exact: true }).tap();
    await expect(panel.getByLabel('Element text', { exact: true })).toHaveValue(
      'Mobile edited heading'
    );
    await expect(panel.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.getByRole('button', { name: 'Save', exact: true }).tap();
    await expect
      .poll(async () => readFile(path.join(cwd, 'design/settings-mockup.html'), 'utf8'))
      .toContain('Mobile edited heading');
    await page.evaluate(() =>
      window.dispatchEvent(new Event('android-back', { cancelable: true }))
    );
    await expect(
      panel.getByRole('button', { name: 'Expand inspector', exact: true })
    ).toBeVisible();
    await panel.getByRole('button', { name: 'More actions', exact: true }).tap();
    await expect(page.getByRole('menuitem', { name: 'Export & Share', exact: true })).toHaveCount(
      0
    );
    await expect(page.getByRole('menuitem', { name: 'Media', exact: true })).toHaveCount(0);
    await page.evaluate(() =>
      window.dispatchEvent(new Event('android-back', { cancelable: true }))
    );
    await panel.getByLabel('Ask Agent', { exact: true }).fill('Make this heading blue');
    await panel.getByRole('button', { name: 'Send to chat', exact: true }).tap();
    await expect(panel).toHaveCount(0);
    await expect(composer).toBeVisible();
    await expect(composer).toHaveValue(/Make this heading blue/);
    await expect(composer).toHaveValue(/Mobile edited heading/);
    await page.getByRole('button', { name: 'Add attachment or open tools', exact: true }).tap();
    await page.getByRole('button', { name: 'Design', exact: true }).tap();
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole('button', { name: 'Collapse inspector', exact: true })
    ).toBeVisible();
    await page.evaluate(() =>
      window.dispatchEvent(new Event('android-back', { cancelable: true }))
    );
    await expect(
      panel.getByRole('button', { name: 'Expand inspector', exact: true })
    ).toBeVisible();
    await page.evaluate(() =>
      window.dispatchEvent(new Event('android-back', { cancelable: true }))
    );
    await expect(panel).toHaveCount(0);
  } finally {
    await context.close();
    await gateway.stop();
  }
});
