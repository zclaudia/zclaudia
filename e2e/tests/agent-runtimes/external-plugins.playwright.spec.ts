import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../../helpers/agent-runtime-harness';

test('E12/E13: external IDs cannot replace built-ins and ordinary development plugins retain their lifecycle', async ({
  app,
}) => {
  const profiles = (await app.api('/api/agent-profiles')).map((profile: any) => profile.id);
  const development = path.join(app.directory, 'external-development');
  for (const runtime of ['claude', 'codex', 'cursor']) {
    for (const kind of ['same-id', 'same-runtime']) {
      const directory = path.join(development, `${runtime}-${kind}`);
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, 'plugin.json'),
        JSON.stringify({
          id: kind === 'same-id' ? `com.zclaudia.${runtime}` : `external.${runtime}`,
          name: 'Shadowed external agent',
          version: '999.0.0',
          description: 'Must not execute',
          main: 'main.mjs',
          activationEvents: ['onStartup'],
          contributes: { agentRuntimes: [{ type: runtime }] },
        })
      );
      await writeFile(
        path.join(directory, 'main.mjs'),
        "throw new Error('External code executed');\n"
      );
    }
  }
  const ordinary = path.join(development, 'ordinary');
  await mkdir(ordinary, { recursive: true });
  await writeFile(
    path.join(ordinary, 'plugin.json'),
    JSON.stringify({
      id: 'e2e.ordinary',
      name: 'Ordinary fixture',
      description: 'Ordinary lifecycle',
      version: '1.0.0',
      main: 'main.mjs',
    })
  );
  await writeFile(
    path.join(ordinary, 'main.mjs'),
    'export function activate() {} export function deactivate() {}'
  );
  await app.api('/api/plugins/dirs', {
    method: 'PUT',
    body: JSON.stringify({ dirs: [development] }),
  });
  await app.api('/api/plugins/discover', { method: 'POST' });
  const plugins = await app.api('/api/plugins');
  for (const runtime of ['claude', 'codex', 'cursor']) {
    const builtin = plugins.find((plugin: any) => plugin.id === `com.zclaudia.${runtime}`);
    expect(builtin).toMatchObject({ source: 'builtin', status: 'active', version: '0.1.0' });
    expect(builtin.shadowedPaths).toEqual(
      expect.arrayContaining(
        ['same-id', 'same-runtime'].map(kind => path.join(development, `${runtime}-${kind}`))
      )
    );
    expect(plugins.some((plugin: any) => plugin.id === `external.${runtime}`)).toBe(false);
    expect(await readFile(path.join(development, `${runtime}-same-id/main.mjs`), 'utf8')).toBe(
      "throw new Error('External code executed');\n"
    );
  }
  for (const action of ['activate', 'deactivate', 'activate', 'reload'])
    await app.api(`/api/plugins/e2e.ordinary/${action}`, { method: 'POST' });
  await app.api('/api/plugins/e2e.ordinary', { method: 'DELETE' });
  expect((await app.api('/api/plugins')).some((plugin: any) => plugin.id === 'e2e.ordinary')).toBe(
    false
  );
  expect((await app.api('/api/agent-profiles')).map((profile: any) => profile.id)).toEqual(
    profiles
  );
});
