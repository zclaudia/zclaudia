import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../../helpers/agent-runtime-harness';

test.use({ legacyData: true });

test('E12/E14: upgrade preserves profiles, defaults, sessions and pins while shadowing external copies', async ({
  app,
  page,
}) => {
  const before = await app.api('/api/agent-profiles');
  const development = path.join(app.directory, 'legacy-development');
  expect((await app.api('/api/plugins/dirs')).extraDirs).toEqual([development]);
  const retainedFiles = Object.entries(
    JSON.parse(await readFile(path.join(app.directory, 'legacy-files-before.json'), 'utf8'))
  );
  const verifyRetainedFiles = async () => {
    for (const [filename, contents] of retainedFiles)
      expect(await readFile(path.join(app.directory, filename), 'utf8')).toBe(contents);
  };
  await verifyRetainedFiles();
  expect(before).toHaveLength(4);
  for (const runtime of ['claude', 'codex', 'cursor']) {
    expect(before.find((profile: any) => profile.id === `legacy-${runtime}`)).toMatchObject({
      name: `My ${runtime}`,
      runtimeType: runtime,
      model: 'user-selected-model',
      systemPrompt: 'Retain my prompt',
      cliPath: `/legacy/cli/${runtime}`,
      isDefault: runtime === 'codex',
    });
    expect(await app.api(`/api/sessions/session-${runtime}`)).toMatchObject({
      agentProfileId: `legacy-${runtime}`,
      sdkSessionId: `provider-${runtime}`,
    });
    expect(await app.api(`/api/projects/project-${runtime}`)).toMatchObject({
      defaultAgentProfileId: `legacy-${runtime}`,
    });
    const plugin = (await app.api('/api/plugins')).find(
      (item: any) => item.id === `com.zclaudia.${runtime}`
    );
    const external = path.join(development, runtime);
    const managed = path.join(app.directory, 'data/plugins', plugin.id);
    expect(plugin).toMatchObject({
      source: 'builtin',
      status: 'active',
      version: '0.1.0',
      shadowedPaths: expect.arrayContaining([external, managed]),
      canRollback: false,
    });
    expect(plugin.shadowedPaths).toHaveLength(2);
    expect(
      JSON.parse(
        await readFile(
          path.join(app.directory, 'data/plugin-store', plugin.id, 'install-state.json'),
          'utf8'
        )
      ).activeVersion
    ).toBe('9.0.0');
    expect(await readFile(path.join(external, 'main.mjs'), 'utf8')).toBe(
      "throw new Error('Shadowed external code executed');\n"
    );
    const refs = path.join(app.directory, 'data/runtime-refs', plugin.id);
    const oldRef = JSON.parse(await readFile(path.join(refs, '9.0.0.json'), 'utf8'));
    const newRef = JSON.parse(await readFile(path.join(refs, `${plugin.version}.json`), 'utf8'));
    expect(newRef).toEqual({ ...oldRef, pluginVersion: plugin.version });
  }
  await page.goto(app.url);
  await page.getByRole('button', { name: 'Extensions', exact: true }).click();
  await page.getByRole('button', { name: 'Built-in', exact: true }).click();
  await page.getByRole('button', { name: 'Open Codex Agent', exact: true }).click();
  await expect(page.getByText('External copies retained', { exact: true })).toBeVisible();
  await expect(page.getByText(path.join(development, 'codex'), { exact: true })).toBeVisible();
  await expect(
    page.getByText(path.join(app.directory, 'data/plugins/com.zclaudia.codex'), { exact: true })
  ).toBeVisible();
  for (let count = 0; count < 2; count += 1) {
    await app.restart();
    expect(await app.api('/api/agent-profiles')).toEqual(before);
    expect((await app.api('/api/plugins/dirs')).extraDirs).toEqual([development]);
    await verifyRetainedFiles();
    for (const runtime of ['claude', 'codex', 'cursor']) {
      expect(await app.api(`/api/sessions/session-${runtime}`)).toMatchObject({
        agentProfileId: `legacy-${runtime}`,
        sdkSessionId: `provider-${runtime}`,
      });
    }
  }
});
