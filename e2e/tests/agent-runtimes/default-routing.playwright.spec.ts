import {
  test,
  expect,
  openCodingSession,
  sendCodingMessage,
} from '../../helpers/agent-runtime-harness';

test('E18: explicit session agent wins over project and global defaults without fallback', async ({
  app,
  page,
}) => {
  const claude = await app.configureCodingProject('claude');
  const codex = await app.configureCodingProject('codex');
  const cursor = await app.configureCodingProject('cursor');
  await app.api(`/api/agent-profiles/${codex.profile.id}/set-default`, { method: 'POST' });
  for (const [runtime, explicit] of [
    ['cursor', cursor.profile.id],
    ['claude', undefined],
    ['codex', undefined],
  ] as const) {
    if (runtime === 'codex')
      await app.api(`/api/projects/${claude.project.id}`, {
        method: 'PUT',
        body: JSON.stringify({ defaultAgentProfileId: null }),
      });
    const session = await app.api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        projectId: claude.project.id,
        name: `${runtime} priority`,
        agentProfileId: explicit,
      }),
    });
    expect(session.agentProfileId).toBe({ claude, codex, cursor }[runtime].profile.id);
    await openCodingSession(page, app, claude.project, session);
    await sendCodingMessage(page, 'Fix addition using the selected agent.');
    await expect(
      page.getByText(`E2E_${runtime.toUpperCase()}_CODING_COMPLETE`, { exact: true })
    ).toBeVisible();
    expect(
      (await app.audit()).some(event => event.runtime === runtime && event.cwd === claude.cwd)
    ).toBe(true);
  }
  await app.api('/api/plugins/com.zclaudia.cursor/deactivate', { method: 'POST' });
  const response = await fetch(`${app.url}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: claude.project.id,
      agentProfileId: cursor.profile.id,
      name: 'No fallback',
    }),
  });
  expect(response.status).toBe(409);
  expect(JSON.stringify(await response.json())).toContain('runtime_unavailable');
});
