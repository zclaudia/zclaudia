import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../../helpers/agent-runtime-artifact-harness';
import { openCodingSession, sendCodingMessage } from '../../helpers/agent-runtime-harness';
import { installLiveMcpProbe } from '../../helpers/live-capabilities-probe';

for (const runtime of ['claude', 'codex', 'cursor']) {
  test(`E07/E20: ${runtime} retains an active bridge and resumes after idle endpoint eviction`, async ({
    artifactApp: app,
    bundle,
    page,
  }, testInfo) => {
    // Accelerate only this test's owned artifact. Production has no timeout
    // override or diagnostic endpoint; its default remains one hour.
    const entry = path.join(bundle, 'server.mjs');
    const original = await readFile(entry, 'utf8');
    const timeoutDeclaration = /\bDEFAULT_IDLE_TIMEOUT_MS = [^;]+;/g;
    expect(original.match(timeoutDeclaration)).toHaveLength(1);
    await writeFile(entry, original.replace(timeoutDeclaration, 'DEFAULT_IDLE_TIMEOUT_MS = 250;'));
    await writeFile(path.join(app.directory, 'cli-audit.jsonl'), '', { flag: 'wx' });
    await app.start();
    const probe = await installLiveMcpProbe(app);
    const run = await app.configureCodingProject(runtime);
    const fixturePath = path.join(app.directory, 'mcp.mjs');
    const fixture = await readFile(fixturePath, 'utf8');
    const marker = 'const sessionId = config.env.AGENT_TOOL_BRIDGE_SESSION_ID;';
    expect(fixture.split(marker)).toHaveLength(2);
    await writeFile(
      fixturePath,
      fixture.replace(
        marker,
        `${marker}
      appendFileSync(process.env.E2E_RUNTIME_AUDIT, JSON.stringify({ runtime,
        mcpPort: Number(new URL(config.env.AGENT_TOOL_BRIDGE_URL).port),
        bridgeSessionId: sessionId }) + '\\n');
    `
      )
    );
    await openCodingSession(page, app, run.project, run.session);
    await sendCodingMessage(page, 'E2E_MCP E2E_WAIT_FOR_CANCEL');
    const bridgeCalls = async () => (await app.audit()).filter(event => event.mcpPort);
    await expect.poll(async () => (await bridgeCalls()).length).toBe(1);
    const first = (await bridgeCalls())[0];
    const url = `http://127.0.0.1:${first.mcpPort}/v1/tools`;
    const observedAt = Date.now();
    await expect
      .poll(async () => {
        const state = await app.api(`/api/sessions/${run.session.id}/run-state`);
        expect(state.isRunning).toBe(true);
        return Date.now() - observedAt;
      })
      .toBeGreaterThanOrEqual(750);
    // No credentials are exposed to the test report. An unauthorized HTTP
    // response proves the retained listener survived three idle intervals.
    expect((await fetch(url)).status).toBe(401);
    const providerSessionId = (await app.api(`/api/sessions/${run.session.id}`)).sdkSessionId;
    expect(providerSessionId).toBeTruthy();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect
      .poll(async () => (await app.api(`/api/sessions/${run.session.id}/run-state`)).isRunning)
      .toBe(false);
    await expect
      .poll(async () => {
        try {
          await fetch(url);
          return false;
        } catch {
          return true;
        }
      })
      .toBe(true);

    await sendCodingMessage(page, 'E2E_MCP then fix addition after idle eviction');
    await expect(
      page.getByText(`E2E_${runtime.toUpperCase()}_CODING_COMPLETE`, { exact: true })
    ).toBeVisible();
    await expect
      .poll(async () => (await app.api(`/api/sessions/${run.session.id}/run-state`)).isRunning)
      .toBe(false);
    expect((await app.api(`/api/sessions/${run.session.id}`)).sdkSessionId).toBe(providerSessionId);
    expect(await readFile(path.join(run.cwd, 'add.mjs'), 'utf8')).toContain('a + b');
    const calls = await bridgeCalls();
    expect(calls).toHaveLength(2);
    expect(calls.every(event => event.bridgeSessionId === run.session.id)).toBe(true);
    const receipts = (await readFile(probe.receipt, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    expect(receipts).toHaveLength(2);
    expect(
      receipts.every(
        receipt => receipt.sessionId === run.session.id && receipt.nonce === probe.nonce
      )
    ).toBe(true);
    expect(
      (await app.audit()).some(event => event.runtime === runtime && event.testExitCode === 0)
    ).toBe(true);
    await writeFile(
      testInfo.outputPath('bridge-idle-recovery.json'),
      JSON.stringify(
        {
          runtime,
          mode: 'mutable-artifact-with-cli-fixtures',
          idleTimeoutMs: 250,
          retainedForAtLeastMs: 750,
          idleListenerClosed: true,
          providerSessionId,
          resumedSessionPreserved: true,
          mcpReceipts: receipts.length,
        },
        null,
        2
      )
    );
  });
}
