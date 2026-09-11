import { test, expect } from '../../helpers/agent-runtime-harness';

test('E01: all shipped adapters register and appear in the Built-in UI', async ({ app, page }) => {
  const plugins = await app.api('/api/plugins');
  expect(plugins.filter((p: any) => p.source === 'builtin')).toHaveLength(3);
  for (const runtime of ['claude', 'codex', 'cursor']) {
    expect(plugins.find((p: any) => p.id === `com.zclaudia.${runtime}`)).toMatchObject({
      source: 'builtin',
      status: 'active',
    });
  }
  const profiles = await app.api('/api/agent-profiles');
  for (const runtime of ['claude', 'codex', 'cursor']) {
    expect(profiles.find((p: any) => p.runtimeType === runtime)).toMatchObject({
      llmProfileId: '',
      model: '',
    });
  }
  await page.goto(app.url);
  await page.getByRole('button', { name: 'Extensions', exact: true }).click();
  await page.getByRole('button', { name: 'Built-in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Claude Agent', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Codex Agent', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Cursor Agent', exact: true })).toBeVisible();
  const statuses = await app.api('/api/managed-runtimes');
  for (const runtime of ['claude', 'codex', 'cursor']) {
    expect(
      statuses.find((item: any) => item.runtime === runtime).resolution.compatibilityState
    ).toBe('missing');
  }
  await page.getByRole('button', { name: 'Open Claude Agent', exact: true }).click();
  await expect(
    page.getByLabel('Runtime status').getByText('Not detected', { exact: true })
  ).toBeVisible();
});

test('E08/E20: disable through UI, restart, and retain the same profiles', async ({
  app,
  page,
}) => {
  const profiles = await app.api('/api/agent-profiles');
  const codex = profiles.find((p: any) => p.runtimeType === 'codex');
  await app.api(`/api/agent-profiles/${codex.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'My retained Codex', systemPrompt: 'Keep this prompt' }),
  });
  await page.goto(app.url);
  await page.getByRole('button', { name: 'Extensions', exact: true }).click();
  await page.getByRole('button', { name: 'Built-in', exact: true }).click();
  await page.getByRole('switch', { name: 'Disable Codex Agent' }).click();
  await expect(page.getByRole('switch', { name: 'Enable Codex Agent' })).toBeVisible();
  await app.restart();
  const plugin = (await app.api('/api/plugins')).find((p: any) => p.id === 'com.zclaudia.codex');
  expect(plugin).toMatchObject({ enabled: false, status: 'inactive' });
  expect((await app.api('/api/agent-profiles')).find((p: any) => p.id === codex.id)).toMatchObject({
    runtimeType: 'codex',
    name: 'My retained Codex',
    systemPrompt: 'Keep this prompt',
  });
  await app.api(`/api/agent-profiles/${codex.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ runtimeType: 'codex', systemPrompt: 'Keep this prompt' }),
  });
  expect(
    (await app.api('/api/agent-profiles')).find((p: any) => p.id === codex.id).runtimeType
  ).toBe('codex');
  await app.api('/api/plugins/com.zclaudia.codex/activate', { method: 'POST' });
  expect(
    (await app.api('/api/agent-profiles')).filter((p: any) => p.runtimeType === 'codex')
  ).toHaveLength(1);
});

test('E13: built-in plugins cannot be removed or rolled back', async ({ app, page }) => {
  for (const [suffix, method] of [
    ['', 'DELETE'],
    ['/rollback', 'POST'],
  ]) {
    const response = await fetch(`${app.url}/api/plugins/com.zclaudia.codex${suffix}`, { method });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('BUILTIN_PLUGIN');
  }
  await page.goto(app.url);
  await page.getByRole('button', { name: 'Extensions', exact: true }).click();
  await page.getByRole('button', { name: 'Built-in', exact: true }).click();
  await page.getByRole('button', { name: 'Open Codex Agent', exact: true }).click();
  await expect(page.getByText('Included with ZClaudia')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Uninstall', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Roll back', exact: true })).toHaveCount(0);
});
