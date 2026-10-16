import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { test, expect } from '../../helpers/agent-runtime-harness';
import { AgentRuntimeGatewayHarness } from '../../helpers/agent-runtime-gateway-harness';

async function openDrawer(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) >= 768) return;
  if (await page.getByRole('button', { name: 'Close menu', exact: true }).isVisible()) return;
  const menu = page.getByRole('button', { name: 'Open menu', exact: true });
  await menu.click();
}

async function createSession(page: Page, projectName: string, name: string) {
  await openDrawer(page);
  const row = page.getByRole('button', { name: projectName, exact: true });
  await row.locator('..').getByRole('button', { name: 'New session', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New session', exact: true });
  await dialog.getByPlaceholder('Session name (optional)').fill(name);
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test('project and sessions appear in both sidebars without reload or backend switching', async ({
  app,
  page: desktop,
  browser,
}, testInfo) => {
  const setup = await app.configureCodingProject('claude');
  const gateway = new AgentRuntimeGatewayHarness();
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await mobileContext.newPage();
  try {
    await gateway.start({ issuedCredentials: true });
    await app.api('/api/server/gateway/config', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: true,
        gatewayUrl: gateway.url,
        gatewaySecret: gateway.backendSecret,
        backendName: 'Resource sync backend',
        registerAsBackend: true,
      }),
    });
    await expect
      .poll(async () => (await app.api('/api/server/gateway/status')).connected)
      .toBe(true);
    await desktop.goto(app.url);
    await expect(
      desktop.getByRole('button', { name: setup.project.name, exact: true })
    ).toBeVisible();
    await mobile.goto(app.url);
    await mobile.getByPlaceholder('http://gateway.example.com:3200').fill(gateway.url);
    await mobile.getByPlaceholder('Enter gateway secret').fill(gateway.clientSecret);
    await mobile.getByRole('button', { name: 'Connect', exact: true }).click();
    await mobile.getByRole('button', { name: /Resource sync backend/ }).click();
    await openDrawer(mobile);
    await expect(
      mobile.getByRole('button', { name: setup.project.name, exact: true })
    ).toBeVisible();

    // Business mutations use UI; assertions inspect the receiver's actual sidebar.
    await mobile.getByRole('button', { name: 'New project', exact: true }).click();
    const dialog = mobile.getByRole('dialog', { name: 'New project', exact: true });
    const projectName = 'Created on mobile';
    await dialog.getByPlaceholder('Project name').fill(projectName);
    await dialog.getByLabel('Working directory', { exact: true }).fill(setup.cwd);
    await dialog.getByLabel('Project coding agent', { exact: true }).click();
    await mobile.getByRole('option', { name: setup.profile.name, exact: true }).click();
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(desktop.getByRole('button', { name: projectName, exact: true })).toBeVisible();
    await desktop.getByRole('button', { name: projectName, exact: true }).click();

    await createSession(mobile, projectName, 'Mobile session');
    await expect(
      desktop.getByTestId('session-item').getByText('Mobile session', { exact: true })
    ).toBeVisible();
    await createSession(desktop, projectName, 'Desktop session');
    await openDrawer(mobile);
    // Creating a session auto-expands its project on the originating client.
    await expect(
      mobile.getByTestId('session-item').getByText('Desktop session', { exact: true })
    ).toBeVisible();

    const project = (await app.api('/api/projects')).find((p: any) => p.name === projectName);
    const sessions = await app.api(`/api/sessions?projectId=${project.id}`);
    expect(sessions.map((s: any) => s.name).sort()).toEqual(['Desktop session', 'Mobile session']);
    await desktop.screenshot({ path: testInfo.outputPath('desktop.png') });
    await mobile.screenshot({ path: testInfo.outputPath('mobile.png') });
  } finally {
    try {
      await mobileContext.close();
      await app.stop();
    } finally {
      for (const secret of [gateway.secret, gateway.backendSecret, gateway.clientSecret]) {
        app.logs = app.logs.replaceAll(secret, '[redacted]');
      }
      try {
        await writeFile(testInfo.outputPath('gateway.log'), gateway.logs);
      } finally {
        await gateway.dispose();
      }
    }
  }
});
