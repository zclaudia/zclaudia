import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type AgentRuntimeHarness, openCodingSession } from './agent-runtime-harness';
import { runLiveUiTurn, withLiveDeadline } from './live-probe-support';

export async function installLiveMcpProbe(app: AgentRuntimeHarness) {
  const nonce = randomUUID();
  const receipt = path.join(app.directory, 'live-mcp-receipts.jsonl');
  const directory = path.join(app.directory, 'data/plugins/live-mcp-probe');
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'plugin.json'),
    JSON.stringify({
      id: 'e2e.live-mcp-probe',
      name: 'Live MCP acceptance probe',
      version: '1.0.0',
      description: 'Session-bound acceptance tool',
      main: 'main.mjs',
    })
  );
  await writeFile(
    path.join(directory, 'main.mjs'),
    `
    import { appendFileSync } from 'node:fs';
    export function activate(context) {
      context.tools.registerTool({ id: 'e2e_session_probe', name: 'e2e_session_probe',
        description: 'Return the current session and the supplied marker for acceptance verification',
        parameters: { type:'object', properties:{ marker:{type:'string'} }, required:['marker'] },
        handler: async (args, ctx) => {
          const result = { sessionId:ctx.sessionId, marker:args.marker, nonce:${JSON.stringify(nonce)} };
          appendFileSync(${JSON.stringify(receipt)}, JSON.stringify(result)+'\\n');
          return JSON.stringify(result);
        }
      });
    }
    export function deactivate() {}
  `
  );
  await app.api('/api/plugins/discover', { method: 'POST' });
  await app.api('/api/plugins/e2e.live-mcp-probe/activate', { method: 'POST' });
  return { nonce, receipt };
}

export async function runLiveCapabilitiesProbe(
  page: Page,
  app: AgentRuntimeHarness,
  run: any,
  options: { runtime: string; selfTest: boolean; turnTimeoutMs: number },
  evidence: Record<string, any>
) {
  const { project, session, cwd } = run;
  const results: any[] = [];
  evidence.capabilities = results;
  const sourcePath = path.join(cwd, 'add.mjs');
  const original = await readFile(sourcePath, 'utf8');
  const allow = () => page.getByRole('button', { name: 'Allow', exact: true }).click();
  if (options.runtime === 'cursor') {
    await openCodingSession(page, app, project, session);
    await expect(page.getByText('CLI permissions', { exact: true })).toBeVisible();
    for (const [index, mode] of ['plan', 'ask'].entries()) {
      evidence.failureStep = `mode-${mode}`;
      const result = await withLiveDeadline(
        app,
        evidence,
        index + 1,
        options.turnTimeoutMs,
        async () => {
          await page.getByRole('button', { name: 'Agent mode', exact: true }).click();
          await page
            .getByRole('option', { name: new RegExp(`^${mode === 'plan' ? 'Plan' : 'Ask'}`) })
            .click();
          return runLiveUiTurn(
            page,
            app,
            session.id,
            options.selfTest
              ? `E2E_MODE ${mode}: inspect addition`
              : 'Read add.mjs and explain its addition bug. This is a read-only inspection; do not edit files or run commands that change files.',
            options.turnTimeoutMs,
            async () => {
              throw new Error('Cursor unexpectedly requested host per-tool approval');
            }
          );
        }
      );
      expect(await readFile(sourcePath, 'utf8')).toBe(original);
      expect(result.approvals).toBe(0);
      results.push({
        turn: index + 1,
        kind: 'mode',
        mode,
        filesUnchanged: true,
        status: 'passed',
        ...result,
      });
    }
    await page.getByRole('button', { name: 'Agent mode', exact: true }).click();
    await page.getByRole('option', { name: /^Default/ }).click();
  } else {
    await app.api(`/api/projects/${project.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        agentPermissionOverride: { escalateAlways: ['Bash'], aiReview: { enabled: false } },
      }),
    });
    await openCodingSession(page, app, project, session);
    const sideEffect = path.join(cwd, 'approval-side-effect.txt');
    for (const [index, decision] of ['allow', 'deny'].entries()) {
      evidence.failureStep = `approval-${decision}`;
      await rm(sideEffect, { force: true });
      let decisions = 0;
      const result = await withLiveDeadline(app, evidence, index + 1, options.turnTimeoutMs, () =>
        runLiveUiTurn(
          page,
          app,
          session.id,
          options.selfTest
            ? `E2E_PERMISSION check-${index + 1}`
            : `Approval check ${index + 1}: run exactly this shell command in the project: \`printf approved > approval-side-effect.txt\`. Wait for my approval. If denied, stop and report the denial without retrying or using another tool. Do not edit other files, read account configuration or environment variables, or access the network.`,
          options.turnTimeoutMs,
          async () => {
            const request = page.getByRole('group', { name: 'Permission request', exact: true });
            await expect(request).toContainText('approval-side-effect.txt');
            if (decisions++ === 0)
              await expect(readFile(sideEffect)).rejects.toMatchObject({ code: 'ENOENT' });
            await request
              .getByRole('button', { name: decision === 'allow' ? 'Allow' : 'Deny', exact: true })
              .click();
          },
          decision === 'deny'
        )
      );
      expect(decisions).toBeGreaterThan(0);
      if (decision === 'allow') expect(await readFile(sideEffect, 'utf8')).toBe('approved');
      else await expect(readFile(sideEffect)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(sourcePath, 'utf8')).toBe(original);
      results.push({
        turn: index + 1,
        kind: 'approval',
        decision,
        sideEffectPresent: decision === 'allow',
        status: 'passed',
        ...result,
      });
    }
  }
  evidence.failureStep = 'mcp-call';
  const probe = await installLiveMcpProbe(app);
  const marker = `E2E_MCP_${session.id}`;
  const result = await withLiveDeadline(app, evidence, 3, options.turnTimeoutMs, () =>
    runLiveUiTurn(
      page,
      app,
      session.id,
      options.selfTest
        ? 'E2E_MCP then fix addition'
        : `Call the e2e_session_probe MCP tool with marker exactly ${marker}. Report its result. Use the MCP tool itself, not a shell or HTTP request. Do not read account configuration, environment variables or other files.`,
      options.turnTimeoutMs,
      allow
    )
  );
  const receipts = (await readFile(probe.receipt, 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  expect(receipts.length).toBeGreaterThan(0);
  for (const receipt of receipts)
    expect(receipt).toEqual({ sessionId: session.id, marker, nonce: probe.nonce });
  results.push({
    turn: 3,
    kind: 'mcp',
    status: 'passed',
    tool: 'e2e_session_probe',
    sessionId: session.id,
    marker,
    verifiedCalls: receipts.length,
    hostReceiptVerified: true,
    ...result,
  });
  expect(new Set(results.map(result => result.sdkSessionId)).size).toBe(1);
  expect((await app.api(`/api/sessions/${session.id}`)).agentProfileId).toBe(run.profile.id);
  delete evidence.failureStep;
}
