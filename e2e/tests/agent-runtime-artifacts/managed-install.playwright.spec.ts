import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../../helpers/agent-runtime-artifact-harness';
import { openCodingSession, sendCodingMessage } from '../../helpers/agent-runtime-harness';

for (const runtime of ['claude', 'codex']) {
  const version = runtime === 'claude' ? '2.1.181' : '0.144.1';
  const label = runtime[0].toUpperCase() + runtime.slice(1);
  test(`E11/E16/E17: ${runtime} login guidance, install confirmation, bad digest and offline pin update`, async ({
    artifactApp: app,
    bundle,
    page,
  }) => {
    const payload = path.join(app.directory, 'download-payload');
    await mkdir(path.join(payload, 'bin'), { recursive: true });
    await writeFile(
      path.join(payload, 'bin/cli.mjs'),
      await readFile(`e2e/fixtures/agent-runtimes/${runtime}/cli.mjs`)
    );
    await writeFile(
      path.join(payload, 'bin/mcp.mjs'),
      await readFile('e2e/fixtures/agent-runtimes/mcp.mjs')
    );
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    await writeFile(
      path.join(payload, `bin/${runtime}`),
      `#!/bin/sh\nif ${runtime === 'claude' ? '[ "$1" = auth ] && [ "$2" = login ]' : '[ "$1" = login ] && [ -z "$2" ]'}; then\n  rm -f "${'$'}{E2E_RUNTIME_AUDIT}.auth-required"\nfi\nif [ "$1" = ${runtime === 'claude' ? 'auth' : 'login'} ] && [ -f "${'$'}{E2E_RUNTIME_AUDIT}.auth-required" ]; then\n  echo '${runtime === 'claude' ? '{"loggedIn":false}' : 'Not logged in'}'\n  exit 1\nfi\nexec ${quote(process.execPath)} "$(dirname "$0")/cli.mjs" "$@"\n`
    );
    await chmod(path.join(payload, `bin/${runtime}`), 0o755);
    const archive = path.join(app.directory, `${runtime}.tar.gz`);
    execFileSync('tar', ['-czf', archive, '-C', payload, 'bin']);
    const bytes = await readFile(archive);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const requests: string[] = [];
    const mirror = createServer((request, response) => {
      requests.push(request.url ?? '');
      if (request.url !== `/${runtime}.tar.gz`) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'application/gzip',
        'Content-Length': bytes.length,
      });
      response.end(bytes);
    });
    await new Promise<void>(resolve => mirror.listen(0, '127.0.0.1', resolve));
    const address = mirror.address();
    if (!address || typeof address === 'string') throw new Error('Mirror has no TCP port');
    const origin = `http://127.0.0.1:${address.port}`;
    const stopMirror = () =>
      new Promise<void>((resolve, reject) => {
        if (!mirror.listening) {
          resolve();
          return;
        }
        const timeout = setTimeout(
          () => reject(new Error('Fixture mirror did not close within 5 seconds')),
          5000
        );
        mirror.close(error => {
          clearTimeout(timeout);
          if (error) reject(error);
          else resolve();
        });
        mirror.closeAllConnections();
      });
    try {
      await mkdir(path.join(app.directory, 'data'), { recursive: true });
      await writeFile(
        path.join(app.directory, 'data/managed-runtime-settings.json'),
        JSON.stringify({
          schemaVersion: 1,
          policy: 'managed-ask',
          trustedPublishers: [],
          enterpriseMirrorOrigins: [origin],
        })
      );
      const descriptorPath = path.join(
        bundle,
        `builtin-plugins/${runtime}/runtime-compatibility.json`
      );
      const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'));
      const artifact = {
        url: `${origin}/${runtime}.tar.gz`,
        sha256: '0'.repeat(64),
        archiveFormat: 'tar.gz',
        executablePath: `bin/${runtime}`,
        size: bytes.length,
      };
      descriptor.managedInstall.versions = [
        {
          version: version,
          artifacts: { [`${process.platform}-${process.arch}`]: artifact },
        },
      ];
      await writeFile(descriptorPath, JSON.stringify(descriptor));
      await app.start();
      const status = async () =>
        (await app.api('/api/managed-runtimes')).find((p: any) => p.runtime === runtime);
      expect((await status()).resolution.status).toBe('needs-approval');
      expect(requests).toHaveLength(0);
      await page.goto(app.url);
      await page.getByRole('button', { name: 'Extensions', exact: true }).click();
      await page.getByRole('button', { name: 'Built-in', exact: true }).click();
      await page.getByRole('button', { name: `Open ${label} Agent`, exact: true }).click();
      const runtimeStatus = page.getByLabel('Runtime status');
      await runtimeStatus.getByRole('button', { name: 'Install CLI', exact: true }).click();
      const confirmation = page.getByRole('dialog', {
        name: `Install ${runtime} CLI?`,
        exact: true,
      });
      await expect(confirmation).toContainText(artifact.url);
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
      await runtimeStatus.getByRole('button', { name: 'Refresh status', exact: true }).click();
      await expect(runtimeStatus.getByText('needs-approval', { exact: true })).toBeVisible();
      expect(requests).toHaveLength(0);
      await runtimeStatus.getByRole('button', { name: 'Install CLI', exact: true }).click();
      await confirmation.getByRole('button', { name: 'Install CLI', exact: true }).click();
      await expect(runtimeStatus.getByRole('alert')).toContainText('SHA-256 mismatch');
      expect(requests).toEqual([`/${runtime}.tar.gz`]);
      expect((await status()).resolution.status).toBe('needs-approval');
      const refPath = path.join(
        app.directory,
        `data/runtime-refs/com.zclaudia.${runtime}/0.1.0.json`
      );
      await expect(readFile(refPath)).rejects.toMatchObject({ code: 'ENOENT' });
      artifact.sha256 = sha256;
      await writeFile(descriptorPath, JSON.stringify(descriptor));
      await app.api(`/api/plugins/com.zclaudia.${runtime}/reload`, { method: 'POST' });
      await runtimeStatus.getByRole('button', { name: 'Refresh status', exact: true }).click();
      await expect(runtimeStatus.getByText('needs-approval', { exact: true })).toBeVisible();
      await runtimeStatus.getByRole('button', { name: 'Install CLI', exact: true }).click();
      await confirmation.getByRole('button', { name: 'Install CLI', exact: true }).click();
      await expect(runtimeStatus.getByText('resolved', { exact: true })).toBeVisible();
      expect((await status()).resolution).toMatchObject({
        status: 'resolved',
        source: 'managed',
        version: version,
        verification: { checksumVerified: true, sha256 },
      });
      expect(requests).toEqual([`/${runtime}.tar.gz`, `/${runtime}.tar.gz`]);
      const authMarker = path.join(app.directory, 'cli-audit.jsonl.auth-required');
      await writeFile(authMarker, 'fixture signed out');
      await runtimeStatus.getByRole('button', { name: 'Refresh status', exact: true }).click();
      await expect(runtimeStatus.getByText('auth-required', { exact: true })).toHaveCount(2);
      await expect(runtimeStatus).toContainText('requires authentication');
      const signedOutProfile = (await app.api('/api/agent-profiles')).find(
        (p: any) => p.runtimeType === runtime
      );
      expect(signedOutProfile.recordStatus.availability.usable).toBe(false);
      await expect(
        runtimeStatus.getByRole('link', { name: 'Official login instructions' })
      ).toBeVisible();
      const command = await runtimeStatus.getByLabel('Login command', { exact: true }).innerText();
      expect(command).toBe(
        `${quote((await status()).resolution.executablePath)} ${runtime === 'claude' ? 'auth login' : 'login'}`
      );
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await runtimeStatus.getByRole('button', { name: 'Copy login command', exact: true }).click();
      await expect(
        runtimeStatus.getByRole('button', { name: 'Copied login command', exact: true })
      ).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
      // Execute only the copied command whose exact private fixture path was
      // checked above. This simulates the user's CLI login, not vendor OAuth.
      execFileSync('/bin/sh', ['-c', command], {
        env: {
          PATH: '/usr/bin:/bin',
          E2E_RUNTIME_AUDIT: path.join(app.directory, 'cli-audit.jsonl'),
        },
        timeout: 5000,
      });
      await expect(readFile(authMarker)).rejects.toMatchObject({ code: 'ENOENT' });
      await runtimeStatus.getByRole('button', { name: 'Refresh status', exact: true }).click();
      await expect(runtimeStatus.getByText('resolved', { exact: true })).toBeVisible();
      const originalRef = await readFile(refPath, 'utf8');
      expect(JSON.parse(originalRef).selectedVersion).toBe(version);
      const { project, session, profile, cwd } = await app.configureCodingProject(runtime);
      await app.api(`/api/agent-profiles/${profile.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          cliPath: '',
          name: `My pinned ${label}`,
          systemPrompt: 'Retain across upgrade',
        }),
      });
      await app.stop();
      await stopMirror();
      const manifestPath = path.join(bundle, `builtin-plugins/${runtime}/plugin.json`);
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      manifest.version = '0.1.1';
      await writeFile(manifestPath, JSON.stringify(manifest));
      await app.start();
      expect((await status()).resolution).toMatchObject({
        status: 'resolved',
        source: 'managed',
        pluginVersion: '0.1.1',
        version: version,
      });
      expect(await readFile(refPath, 'utf8')).toBe(originalRef);
      expect(
        JSON.parse(await readFile(path.join(path.dirname(refPath), '0.1.1.json'), 'utf8'))
      ).toMatchObject({
        selectedVersion: version,
        pluginVersion: '0.1.1',
      });
      const retainedProfile = (await app.api('/api/agent-profiles')).find(
        (p: any) => p.id === profile.id
      );
      expect(retainedProfile).toMatchObject({
        runtimeType: runtime,
        name: `My pinned ${label}`,
        systemPrompt: 'Retain across upgrade',
      });
      expect(retainedProfile.cliPath ?? '').toBe('');
      await openCodingSession(page, app, project, session);
      await sendCodingMessage(page, 'Fix addition and run the test using the pinned offline CLI.');
      await expect(
        page.getByText(`E2E_${runtime.toUpperCase()}_CODING_COMPLETE`, { exact: true })
      ).toBeVisible();
      expect(await readFile(path.join(cwd, 'add.mjs'), 'utf8')).toContain('a + b');
      expect((await app.audit()).some(event => event.testExitCode === 0)).toBe(true);
      expect(requests).toHaveLength(2);
    } finally {
      await stopMirror();
    }
  });
}
