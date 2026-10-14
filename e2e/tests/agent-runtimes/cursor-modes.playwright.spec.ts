import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  test,
  expect,
  openCodingSession,
  sendCodingMessage,
} from '../../helpers/agent-runtime-harness';

test('E06: Cursor ACP modes preserve read-only turns and gate tool effects through host approval', async ({
  app,
  page,
}) => {
  const { project, session, cwd } = await app.configureCodingProject('cursor');
  await app.api(`/api/projects/${project.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      agentPermissionOverride: { escalateAlways: ['Bash'], aiReview: { enabled: false } },
    }),
  });
  await openCodingSession(page, app, project, session);
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
    });
    await expect(page.getByRole('button', { name: 'Allow', exact: true })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Agent mode', exact: true }).click();
  await page.getByRole('option', { name: /^Default/ }).click();
  await sendCodingMessage(page, 'E2E_PERMISSION Fix addition in default mode.');
  const allow = page.getByRole('button', { name: 'Allow', exact: true });
  await expect(allow).toBeVisible();
  expect(await readFile(path.join(cwd, 'add.mjs'), 'utf8')).toBe(original);
  await allow.click();
  await expect(page.getByText('E2E_CURSOR_CODING_COMPLETE', { exact: true })).toBeVisible();
  // ACP default mode uses the host's per-tool approval callback.
  expect((await app.audit()).filter(event => event.cwd).at(-1)).toMatchObject({
    runtime: 'cursor',
    mode: 'agent',
  });

  expect((await app.audit()).find(event => event.permissionOutcome)?.permissionOutcome).toEqual({
    outcome: 'selected',
    optionId: 'allow-once',
  });
  await expect
    .poll(async () => (await app.api(`/api/sessions/${session.id}/run-state`)).isRunning)
    .toBe(false);

  const runsBeforeBypass = (await app.audit()).filter(event => event.cwd).length;
  await page.getByRole('button', { name: 'Agent mode', exact: true }).click();
  await page.getByRole('option', { name: /^Bypass/ }).click();
  await sendCodingMessage(page, 'E2E_PERMISSION Fix addition in bypass mode.');
  // The default-mode turn already printed E2E_CURSOR_CODING_COMPLETE, so that
  // marker is on screen before this turn even starts — wait on the audit.
  await expect
    .poll(async () => (await app.audit()).filter(event => event.cwd).length)
    .toBe(runsBeforeBypass + 1);
  await expect
    .poll(async () => (await app.audit()).filter(event => event.permissionOutcome).length)
    .toBe(2);
  await expect(page.getByRole('button', { name: 'Allow', exact: true })).toHaveCount(0);
  // ACP bypass auto-selects a one-shot approval, without a host prompt.
  expect((await app.audit()).filter(event => event.cwd).at(-1)).toMatchObject({
    runtime: 'cursor',
    mode: 'agent',
  });
  expect(
    (await app.audit()).filter(event => event.permissionOutcome).at(-1)?.permissionOutcome
  ).toEqual({
    outcome: 'selected',
    optionId: 'allow-once',
  });
});
