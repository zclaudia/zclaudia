import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  test,
  expect,
  openCodingSession,
  sendCodingMessage,
} from '../../helpers/agent-runtime-harness';

test('E11: missing CLIs are unavailable without requesting an API model or installing', async ({
  app,
  page,
}) => {
  expect(await app.api('/api/agent-profiles/readiness')).toEqual({
    usable: false,
    reason: 'runtime_missing',
  });
  const profiles = await app.api('/api/agent-profiles');
  expect(profiles).toHaveLength(3);
  expect(profiles.every((profile: any) => profile.recordStatus.availability.usable === false)).toBe(
    true
  );
  await page.goto(app.url);
  await page.getByRole('button', { name: /This Device/ }).hover();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  await expect(dialog.getByText(/No coding agent is ready on this backend/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
  expect(
    (await app.api('/api/managed-runtimes')).every(
      (runtime: any) => runtime.installedVersions.length === 0
    )
  ).toBe(true);
});

for (const runtime of ['claude', 'codex', 'cursor']) {
  test(`E11: ${runtime} incompatible CLI blocks creation and can be repaired`, async ({
    app,
    page,
  }) => {
    const { project, session, profile } = await app.configureCodingProject(runtime);
    const script = path.join(app.directory, `${runtime}-fixture.mjs`);
    const original = await readFile(script, 'utf8');
    const version = { claude: '2.1.181', codex: '0.144.1', cursor: '2026.9.10' }[runtime]!;
    await writeFile(
      script,
      original.replace(version, runtime === 'cursor' ? 'unparseable-version' : '0.0.1')
    );
    const response = await fetch(`${app.url}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        agentProfileId: profile.id,
        name: 'Must be blocked',
      }),
    });
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).toContain('runtime_incompatible');
    expect(
      (await app.api('/api/agent-profiles')).find((item: any) => item.id === profile.id)
        .recordStatus.availability.usable
    ).toBe(false);
    await writeFile(script, original);
    expect(
      (await app.api('/api/agent-profiles')).find((item: any) => item.id === profile.id)
        .recordStatus.availability.usable
    ).toBe(true);
    await openCodingSession(page, app, project, session);
    await sendCodingMessage(page, 'Fix addition with the repaired CLI.');
    await expect(
      page.getByText(`E2E_${runtime.toUpperCase()}_CODING_COMPLETE`, { exact: true })
    ).toBeVisible();
  });
}
