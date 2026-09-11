import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../../helpers/agent-runtime-harness';
import { buildZip } from '../../../server/src/application/plugins/__tests__/zip-test-utils';

function packageBytes(id: string, runtime?: string) {
  return buildZip([
    {
      name: 'plugin.json',
      data: JSON.stringify({
        id,
        name: 'Ordinary packaged fixture',
        version: '1.0.0',
        description: 'Owned package lifecycle fixture',
        main: 'main.mjs',
        activationEvents: ['onStartup'],
        ...(runtime ? { contributes: { agentRuntimes: [{ type: runtime }] } } : {}),
      }),
    },
    {
      name: 'main.mjs',
      data:
        runtime || id.startsWith('com.zclaudia.')
          ? "throw new Error('Reserved package executed');"
          : 'export function activate() {} export function deactivate() {}',
    },
  ]).buffer;
}

test('E12: packaged plugins cannot claim any built-in ID or runtime', async ({ app }) => {
  const profiles = (await app.api('/api/agent-profiles')).map((profile: any) => profile.id);
  for (const runtime of ['claude', 'codex', 'cursor']) {
    for (const kind of ['same-id', 'same-runtime']) {
      const id = kind === 'same-id' ? `com.zclaudia.${runtime}` : `external.${runtime}`;
      const archive = packageBytes(id, kind === 'same-runtime' ? runtime : undefined);
      const form = new FormData();
      form.set('package', new Blob([archive]), `${runtime}-${kind}.zplugin`);
      const response = await fetch(`${app.url}/api/plugins/packages/inspect`, {
        method: 'POST',
        body: form,
      });
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe(
        kind === 'same-id' ? 'BUILTIN_PLUGIN' : 'BUILTIN_RUNTIME_RESERVED'
      );
      await expect(
        readFile(path.join(app.directory, 'data', 'plugins', id, 'plugin.json'))
      ).rejects.toMatchObject({ code: 'ENOENT' });
    }
  }
  expect(
    (await app.api('/api/plugins')).filter((plugin: any) => plugin.source === 'builtin')
  ).toHaveLength(3);
  expect((await app.api('/api/plugins')).every((plugin: any) => plugin.status === 'active')).toBe(
    true
  );
  expect((await app.api('/api/agent-profiles')).map((profile: any) => profile.id)).toEqual(
    profiles
  );
});

test('E12: malformed runtime declarations are rejected without breaking discovery or restart', async ({
  app,
}) => {
  const profiles = (await app.api('/api/agent-profiles')).map((profile: any) => profile.id);
  for (const [index, agentRuntimes] of [{ type: 'codex' }, [null]].entries()) {
    const manifest = {
      id: `e2e.malformed${index}`,
      name: 'Malformed runtime fixture',
      description: 'Invalid declaration must never execute',
      version: '1.0.0',
      main: 'main.mjs',
      activationEvents: ['onStartup'],
      contributes: { agentRuntimes },
    };
    const archive = buildZip([
      { name: 'plugin.json', data: JSON.stringify(manifest) },
      { name: 'main.mjs', data: "throw new Error('Malformed plugin executed')" },
    ]).buffer;
    const form = new FormData();
    form.set('package', new Blob([archive]), `malformed-${index}.zplugin`);
    const response = await fetch(`${app.url}/api/plugins/packages/inspect`, {
      method: 'POST',
      body: form,
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('INVALID_MANIFEST');

    const pluginDir = path.join(app.directory, 'data/plugins', manifest.id);
    await mkdir(pluginDir, { recursive: true });
    const filename = index === 0 ? 'plugin.json' : 'package.json';
    await writeFile(
      path.join(pluginDir, filename),
      JSON.stringify(index === 0 ? manifest : { ...manifest, contributes: {}, claudia: manifest })
    );
    await writeFile(
      path.join(pluginDir, 'main.mjs'),
      "throw new Error('Malformed plugin executed')"
    );
  }
  await app.api('/api/plugins/discover', { method: 'POST' });
  await app.stop();
  await app.start();
  const plugins = await app.api('/api/plugins');
  expect(plugins).toHaveLength(3);
  expect(
    plugins.every((plugin: any) => plugin.source === 'builtin' && plugin.status === 'active')
  ).toBe(true);
  expect((await app.api('/api/agent-profiles')).map((profile: any) => profile.id)).toEqual(
    profiles
  );
});

test('E13: ordinary zplugin installs through UI and retains activation and uninstall', async ({
  app,
  page,
}) => {
  const profiles = (await app.api('/api/agent-profiles')).map((profile: any) => profile.id);
  const archive = path.join(app.directory, 'ordinary.zplugin');
  await writeFile(archive, packageBytes('e2e.packaged'));
  await page.goto(app.url);
  await page.getByRole('button', { name: 'Extensions', exact: true }).click();
  await page.getByRole('button', { name: 'Plugins', exact: true }).click();
  await page.getByRole('button', { name: 'Install plugin', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Install plugin', exact: true });
  await dialog.getByLabel('Choose plugin package').setInputFiles(archive);
  await dialog.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(
    dialog.getByText('Ordinary packaged fixture installed', { exact: true })
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  const installed = () =>
    app
      .api('/api/plugins')
      .then((plugins: any[]) => plugins.find(plugin => plugin.id === 'e2e.packaged'));
  expect(await installed()).toMatchObject({
    source: 'managed',
    status: 'inactive',
    version: '1.0.0',
  });
  await page.getByRole('switch', { name: 'Enable Ordinary packaged fixture', exact: true }).click();
  await expect.poll(async () => (await installed()).status).toBe('active');
  await app.stop();
  await app.start();
  await page.goto(app.url);
  await page.getByRole('button', { name: 'Extensions', exact: true }).click();
  await page.getByRole('button', { name: 'Plugins', exact: true }).click();
  await expect(
    page.getByRole('switch', { name: 'Disable Ordinary packaged fixture', exact: true })
  ).toBeVisible();
  await page
    .getByRole('switch', { name: 'Disable Ordinary packaged fixture', exact: true })
    .click();
  await page.getByRole('button', { name: 'Open Ordinary packaged fixture', exact: true }).click();
  await page.getByRole('button', { name: 'Uninstall', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Uninstall plugin?', exact: true })
    .getByRole('button', { name: 'Uninstall', exact: true })
    .click();
  await expect.poll(installed).toBeUndefined();
  expect((await app.api('/api/agent-profiles')).map((profile: any) => profile.id)).toEqual(
    profiles
  );
});
