import path from 'node:path';
import {
  test,
  expect,
  openCodingSession,
  sendCodingMessage,
} from '../../helpers/agent-runtime-harness';

for (const runtime of ['claude', 'codex', 'cursor']) {
  test(`E11/E22: ${runtime} profile edits repair its CLI and survive restart without an LLM binding`, async ({
    app,
    page,
  }) => {
    const { project, session, profile } = await app.configureCodingProject(runtime);
    for (const llm of await app.api('/api/llm-profiles')) {
      await app.api(`/api/llm-profiles/${llm.id}`, { method: 'DELETE' });
    }
    const name = `Edited ${runtime} coding agent`;
    const description = 'User-owned profile description';
    const cliPath = path.join(app.directory, `${runtime}-fixture`);
    const currentProfile = async () =>
      (await app.api('/api/agent-profiles')).find((item: any) => item.id === profile.id);

    await page.goto(app.url);
    await page.getByRole('button', { name: 'Extensions', exact: true }).click();
    await page.getByRole('button', { name: 'Built-in', exact: true }).click();
    await page
      .getByRole('button', {
        name: `Open ${runtime[0].toUpperCase() + runtime.slice(1)} Agent`,
        exact: true,
      })
      .click();
    const runtimeStatus = page.getByLabel('Runtime status');
    await runtimeStatus.getByText('Login help', { exact: true }).click();
    await expect(
      runtimeStatus.getByRole('link', { name: 'Official login instructions' })
    ).toBeVisible();
    await expect(runtimeStatus).toContainText('connected backend');
    await runtimeStatus
      .getByRole('button', { name: 'Configure agent profiles', exact: true })
      .click();
    await page.getByRole('button', { name: profile.name, exact: true }).click();
    await expect(page.getByTestId('agent-profile-editor')).toBeVisible();
    await expect(page.getByLabel('LLM Profile', { exact: true })).toHaveCount(0);
    await page.getByLabel('Profile name', { exact: true }).fill(name);
    await page.getByLabel('Profile description', { exact: true }).fill(description);
    await page
      .getByLabel('CLI Path (optional)', { exact: true })
      .fill(path.join(app.directory, 'missing-cli'));
    await page.getByLabel('CLI Path (optional)', { exact: true }).blur();
    await expect
      .poll(async () => (await currentProfile()).recordStatus.availability.usable)
      .toBe(false);
    await page.getByLabel('CLI Path (optional)', { exact: true }).fill(cliPath);
    await page.getByLabel('CLI Path (optional)', { exact: true }).blur();
    await expect
      .poll(async () => (await currentProfile()).recordStatus.availability.usable)
      .toBe(true);
    await expect(page.getByTestId('save-state')).toHaveText('Saved');

    await app.stop();
    await app.start();
    const retained = await currentProfile();
    expect(retained).toMatchObject({
      id: profile.id,
      name,
      description,
      runtimeType: runtime,
      cliPath,
      llmProfileId: '',
      model: '',
    });
    expect(
      (await app.api('/api/agent-profiles')).filter((item: any) => item.id === profile.id)
    ).toHaveLength(1);
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Agents', exact: true }).click();
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByLabel('Profile description', { exact: true })).toHaveValue(description);
    await expect(page.getByLabel('CLI Path (optional)', { exact: true })).toHaveValue(cliPath);
    await expect(page.getByLabel('LLM Profile', { exact: true })).toHaveCount(0);
    await openCodingSession(page, app, project, session);
    await sendCodingMessage(page, 'Fix addition using the edited profile.');
    await expect(
      page.getByText(`E2E_${runtime.toUpperCase()}_CODING_COMPLETE`, { exact: true })
    ).toBeVisible();
    expect((await app.audit()).some(row => row.runtime === runtime && row.testExitCode === 0)).toBe(
      true
    );
  });
}
