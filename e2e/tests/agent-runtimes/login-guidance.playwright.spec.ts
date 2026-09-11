import { execFileSync } from 'node:child_process';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  test,
  expect,
  openCodingSession,
  sendCodingMessage,
} from '../../helpers/agent-runtime-harness';

test('E11: Cursor preserves unknown authentication and recovers a login failure through CLI guidance', async ({
  app,
  page,
}) => {
  const { project, session, profile, cwd } = await app.configureCodingProject('cursor');
  await mkdir(path.join(app.directory, 'bin'), { recursive: true });
  const executable = path.join(app.directory, 'bin/cursor-agent');
  await symlink(path.join(app.directory, 'cursor-fixture'), executable);
  await app.api(`/api/agent-profiles/${profile.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ cliPath: '' }),
  });
  const marker = path.join(app.directory, 'cli-audit.jsonl.auth-required');
  await writeFile(marker, 'fixture signed out');
  await app.restart();
  const status = async () =>
    (await app.api('/api/managed-runtimes')).find((item: any) => item.runtime === 'cursor');
  expect((await status()).resolution).toMatchObject({
    status: 'resolved',
    source: 'system',
    authState: 'unknown',
    executablePath: executable,
  });
  // The descriptor has no auth probe. Readiness must not pretend it checked
  // the account, or block a CLI that can authenticate on its first invocation.
  expect(
    (await app.api('/api/agent-profiles')).find((item: any) => item.id === profile.id).recordStatus
      .availability.usable
  ).toBe(true);
  await openCodingSession(page, app, project, session);
  await sendCodingMessage(page, 'Fix addition while the CLI is signed out.');
  await expect(page.getByText(/Cursor CLI authentication required/).first()).toBeVisible();
  await expect
    .poll(async () => (await app.api(`/api/sessions/${session.id}/run-state`)).isRunning)
    .toBe(false);
  expect((await app.audit()).some(event => event.authenticationFailure)).toBe(true);
  expect(await readFile(path.join(cwd, 'add.mjs'), 'utf8')).toContain('a - b');

  await page.getByRole('button', { name: 'Extensions', exact: true }).click();
  await page.getByRole('button', { name: 'Built-in', exact: true }).click();
  await page.getByRole('button', { name: 'Open Cursor Agent', exact: true }).click();
  const runtimeStatus = page.getByLabel('Runtime status');
  await runtimeStatus.getByText('Login help', { exact: true }).click();
  await expect(runtimeStatus.getByText(/Authentication has not been checked/)).toBeVisible();
  await expect(
    runtimeStatus.getByRole('link', { name: 'Official login instructions' })
  ).toHaveAttribute('href', 'https://cursor.com/docs/cli/reference/authentication');
  const command = await runtimeStatus.getByLabel('Login command', { exact: true }).innerText();
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  expect(command).toBe(`${quote(executable)} login`);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await runtimeStatus.getByRole('button', { name: 'Copy login command', exact: true }).click();
  await expect(
    runtimeStatus.getByRole('button', { name: 'Copied login command', exact: true })
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
  // Owned fixture only; there is no external OAuth or real vendor request.
  execFileSync('/bin/sh', ['-c', command], {
    env: { PATH: '/usr/bin:/bin', E2E_RUNTIME_AUDIT: path.join(app.directory, 'cli-audit.jsonl') },
    timeout: 5000,
  });
  await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  await runtimeStatus.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(runtimeStatus.getByText('unknown', { exact: true })).toBeVisible();
  expect((await status()).resolution.authState).toBe('unknown');

  await openCodingSession(page, app, project, session);
  await sendCodingMessage(page, 'Fix addition after logging in.');
  await expect(page.getByText('E2E_CURSOR_CODING_COMPLETE', { exact: true })).toBeVisible();
  expect((await app.audit()).some(event => event.testExitCode === 0)).toBe(true);
  expect(await app.api(`/api/sessions/${session.id}`)).toMatchObject({
    agentProfileId: profile.id,
  });
});
