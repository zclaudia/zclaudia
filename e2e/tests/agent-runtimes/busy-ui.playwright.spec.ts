import {
  test,
  expect,
  openCodingSession,
  sendCodingMessage,
} from '../../helpers/agent-runtime-harness';

for (const runtime of ['claude', 'codex', 'cursor']) {
  test(`E09: ${runtime} busy disable and reload errors are visible and recover after cancellation`, async ({
    app,
    page,
    context,
  }) => {
    const { project, session } = await app.configureCodingProject(runtime);
    await openCodingSession(page, app, project, session);
    await sendCodingMessage(page, 'E2E_WAIT_FOR_CANCEL');
    await expect(page.getByText('Fixture task is running', { exact: true })).toBeVisible();
    const plugins = await context.newPage();
    await plugins.goto(app.url);
    await plugins.getByRole('button', { name: 'Extensions', exact: true }).click();
    await plugins.getByRole('button', { name: 'Built-in', exact: true }).click();
    const label = runtime[0].toUpperCase() + runtime.slice(1) + ' Agent';
    await plugins.getByRole('switch', { name: `Disable ${label}`, exact: true }).click();
    await expect(plugins.getByRole('alert')).toContainText('Stop active runs');
    expect((await app.api(`/api/sessions/${session.id}/run-state`)).isRunning).toBe(true);
    await plugins.getByRole('button', { name: `Open ${label}`, exact: true }).click();
    const dialog = plugins.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Reload runtime', exact: true }).click();
    await expect(dialog.getByText(/Stop active runs/)).toBeVisible();
    expect((await app.api(`/api/sessions/${session.id}/run-state`)).isRunning).toBe(true);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect
      .poll(async () => (await app.api(`/api/sessions/${session.id}/run-state`)).isRunning)
      .toBe(false);
    const reloaded = plugins.waitForResponse(
      response =>
        new URL(response.url()).pathname === `/api/plugins/com.zclaudia.${runtime}/reload` &&
        response.request().method() === 'POST'
    );
    await dialog.getByRole('button', { name: 'Reload runtime', exact: true }).click();
    expect((await reloaded).ok()).toBe(true);
    await expect(dialog.getByText(/Stop active runs/)).toHaveCount(0);
  });
}
