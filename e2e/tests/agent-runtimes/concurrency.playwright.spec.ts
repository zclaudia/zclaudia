import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  test,
  expect,
  openCodingSession,
  sendCodingMessage,
} from '../../helpers/agent-runtime-harness';

for (const [first, second] of [
  ['claude', 'codex'],
  ['codex', 'cursor'],
  ['cursor', 'claude'],
]) {
  test(`E05: cancelling ${first} leaves concurrent ${second} running`, async ({
    app,
    page,
    context,
  }) => {
    const a = await app.configureCodingProject(first);
    const b = await app.configureCodingProject(second);
    const other = await context.newPage();
    await openCodingSession(page, app, a.project, a.session);
    await openCodingSession(other, app, b.project, b.session);
    await sendCodingMessage(page, 'E2E_WAIT_FOR_CANCEL');
    await sendCodingMessage(other, 'E2E_WAIT_FOR_CANCEL');
    for (const tab of [page, other])
      await expect(tab.getByText('Fixture task is running', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect
      .poll(async () => (await app.api(`/api/sessions/${a.session.id}/run-state`)).isRunning)
      .toBe(false);
    const tick = path.join(b.cwd, 'cancel-tick.txt');
    await expect
      .poll(async () =>
        readFile(tick, 'utf8').catch(error => {
          if (error.code === 'ENOENT') return '';
          throw error;
        })
      )
      .not.toBe('');
    const running = await readFile(tick, 'utf8');
    await expect.poll(async () => readFile(tick, 'utf8')).not.toBe(running);
    expect((await app.api(`/api/sessions/${b.session.id}/run-state`)).isRunning).toBe(true);
    await other.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect
      .poll(async () => (await app.api(`/api/sessions/${b.session.id}/run-state`)).isRunning)
      .toBe(false);
    const audit = await app.audit();
    expect(
      audit
        .filter(event => event.runtime === first && event.cwd)
        .every(event => event.cwd === a.cwd)
    ).toBe(true);
    expect(
      audit
        .filter(event => event.runtime === second && event.cwd)
        .every(event => event.cwd === b.cwd)
    ).toBe(true);
    expect(audit.find(event => event.runtime === first)?.sessionId).not.toBe(
      audit.find(event => event.runtime === second)?.sessionId
    );
  });
}

for (const runtime of ['claude', 'codex', 'cursor']) {
  test(`E20: shutting down during a ${runtime} task reaps the fixture and retains its session`, async ({
    app,
    page,
  }) => {
    const { project, session, profile, cwd } = await app.configureCodingProject(runtime);
    await openCodingSession(page, app, project, session);
    await sendCodingMessage(page, 'E2E_WAIT_FOR_CANCEL');
    await expect(page.getByText('Fixture task is running', { exact: true })).toBeVisible();
    const tick = path.join(cwd, 'cancel-tick.txt');
    await expect
      .poll(async () =>
        readFile(tick, 'utf8').catch(error => {
          if (error.code === 'ENOENT') return '';
          throw error;
        })
      )
      .not.toBe('');
    await app.stop();
    const stopped = await readFile(tick, 'utf8');
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(await readFile(tick, 'utf8')).toBe(stopped);
    await app.start();
    expect(await app.api(`/api/sessions/${session.id}`)).toMatchObject({
      id: session.id,
      agentProfileId: profile.id,
    });
    expect((await app.api(`/api/sessions/${session.id}/run-state`)).isRunning).toBe(false);
    await openCodingSession(page, app, project, session);
    await sendCodingMessage(page, 'Fix addition after server shutdown.');
    await expect(
      page.getByText(`E2E_${runtime.toUpperCase()}_CODING_COMPLETE`, { exact: true })
    ).toBeVisible();
  });
}
