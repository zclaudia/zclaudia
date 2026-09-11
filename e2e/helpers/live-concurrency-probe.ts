import { expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type AgentRuntimeHarness, openCodingSession } from './agent-runtime-harness';
import { installLiveMcpProbe } from './live-capabilities-probe';
import { runLiveCancellationProbe } from './live-cancellation-probe';
import {
  liveMessageSummary,
  liveMessagesAfter,
  pause,
  runLiveUiTurn,
  withLiveDeadline,
} from './live-probe-support';

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export async function runLiveConcurrencyProbe(
  page: Page,
  peerPage: Page,
  app: AgentRuntimeHarness,
  primary: any,
  peer: any,
  options: { runtime: string; peerRuntime: string; selfTest: boolean; turnTimeoutMs: number },
  evidence: Record<string, any>
) {
  const probe = await installLiveMcpProbe(app);
  const markerA = `E2E_MCP_${primary.session.id}`;
  const markerB = `E2E_MCP_${peer.session.id}`;
  const requiresApproval = options.peerRuntime !== 'cursor';
  if (requiresApproval)
    await app.api(`/api/projects/${peer.project.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        agentPermissionOverride: { escalateAlways: ['Bash'], aiReview: { enabled: false } },
      }),
    });
  const scriptPath = path.join(peer.cwd, 'concurrency-probe.mjs');
  const script = `import {existsSync,writeFileSync} from 'node:fs';
let tick=0;
const timer=setInterval(()=>{writeFileSync('concurrent-tick.txt',String(++tick));if(existsSync('concurrency-release')){clearInterval(timer);clearTimeout(deadline);}},100);
const deadline=setTimeout(()=>process.exit(2),${options.turnTimeoutMs + 30000});
`;
  await writeFile(scriptPath, script);
  const testPath = path.join(peer.cwd, 'add.test.mjs');
  const testSource = `import {test} from 'node:test';import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';import {add} from './add.mjs';test('addition',()=>{assert.equal(add(2,3),5);assert.equal(add(-2,3),1);writeFileSync('test-result.json',JSON.stringify({passed:true,cwd:process.cwd()}));});`;
  await writeFile(testPath, testSource);
  execFileSync('git', ['init', '--quiet'], { cwd: peer.cwd });
  execFileSync('git', ['add', 'add.mjs', 'add.test.mjs'], { cwd: peer.cwd });
  await openCodingSession(peerPage, app, peer.project, peer.session);
  let releaseApproval!: (allow: boolean) => void;
  const approvalGate = new Promise<boolean>(resolve => {
    releaseApproval = resolve;
  });
  let peerCompletion: Promise<void> | undefined;
  let peerResult: any;
  let peerError: unknown;
  let observedApproval = false;
  const tickPath = path.join(peer.cwd, 'concurrent-tick.txt');
  const readTick = () =>
    readFile(tickPath, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
  const run = async () => {
    const cancellation = await runLiveCancellationProbe(
      page,
      app,
      primary.project,
      primary.session,
      primary.cwd,
      {
        ...options,
        promptPrefix: options.selfTest
          ? 'E2E_MCP'
          : `First call the e2e_session_probe MCP tool with marker exactly ${markerA}. Then`,
      },
      async () => {
        peerCompletion = runLiveUiTurn(
          peerPage,
          app,
          peer.session.id,
          options.selfTest
            ? 'E2E_CONCURRENT_FINISH E2E_MCP then fix addition'
            : `Run ${quote(process.execPath)} concurrency-probe.mjs as a foreground shell tool. The harness will release it by writing concurrency-release; do not write that file yourself or background the command. After it returns, fix add.mjs by replacing a - b with a + b, run ${quote(process.execPath)} --test add.test.mjs, then call e2e_session_probe MCP with marker exactly ${markerB}. Do not edit the script or test, read account configuration or environment variables, access the network, or work outside this project.`,
          options.turnTimeoutMs,
          async () => {
            const request = peerPage.getByRole('group', {
              name: 'Permission request',
              exact: true,
            });
            if (!observedApproval) {
              await expect(request).toContainText('concurrency-probe.mjs');
              observedApproval = true;
              if (!(await approvalGate))
                throw new Error('Concurrent probe cancelled during cleanup');
            }
            await request.getByRole('button', { name: 'Allow', exact: true }).click();
          }
        ).then(
          value => {
            peerResult = value;
          },
          error => {
            peerError = error;
          }
        );
        if (requiresApproval) {
          await expect.poll(() => observedApproval).toBe(true);
          expect(await readTick()).toBe('');
        } else {
          await expect.poll(readTick).not.toBe('');
          const before = await readTick();
          await expect.poll(readTick).not.toBe(before);
        }
        expect((await app.api(`/api/sessions/${primary.session.id}/run-state`)).isRunning).toBe(
          true
        );
        expect((await app.api(`/api/sessions/${peer.session.id}/run-state`)).isRunning).toBe(true);
      }
    );
    evidence.concurrency = {
      status: 'running',
      primaryRuntime: options.runtime,
      peerRuntime: options.peerRuntime,
      overlapped: true,
      cancellation,
      approvalIsolation: requiresApproval ? 'pending' : 'not-supported-by-peer',
    };
    if (requiresApproval) {
      await expect(peerPage.getByRole('button', { name: 'Allow', exact: true })).toBeVisible();
      expect(await readTick()).toBe('');
      expect((await app.api(`/api/sessions/${peer.session.id}/run-state`)).isRunning).toBe(true);
      evidence.concurrency.approvalIsolation = 'pending-survived-other-session-cancel';
    }
    releaseApproval(true);
    await expect.poll(readTick).not.toBe('');
    const previousTick = await readTick();
    await expect.poll(readTick).not.toBe(previousTick);
    expect((await app.api(`/api/sessions/${peer.session.id}/run-state`)).isRunning).toBe(true);
    const stoppedTick = await readFile(path.join(primary.cwd, 'cancel-tick.txt'), 'utf8');
    await pause(500);
    expect(await readFile(path.join(primary.cwd, 'cancel-tick.txt'), 'utf8')).toBe(stoppedTick);
    await writeFile(path.join(peer.cwd, 'concurrency-release'), 'release');
    await peerCompletion;
    if (peerError) throw peerError;
    expect(peerResult).toBeTruthy();
    expect(await readFile(testPath, 'utf8')).toBe(testSource);
    expect(await readFile(scriptPath, 'utf8')).toBe(script);
    expect(JSON.parse(await readFile(path.join(peer.cwd, 'test-result.json'), 'utf8'))).toEqual({
      passed: true,
      cwd: peer.cwd,
    });
    expect(await readFile(path.join(peer.cwd, 'add.mjs'), 'utf8')).toBe(
      'export const add = (a, b) => a + b;\n'
    );
    execFileSync(process.execPath, ['--test', 'add.test.mjs'], {
      cwd: peer.cwd,
      timeout: 10000,
      stdio: 'pipe',
    });
    const receipts = (await readFile(probe.receipt, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    for (const row of receipts) {
      const expectedMarker = row.sessionId === primary.session.id ? markerA : markerB;
      expect([primary.session.id, peer.session.id]).toContain(row.sessionId);
      expect(row).toEqual({ sessionId: row.sessionId, marker: expectedMarker, nonce: probe.nonce });
    }
    expect(new Set(receipts.map(row => row.sessionId)).size).toBe(2);
    const aSession = await app.api(`/api/sessions/${primary.session.id}`);
    const bSession = await app.api(`/api/sessions/${peer.session.id}`);
    expect(aSession.agentProfileId).toBe(primary.profile.id);
    expect(bSession.agentProfileId).toBe(peer.profile.id);
    expect(typeof aSession.sdkSessionId).toBe('string');
    expect(aSession.sdkSessionId).not.toBe(bSession.sdkSessionId);
    expect(JSON.stringify(await liveMessagesAfter(app, primary.session.id, 0))).not.toContain(
      markerB
    );
    expect(JSON.stringify(await liveMessagesAfter(app, peer.session.id, 0))).not.toContain(markerA);
    Object.assign(evidence.concurrency, {
      status: 'passed',
      peerCompleted: true,
      peerContinuedWriting: true,
      primarySessionId: primary.session.id,
      peerSessionId: peer.session.id,
      primarySdkSessionId: aSession.sdkSessionId,
      primaryTurn: liveMessageSummary(await liveMessagesAfter(app, primary.session.id, 0)),
      peerSdkSessionId: bSession.sdkSessionId,
      peerTurn: peerResult,
      sessionReceiptsVerified: 2,
      outputsIsolated: true,
      peerDiff: execFileSync('git', ['diff', '--', 'add.mjs'], { cwd: peer.cwd, encoding: 'utf8' }),
    });
  };
  try {
    await withLiveDeadline(app, evidence, 1, options.turnTimeoutMs, run);
  } finally {
    releaseApproval(false);
    if (!peerResult) await app.stop();
    await peerCompletion;
  }
}
