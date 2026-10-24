import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect, openCodingSession } from '../../helpers/agent-runtime-harness';

test('design: existing agent generates, visual edits persist, and the same conversation refines', async ({
  app,
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  testInfo.annotations.push({
    type: 'agent',
    description: 'Deterministic CLI fixture through the real Claude adapter',
  });
  const { project, session, cwd } = await app.configureCodingProject('claude');
  await openCodingSession(page, app, project, session);
  await page.getByRole('button', { name: 'Show right panel', exact: true }).click();
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  const panel = page.getByTestId('design-panel');
  await expect(panel).toBeVisible();
  const composer = page.getByTestId('message-input');
  await composer.fill('Create a small landing page.');
  await panel.getByRole('button', { name: 'Generate page', exact: true }).click();
  await expect(composer).toHaveValue(/Create a small landing page[\s\S]*design\/index.html/);
  await composer.fill(`${await composer.inputValue()}\nE2E_DESIGN_GENERATE`);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('E2E_DESIGN_GENERATED', { exact: true })).toBeVisible();

  const frame = page.frameLocator('iframe[title="Design preview"]');
  await expect(frame.getByRole('heading', { name: 'Generated heading' })).toBeVisible();
  await expect(frame.locator('body')).toHaveCSS('background-color', 'rgb(246, 244, 239)');
  await expect
    .poll(() =>
      frame
        .getByRole('img', { name: 'Local artwork' })
        .evaluate((img: HTMLImageElement) => img.naturalWidth)
    )
    .toBe(80);
  await frame.getByRole('heading').click();
  await expect(panel.getByLabel('Element text', { exact: true })).toHaveValue('Generated heading');
  await panel.getByLabel('Element text', { exact: true }).fill('Manually edited heading');
  await panel.getByLabel('Text color', { exact: true }).fill('#335577');
  await panel.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(frame.getByRole('heading')).toHaveText('Manually edited heading');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'There are unsaved changes' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  expect(await readFile(path.join(cwd, 'design/index.html'), 'utf8')).toContain(
    'Manually edited heading'
  );
  await expect(frame.getByRole('heading')).toHaveCSS('color', 'rgb(51, 85, 119)');

  // Selection and draft must survive unchanged-file polling.
  await frame.getByText('Original subtitle', { exact: true }).click();
  await expect(panel.getByLabel('Element text', { exact: true })).toHaveValue('Original subtitle');
  await panel.getByRole('button', { name: 'Hand off to Agent', exact: true }).click();
  await expect(composer).toHaveValue(/Original subtitle/);
  await composer.fill(`${await composer.inputValue()}\nE2E_DESIGN_REFINE`);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('E2E_DESIGN_REFINED', { exact: true })).toBeVisible();
  await expect(frame.getByText('Agent refined subtitle', { exact: true })).toBeVisible();
  await expect(frame.getByRole('heading')).toHaveText('Manually edited heading');

  // An external writer wins over a stale visual draft; never silently overwrite it.
  await frame.getByRole('heading').click();
  await expect(panel.getByLabel('Element text', { exact: true })).toHaveValue(
    'Manually edited heading'
  );
  await panel.getByLabel('Element text', { exact: true }).fill('Unsaved local draft');
  await panel.getByRole('button', { name: 'Apply changes', exact: true }).click();
  const filename = path.join(cwd, 'design/index.html');
  const external = (await readFile(filename, 'utf8')).replace(
    'Manually edited heading',
    'External heading'
  );
  await writeFile(filename, external);
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'Your draft is preserved' })).toBeVisible();
  expect(await readFile(filename, 'utf8')).toBe(external);
  await expect(frame.getByRole('heading')).toHaveText('Unsaved local draft');
  await panel.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(frame.getByRole('heading')).toHaveText('External heading');

  const audit = (await app.audit()).filter(event => event.design);
  expect(audit.map(event => event.design)).toEqual(['generate', 'refine']);
  expect(audit.every(event => event.cwd === cwd)).toBe(true);
  expect(new Set(audit.map(event => event.sessionId)).size).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('design-workbench.png'), fullPage: true });
  await page.reload();
  await page.getByText(project.name, { exact: true }).click();
  await page.getByTestId('session-item').getByText(session.name, { exact: true }).click();
  await expect(page.frameLocator('iframe[title="Design preview"]').getByRole('heading')).toHaveText(
    'External heading'
  );
});
