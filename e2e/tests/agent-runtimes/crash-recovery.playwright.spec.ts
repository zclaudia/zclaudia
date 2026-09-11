import {
  test,
  expect,
  openCodingSession,
  sendCodingMessage,
} from '../../helpers/agent-runtime-harness';

for (const runtime of ['claude', 'codex', 'cursor']) {
  test(`E20: ${runtime} interrupted run remains recoverable after abrupt backend termination`, async ({
    app,
    page,
  }) => {
    const { project, session, profile } = await app.configureCodingProject(runtime);
    await openCodingSession(page, app, project, session);
    await sendCodingMessage(page, 'E2E_WAIT_FOR_CANCEL');
    await expect(page.getByText('Fixture task is running', { exact: true })).toBeVisible();
    await expect
      .poll(async () => (await app.api(`/api/sessions/${session.id}`)).lastRunStatus)
      .toBe('running');
    const providerSessionId = (await app.api(`/api/sessions/${session.id}`)).sdkSessionId;
    expect(providerSessionId).toBeTruthy();
    await app.crash();
    await app.start();
    expect(await app.api(`/api/sessions/${session.id}`)).toMatchObject({
      agentProfileId: profile.id,
      sdkSessionId: providerSessionId,
      lastRunStatus: 'interrupted',
    });
    expect((await app.api(`/api/sessions/${session.id}/run-state`)).isRunning).toBe(false);
    await openCodingSession(page, app, project, session);
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
    await sendCodingMessage(page, 'Fix addition after the interrupted run.');
    await expect(
      page.getByText(`E2E_${runtime.toUpperCase()}_CODING_COMPLETE`, { exact: true })
    ).toBeVisible();
    await expect
      .poll(async () => (await app.api(`/api/sessions/${session.id}/run-state`)).isRunning)
      .toBe(false);
    expect(
      (await app.audit()).some(
        event => event.runtime === runtime && event.resume === providerSessionId
      )
    ).toBe(true);
  });
}
