import {
  test,
  expect,
  openCodingSession,
  sendCodingMessage,
} from '../../helpers/agent-runtime-harness';

for (const runtime of ['claude', 'codex', 'cursor']) {
  for (const failure of ['CRASH', 'MALFORMED']) {
    test(`E10: ${runtime} recovers after CLI ${failure.toLowerCase()}`, async ({ app, page }) => {
      const { project, session, profile } = await app.configureCodingProject(runtime);
      await openCodingSession(page, app, project, session);
      await sendCodingMessage(page, `E2E_${failure}`);
      await expect
        .poll(async () =>
          (
            await app.audit().catch(error => {
              if (error.code === 'ENOENT') return [];
              throw error;
            })
          ).some(event => event.crash === (failure === 'CRASH' ? 'exit' : 'malformed'))
        )
        .toBe(true);
      await expect
        .poll(async () => (await app.api(`/api/sessions/${session.id}/run-state`)).isRunning)
        .toBe(false);
      expect(await app.api(`/api/sessions/${session.id}`)).toMatchObject({
        agentProfileId: profile.id,
      });
      expect(
        (await app.api('/api/plugins'))
          .filter((plugin: any) => plugin.source === 'builtin')
          .every((plugin: any) => plugin.status === 'active')
      ).toBe(true);
      await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
      await sendCodingMessage(page, 'Fix addition after a failed CLI run.');
      await expect(
        page.getByText(`E2E_${runtime.toUpperCase()}_CODING_COMPLETE`, { exact: true })
      ).toBeVisible();
      expect(
        (
          await app.audit().catch(error => {
            if (error.code === 'ENOENT') return [];
            throw error;
          })
        ).some(event => event.runtime === runtime && event.testExitCode === 0)
      ).toBe(true);
    });
  }
}
