import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect, openCodingSession } from '../../helpers/agent-runtime-harness';

test('design: chat discovers tools, presents a new mockup, and reads the current selection', async ({
  app,
  page,
}) => {
  test.setTimeout(90_000);
  const { project, session, cwd } = await app.configureCodingProject('claude');
  await openCodingSession(page, app, project, session);
  const composer = page.getByTestId('message-input');
  // No manual opening of Design and no Ask Agent handoff: use the session's real MCP bridge.
  await composer.fill('Create a new settings UI mockup and show it in Design. E2E_DESIGN_CHAT_NEW');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('iframe[title="Design preview"]')).toBeVisible();
  await expect(page.getByText('E2E_DESIGN_CHAT_PRESENTED', { exact: true })).toBeVisible();
  const frame = page.frameLocator('iframe[title="Design preview"]');
  await expect(frame.getByRole('heading', { name: 'New settings' })).toBeVisible();
  await frame.getByRole('heading').click();
  await expect(
    page.getByTestId('design-panel').getByLabel('Element text', { exact: true })
  ).toHaveValue('New settings');
  await composer.fill(
    'Refine the selected heading in the current Design page. E2E_DESIGN_CHAT_REFINE'
  );
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('E2E_DESIGN_CHAT_REFINED', { exact: true })).toBeVisible();
  await expect(frame.getByRole('heading', { name: 'Refined settings' })).toBeVisible();
  const observed = JSON.parse(await readFile(path.join(cwd, 'design-agent-result.json'), 'utf8'));
  expect(observed.before.ui.context.activePage.selection.elementPath).toEqual([0]);
  expect(observed.presented).toMatchObject({
    ok: true,
    displayed: true,
    path: 'design/settings-mockup.html',
  });
});

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
  // P3：交接收敛到画布底部 Agent 输入条（仍只预填、不自动发送）。
  await panel
    .getByRole('textbox', { name: 'Ask Agent', exact: true })
    .fill('Create a small landing page.');
  await panel.getByRole('button', { name: 'Send to chat', exact: true }).click();
  await expect(composer).toHaveValue(/Create a small landing page/);
  await expect(composer).toHaveValue(/design\/index.html/);
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
  await expect(async () => {
    await frame.getByRole('heading').click();
    await expect(panel.getByLabel('Element text', { exact: true })).toHaveValue(
      'Generated heading',
      { timeout: 500 }
    );
  }).toPass({ timeout: 15_000 });
  await panel.getByLabel('Element text', { exact: true }).fill('Manually edited heading');
  await expect(panel.getByLabel('Element text', { exact: true })).toHaveValue(
    'Manually edited heading'
  );
  await panel.getByRole('button', { name: 'Fill & border', exact: true }).click();
  await panel.getByLabel('Text color', { exact: true }).click();
  await panel.getByLabel('Text color', { exact: true }).fill('#335577');
  await expect(panel.getByLabel('Text color', { exact: true })).toHaveValue('#335577');
  await panel.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(frame.getByRole('heading')).toHaveText('Manually edited heading');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.getByText('Saved', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  expect(await readFile(path.join(cwd, 'design/index.html'), 'utf8')).toContain(
    'Manually edited heading'
  );
  await expect(frame.getByRole('heading')).toHaveCSS('color', 'rgb(51, 85, 119)');

  // Selection and draft must survive unchanged-file polling.
  await frame.getByText('Original subtitle', { exact: true }).click();
  await expect(panel.getByLabel('Element text', { exact: true })).toHaveValue('Original subtitle');
  await panel.getByRole('button', { name: 'Send to chat', exact: true }).click();
  await expect(composer).toHaveValue(/Original subtitle/);
  await composer.fill(`${await composer.inputValue()}\nE2E_DESIGN_REFINE`);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('E2E_DESIGN_REFINED', { exact: true })).toBeVisible();
  await expect(frame.getByText('Agent refined subtitle', { exact: true })).toBeVisible();
  await expect(frame.getByRole('heading')).toHaveText('Manually edited heading');

  // An external writer wins over a stale visual draft; never silently overwrite it.
  // The legacy file watcher can rebuild once more for dependency changes after HTML arrives.
  await expect(async () => {
    await frame.getByRole('heading').click();
    await expect(panel.getByLabel('Element text', { exact: true })).toHaveValue(
      'Manually edited heading',
      { timeout: 500 }
    );
  }).toPass({ timeout: 15_000 });
  await panel.getByLabel('Element text', { exact: true }).fill('Unsaved local draft');
  await panel.getByRole('button', { name: 'Apply changes', exact: true }).click();
  const filename = path.join(cwd, 'design/index.html');
  const external = (await readFile(filename, 'utf8')).replace(
    'Manually edited heading',
    'External heading'
  );
  await writeFile(filename, external);
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    panel.getByRole('status').filter({ hasText: 'Your draft is preserved' })
  ).toBeVisible();
  expect(await readFile(filename, 'utf8')).toBe(external);
  await expect(frame.getByRole('heading')).toHaveText('Unsaved local draft');
  await panel.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Reload', exact: true }).click();
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
