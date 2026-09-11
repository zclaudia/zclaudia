import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  test,
  expect,
  openCodingSession,
  sendCodingMessage,
} from '../../helpers/agent-runtime-harness';

test('E06: Cursor exposes supported modes without host per-tool approval controls', async ({
  app,
  page,
}) => {
  const { project, session, cwd } = await app.configureCodingProject('cursor');
  await openCodingSession(page, app, project, session);
  await expect(page.getByText('CLI permissions', { exact: true })).toBeVisible();
  const original = await readFile(path.join(cwd, 'add.mjs'), 'utf8');
  for (const mode of ['plan', 'ask']) {
    await page.getByRole('button', { name: 'Agent mode', exact: true }).click();
    await page
      .getByRole('option', { name: new RegExp(`^${mode === 'plan' ? 'Plan' : 'Ask'}`) })
      .click();
    await sendCodingMessage(page, `E2E_MODE ${mode}: inspect the addition function`);
    await expect(
      page.getByText(`E2E_CURSOR_${mode.toUpperCase()}_COMPLETE`, { exact: true })
    ).toBeVisible();
    await expect
      .poll(async () => (await app.api(`/api/sessions/${session.id}/run-state`)).isRunning)
      .toBe(false);
    expect(await readFile(path.join(cwd, 'add.mjs'), 'utf8')).toBe(original);
    expect((await app.audit()).filter(event => event.cwd).at(-1)).toMatchObject({
      runtime: 'cursor',
      mode,
      yolo: false,
    });
    await expect(page.getByRole('button', { name: 'Allow', exact: true })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Agent mode', exact: true }).click();
  await page.getByRole('option', { name: /^Default/ }).click();
  await sendCodingMessage(page, 'Fix addition in default mode.');
  await expect(page.getByText('E2E_CURSOR_CODING_COMPLETE', { exact: true })).toBeVisible();
  expect((await app.audit()).filter(event => event.cwd).at(-1)).toMatchObject({
    runtime: 'cursor',
    mode: 'default',
    yolo: true,
  });
});
