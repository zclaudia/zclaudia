import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  test,
  expect,
  openCodingSession,
  sendCodingMessage,
} from '../../helpers/agent-runtime-harness';

for (const runtime of ['cursor', 'codex', 'claude']) {
  test(`E04: ${runtime} resumes the same provider session across turns and backend restart`, async ({
    app,
    page,
  }) => {
    const { project, session, profile, cwd } = await app.configureCodingProject(runtime);
    const marker = `E2E_${runtime.toUpperCase()}_CODING_COMPLETE`;
    await openCodingSession(page, app, project, session);
    await sendCodingMessage(page, 'Fix addition and run the test.');
    await expect(page.getByText(marker, { exact: true })).toBeVisible();
    await expect
      .poll(async () => (await app.api(`/api/sessions/${session.id}/run-state`)).isRunning)
      .toBe(false);
    const persisted = await app.api(`/api/sessions/${session.id}`);
    expect(persisted.sdkSessionId).toBeTruthy();
    for (const restart of [false, true]) {
      if (restart) {
        await app.restart();
        await openCodingSession(page, app, project, session);
      }
      await sendCodingMessage(page, 'Check the addition test again.');
      await expect(page.getByText(marker, { exact: true })).toHaveCount(restart ? 3 : 2);
      await expect
        .poll(async () => (await app.api(`/api/sessions/${session.id}/run-state`)).isRunning)
        .toBe(false);
      expect(await app.api(`/api/sessions/${session.id}`)).toMatchObject({
        id: session.id,
        agentProfileId: profile.id,
        sdkSessionId: persisted.sdkSessionId,
      });
      const audit = await app.audit();
      expect(audit.filter(event => event.resume === persisted.sdkSessionId)).toHaveLength(
        restart ? 2 : 1
      );
      expect(audit.filter(event => event.cwd).every(event => event.cwd === cwd)).toBe(true);
    }
  });

  test(`E09/E20: ${runtime} rejects busy mutations and stops tools after cancellation`, async ({
    app,
    page,
  }) => {
    const { project, session, cwd } = await app.configureCodingProject(runtime);
    await openCodingSession(page, app, project, session);
    await sendCodingMessage(page, 'E2E_WAIT_FOR_CANCEL');
    await expect(page.getByText('Fixture task is running', { exact: true })).toBeVisible();
    const tickPath = path.join(cwd, 'cancel-tick.txt');
    await expect
      .poll(async () =>
        readFile(tickPath, 'utf8').catch(error => {
          if (error.code === 'ENOENT') return '';
          throw error;
        })
      )
      .not.toBe('');
    for (const action of ['deactivate', 'reload']) {
      const response = await fetch(`${app.url}/api/plugins/com.zclaudia.${runtime}/${action}`, {
        method: 'POST',
      });
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('RUNTIME_BUSY');
    }
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect
      .poll(async () => (await app.api(`/api/sessions/${session.id}/run-state`)).isRunning, {
        timeout: 10_000,
      })
      .toBe(false);
    // Observe beyond the fixture's 100 ms tool interval; a terminal UI alone
    // does not prove that the cancelled subprocess stopped writing.
    await new Promise(resolve => setTimeout(resolve, 500));
    const stopped = await readFile(tickPath, 'utf8');
    await new Promise(resolve => setTimeout(resolve, 750));
    expect(await readFile(tickPath, 'utf8')).toBe(stopped);
    await app.api(`/api/plugins/com.zclaudia.${runtime}/deactivate`, { method: 'POST' });
    await app.api(`/api/plugins/com.zclaudia.${runtime}/activate`, { method: 'POST' });
    await sendCodingMessage(page, 'Fix addition and run its test after cancellation.');
    await expect(
      page.getByText(`E2E_${runtime.toUpperCase()}_CODING_COMPLETE`, { exact: true })
    ).toBeVisible();
  });
}
