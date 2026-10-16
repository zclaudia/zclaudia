import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../../helpers/agent-runtime-harness';
import { AgentRuntimeGatewayHarness } from '../../helpers/agent-runtime-gateway-harness';

for (const transientFailures of [0, 2]) {
  test(`original session recovers after freeze with missed heartbeats and ${transientFailures} HTTP failures`, async ({
    app,
    browser,
  }, testInfo) => {
    const setup = await app.configureCodingProject('claude');
    const gateway = new AgentRuntimeGatewayHarness();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const mobile = await context.newPage();
    let background = false;
    let suppressHeartbeats = false;
    let heartbeatsDropped = 0;
    let recoveryAttempts = 0;
    let injectHttpFaults = false;
    let dataChannels = 0;
    let droppedTerminalEvents = 0;
    await mobile.routeWebSocket(/\/channel\//, socket => {
      dataChannels++;
      const server = socket.connectToServer();
      server.onMessage(raw => {
        const message = JSON.parse(raw.toString());
        if (background && (message.type === 'run_completed' || message.type === 'run_failed'))
          droppedTerminalEvents++;
        if (message.type === 'state_heartbeat' && suppressHeartbeats) {
          heartbeatsDropped++;
          return;
        }
        if (!background) socket.send(raw);
      });
      socket.onMessage(raw => server.send(raw));
    });
    await mobile.route(
      url => url.pathname.endsWith(`/api/sessions/${setup.session.id}/messages`),
      async route => {
        if (injectHttpFaults && recoveryAttempts++ < transientFailures) {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
              success: false,
              error: { code: 'WAKE_TRANSIENT', message: 'Injected transient wake failure' },
            }),
          });
        } else await route.continue();
      }
    );
    try {
      await gateway.start({ issuedCredentials: true });
      await app.api('/api/server/gateway/config', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: true,
          gatewayUrl: gateway.url,
          gatewaySecret: gateway.backendSecret,
          backendName: 'Resume backend',
          registerAsBackend: true,
        }),
      });
      await expect
        .poll(async () => (await app.api('/api/server/gateway/status')).connected)
        .toBe(true);
      await mobile.goto(app.url);
      await mobile.getByPlaceholder('http://gateway.example.com:3200').fill(gateway.url);
      await mobile.getByPlaceholder('Enter gateway secret').fill(gateway.clientSecret);
      await mobile.getByRole('button', { name: 'Connect', exact: true }).click();
      await mobile.getByRole('button', { name: /Resume backend/ }).click();
      await mobile.getByRole('button', { name: 'Open menu', exact: true }).click();
      await mobile.getByRole('button', { name: setup.project.name, exact: true }).click();
      await mobile
        .getByTestId('session-item')
        .getByText(setup.session.name, { exact: true })
        .click();
      const input = mobile.getByPlaceholder(/^Type a message/);
      await expect(input).toBeEditable();
      await input.fill('E2E_RESUME_FINISH');
      await mobile.getByRole('button', { name: 'Send message', exact: true }).click();
      await expect(mobile.getByText('E2E_RESUME_PARTIAL', { exact: true })).toBeVisible();
      await expect(mobile.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
      expect((await app.api(`/api/sessions/${setup.session.id}/run-state`)).isRunning).toBe(true);
      expect(dataChannels).toBeGreaterThan(0);

      // Only shell lifecycle signals are simulated; no store or business events
      // are injected. The real agent finishes while the browser is frozen.
      await mobile.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent('zclaudia:app-lifecycle', { detail: { active: false } })
        )
      );
      background = true;
      suppressHeartbeats = true;
      const cdp = await context.newCDPSession(mobile);
      await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
      await writeFile(
        path.join(setup.cwd, 'concurrency-release'),
        'finish while mobile is backgrounded'
      );
      await expect
        .poll(async () => (await app.api(`/api/sessions/${setup.session.id}/run-state`)).isRunning)
        .toBe(false);
      expect(await readFile(path.join(setup.cwd, 'add.mjs'), 'utf8')).toContain('a + b');
      const persisted = await app.api(`/api/sessions/${setup.session.id}/messages?limit=100`);
      expect(JSON.stringify(persisted)).toContain('E2E_CLAUDE_CODING_COMPLETE');
      await expect.poll(() => droppedTerminalEvents).toBeGreaterThan(0);

      injectHttpFaults = true;
      background = false;
      const resumedAt = Date.now();
      await cdp.send('Page.setWebLifecycleState', { state: 'active' });
      await mobile.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent('zclaudia:app-lifecycle', { detail: { active: true } })
        )
      );
      // No refresh, session switch, send or approval after resume.
      await expect(mobile.getByText(/E2E_CLAUDE_CODING_COMPLETE/)).toBeVisible({ timeout: 15_000 });
      await expect(mobile.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0, {
        timeout: 15_000,
      });
      expect(recoveryAttempts).toBeGreaterThanOrEqual(transientFailures + 1);
      expect(heartbeatsDropped).toBeGreaterThan(0);
      await writeFile(
        testInfo.outputPath('recovery.json'),
        JSON.stringify(
          {
            elapsedMs: Date.now() - resumedAt,
            recoveryAttempts,
            heartbeatsDropped,
            droppedTerminalEvents,
            sessionId: setup.session.id,
          },
          null,
          2
        )
      );
      await mobile.screenshot({ path: testInfo.outputPath('recovered-mobile.png') });
    } finally {
      try {
        await context.close();
        await app.stop();
      } finally {
        for (const secret of [gateway.secret, gateway.backendSecret, gateway.clientSecret])
          app.logs = app.logs.replaceAll(secret, '[redacted]');
        try {
          await writeFile(testInfo.outputPath('gateway.log'), gateway.logs);
        } finally {
          await gateway.dispose();
        }
      }
    }
  });
}
