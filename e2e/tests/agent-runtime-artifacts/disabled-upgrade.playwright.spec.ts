import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../../helpers/agent-runtime-artifact-harness';

for (const runtime of ['claude', 'codex', 'cursor']) {
  test(`E16: ${runtime} artifact version update preserves disabled preference and user profile`, async ({
    artifactApp: app,
    bundle,
  }) => {
    await app.start();
    const profile = (await app.api('/api/agent-profiles')).find(
      (p: any) => p.runtimeType === runtime
    );
    await app.api(`/api/agent-profiles/${profile.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: `Custom ${runtime}`,
        systemPrompt: 'Retain on upgrade',
        model: 'custom-model',
      }),
    });
    await app.api(`/api/plugins/com.zclaudia.${runtime}/deactivate`, { method: 'POST' });
    await app.stop();
    const manifestPath = path.join(bundle, 'builtin-plugins', runtime, 'plugin.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.version = '0.1.1';
    await writeFile(manifestPath, JSON.stringify(manifest));
    await app.start();
    expect((await app.api('/api/plugins')).find((p: any) => p.id === manifest.id)).toMatchObject({
      version: '0.1.1',
      status: 'inactive',
      enabled: false,
      source: 'builtin',
    });
    const assertRetained = async () => {
      const profiles = (await app.api('/api/agent-profiles')).filter(
        (p: any) => p.runtimeType === runtime
      );
      expect(profiles).toHaveLength(1);
      expect(profiles[0]).toMatchObject({
        id: profile.id,
        name: `Custom ${runtime}`,
        runtimeType: runtime,
        systemPrompt: 'Retain on upgrade',
        model: 'custom-model',
        llmProfileId: '',
      });
    };
    await assertRetained();
    await app.api(`/api/plugins/com.zclaudia.${runtime}/activate`, { method: 'POST' });
    expect((await app.api('/api/plugins')).find((p: any) => p.id === manifest.id)).toMatchObject({
      version: '0.1.1',
      status: 'active',
      enabled: true,
    });
    await app.restart();
    await assertRetained();
  });
}
