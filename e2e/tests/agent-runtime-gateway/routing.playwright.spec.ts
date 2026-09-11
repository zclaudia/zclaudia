import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  test,
  expect,
  AgentRuntimeHarness,
  sendCodingMessage,
} from '../../helpers/agent-runtime-harness';
import { AgentRuntimeGatewayHarness } from '../../helpers/agent-runtime-gateway-harness';

for (const runtime of ['claude', 'codex', 'cursor']) {
  test(`E21: ${runtime} runs and cancels on the selected Gateway backend`, async ({
    app,
    page,
  }, testInfo) => {
    const gateway = new AgentRuntimeGatewayHarness();
    const remote = new AgentRuntimeHarness();
    try {
      await gateway.start();
      await remote.start();
      const { project, session, profile, cwd } = await remote.configureCodingProject(runtime);
      profile.name = `Remote ${runtime} profile`;
      await remote.api(`/api/agent-profiles/${profile.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: profile.name }),
      });
      await app.api(`/api/plugins/com.zclaudia.${runtime}/deactivate`, { method: 'POST' });
      for (const [backend, name] of [
        [app, 'E2E client host'],
        [remote, 'E2E remote worker'],
      ] as const) {
        await backend.api('/api/server/gateway/config', {
          method: 'PUT',
          body: JSON.stringify({
            enabled: true,
            gatewayUrl: gateway.url,
            gatewaySecret: gateway.secret,
            backendName: name,
            registerAsBackend: true,
          }),
        });
        await expect
          .poll(async () => (await backend.api('/api/server/gateway/status')).connected)
          .toBe(true);
      }
      await expect
        .poll(async () =>
          (await app.api('/api/server/gateway/status')).discoveredBackends.some(
            (backend: any) => backend.name === 'E2E remote worker'
          )
        )
        .toBe(true);
      await page.goto(app.url);
      await page.getByRole('button', { name: /E2E remote worker/ }).click();
      await page.getByRole('button', { name: 'Switch to this backend', exact: true }).click();
      await page.getByText(project.name, { exact: true }).click();
      await page.getByTestId('session-item').getByText(session.name, { exact: true }).click();
      await expect(page.getByTestId('message-input')).toBeEditable();
      await sendCodingMessage(page, 'E2E_WAIT_FOR_CANCEL');
      await expect(page.getByText('Fixture task is running', { exact: true })).toBeVisible();
      await expect
        .poll(async () =>
          readFile(path.join(cwd, 'cancel-tick.txt'), 'utf8').catch(error => {
            if (error.code === 'ENOENT') return '';
            throw error;
          })
        )
        .not.toBe('');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect
        .poll(async () => (await remote.api(`/api/sessions/${session.id}/run-state`)).isRunning)
        .toBe(false);
      // Codex intentionally keeps its idle app-server for session reuse. Task
      // side effects must stop now; backend teardown checks all owned PIDs.
      await new Promise(resolve => setTimeout(resolve, 500));
      const ticks = await readFile(path.join(cwd, 'cancel-tick.txt'), 'utf8');
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(await readFile(path.join(cwd, 'cancel-tick.txt'), 'utf8')).toBe(ticks);
      await sendCodingMessage(page, 'Fix addition on the remote backend after cancellation.');
      await expect(
        page.getByText(`E2E_${runtime.toUpperCase()}_CODING_COMPLETE`, { exact: true })
      ).toBeVisible();
      expect((await remote.audit()).filter(row => row.cwd).every(row => row.cwd === cwd)).toBe(
        true
      );
      expect((await remote.audit()).some(row => row.testExitCode === 0)).toBe(true);
      await expect
        .poll(async () => (await remote.api(`/api/sessions/${session.id}/run-state`)).isRunning)
        .toBe(false);
      const persistedSession = await remote.api(`/api/sessions/${session.id}`);
      expect(persistedSession.sdkSessionId).toBeTruthy();
      await remote.stop();
      const remoteOnline = async () =>
        (await app.api('/api/server/gateway/status')).discoveredBackends.some(
          (backend: any) => backend.name === 'E2E remote worker' && backend.online
        );
      await expect.poll(remoteOnline).toBe(false);
      await remote.start();
      await expect.poll(remoteOnline).toBe(true);
      await page.reload();
      const remoteRow = page.getByRole('button', { name: /E2E remote worker/ });
      await expect(remoteRow).toBeVisible();
      if ((await remoteRow.getAttribute('aria-expanded')) !== 'true') await remoteRow.click();
      const switchBackend = remoteRow
        .locator('../..')
        .getByRole('button', { name: 'Switch to this backend', exact: true });
      if (await switchBackend.isVisible()) await switchBackend.click();
      await page.getByText(project.name, { exact: true }).click();
      await page.getByTestId('session-item').getByText(session.name, { exact: true }).click();
      await expect(page.getByTestId('message-input')).toBeEditable();
      await expect(
        page.getByText(`E2E_${runtime.toUpperCase()}_CODING_COMPLETE`, { exact: true })
      ).toBeVisible();
      await sendCodingMessage(page, 'Continue coding after the remote backend restarted.');
      await expect(
        page.getByText(`E2E_${runtime.toUpperCase()}_CODING_COMPLETE`, { exact: true })
      ).toHaveCount(2);
      await expect
        .poll(async () => (await remote.api(`/api/sessions/${session.id}/run-state`)).isRunning)
        .toBe(false);
      expect(await remote.api(`/api/sessions/${session.id}`)).toMatchObject({
        id: session.id,
        agentProfileId: profile.id,
        sdkSessionId: persistedSession.sdkSessionId,
      });
      expect((await remote.audit()).some(row => row.resume === persistedSession.sdkSessionId)).toBe(
        true
      );
      await expect(app.audit()).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await app.api('/api/sessions')).some((item: any) => item.id === session.id)).toBe(
        false
      );
      await page.getByRole('button', { name: 'Agents', exact: true }).click();
      await page.getByRole('button', { name: profile.name, exact: true }).click();
      await expect(page.getByLabel('CLI Path (optional)', { exact: true })).toHaveValue(
        path.join(remote.directory, `${runtime}-fixture`)
      );
      await page.getByRole('button', { name: 'Back to app', exact: true }).click();
      await page.getByRole('button', { name: 'Extensions', exact: true }).click();
      await page.getByRole('button', { name: 'Built-in', exact: true }).click();
      const label = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor' }[runtime];
      await expect(
        page.getByRole('switch', { name: `Disable ${label} Agent`, exact: true })
      ).toBeVisible();
      const inspected = page.waitForResponse(response =>
        new URL(response.url()).pathname.endsWith('/api/managed-runtimes')
      );
      await page.getByRole('button', { name: `Open ${label} Agent`, exact: true }).click();
      const response = await inspected;
      const remoteId = (await app.api('/api/server/gateway/status')).discoveredBackends.find(
        (backend: any) => backend.name === 'E2E remote worker'
      ).backendId;
      expect(new URL(response.url()).pathname).toBe(
        `/api/gateway-proxy/${remoteId}/api/managed-runtimes`
      );
      const resolution = (await response.json()).data.find(
        (item: any) => item.pluginId === `com.zclaudia.${runtime}`
      ).resolution;
      expect(resolution).toEqual(
        (await remote.api('/api/managed-runtimes')).find(
          (item: any) => item.pluginId === `com.zclaudia.${runtime}`
        ).resolution
      );
      await expect(
        page.getByRole('region', { name: 'Runtime status' }).locator('dd').last()
      ).toHaveText(resolution.authState);
      await page.getByRole('button', { name: 'Configure agent profiles', exact: true }).click();
      await page.getByRole('button', { name: profile.name, exact: true }).click();
      await expect(page.getByLabel('CLI Path (optional)', { exact: true })).toHaveValue(
        path.join(remote.directory, `${runtime}-fixture`)
      );
    } finally {
      try {
        await remote.stop();
        await app.stop();
      } finally {
        try {
          await writeFile(
            testInfo.outputPath('remote-server.log'),
            remote.logs.replaceAll(gateway.secret, '[redacted]')
          );
          app.logs = app.logs.replaceAll(gateway.secret, '[redacted]');
          await remote.saveAudit(testInfo.outputPath('remote-cli-audit.json'));
          await writeFile(testInfo.outputPath('gateway.log'), gateway.logs);
          if (gateway.directory)
            await writeFile(
              testInfo.outputPath('gateway-artifact.json'),
              await readFile(path.join(gateway.directory, 'artifact.json'))
            );
        } finally {
          try {
            await remote.dispose();
          } finally {
            await gateway.dispose();
          }
        }
      }
    }
  });
}
