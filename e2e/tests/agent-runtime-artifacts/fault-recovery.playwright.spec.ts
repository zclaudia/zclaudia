import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../../helpers/agent-runtime-artifact-harness';

for (const runtime of ['claude', 'codex', 'cursor']) {
  for (const fault of ['activation', 'missing-manifest', 'malformed-runtime']) {
    test(`E10/E15: ${runtime} ${fault} failure retains profiles and repairs through UI reload`, async ({
      artifactApp: app,
      bundle,
      page,
    }) => {
      await app.start();
      const profiles = await app.api('/api/agent-profiles');
      const profile = profiles.find((item: any) => item.runtimeType === runtime);
      await app.api(`/api/agent-profiles/${profile.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: `Retained ${runtime}`, systemPrompt: 'Keep user fields' }),
      });
      await app.stop();
      const filename = path.join(
        bundle,
        'builtin-plugins',
        runtime,
        fault === 'activation' ? 'dist/main.js' : 'plugin.json'
      );
      const original = await readFile(filename);
      if (fault === 'activation')
        await writeFile(filename, 'throw new Error("E2E activation failure");\n');
      else if (fault === 'malformed-runtime') {
        const manifest = JSON.parse(original.toString('utf8'));
        manifest.contributes.agentRuntimes = [null];
        await writeFile(filename, JSON.stringify(manifest));
      } else await rm(filename);
      await app.start();
      const plugin = (await app.api('/api/plugins')).find(
        (p: any) => p.id === `com.zclaudia.${runtime}`
      );
      expect(plugin.source).toBe('builtin');
      expect(plugin.status).toBe('error');
      expect(plugin.error).toContain(
        fault === 'activation' ? 'E2E activation failure' : 'missing or invalid'
      );
      const otherBuiltins = (await app.api('/api/plugins')).filter(
        (p: any) => p.source === 'builtin' && p.id !== plugin.id
      );
      expect(otherBuiltins).toHaveLength(2);
      expect(otherBuiltins.every((p: any) => p.status === 'active')).toBe(true);
      expect(
        (await app.api('/api/agent-profiles')).find((p: any) => p.id === profile.id)
      ).toMatchObject({
        runtimeType: runtime,
        name: `Retained ${runtime}`,
        systemPrompt: 'Keep user fields',
      });
      await page.goto(app.url);
      await page.getByRole('button', { name: 'Extensions', exact: true }).click();
      await page.getByRole('button', { name: 'Built-in', exact: true }).click();
      const label = runtime[0].toUpperCase() + runtime.slice(1) + ' Agent';
      await page.getByRole('button', { name: `Open ${label}`, exact: true }).click();
      await writeFile(filename, original);
      const reloaded = page.waitForResponse(
        response =>
          new URL(response.url()).pathname === `/api/plugins/com.zclaudia.${runtime}/reload`
      );
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Reload runtime', exact: true })
        .click();
      expect((await reloaded).ok()).toBe(true);
      const repaired = (await app.api('/api/plugins')).find(
        (p: any) => p.id === `com.zclaudia.${runtime}`
      );
      expect(repaired.status).toBe('active');
      const retained = await app.api('/api/agent-profiles');
      expect(retained.filter((p: any) => p.runtimeType === runtime)).toHaveLength(1);
      expect(retained.find((p: any) => p.id === profile.id)).toMatchObject({
        name: `Retained ${runtime}`,
        systemPrompt: 'Keep user fields',
      });
    });
  }
}
