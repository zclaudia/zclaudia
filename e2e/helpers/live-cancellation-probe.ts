import { expect, type Page } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type AgentRuntimeHarness,
  openCodingSession,
  sendCodingMessage,
} from './agent-runtime-harness';

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// The caller owns the per-turn watchdog and stops the application on timeout.
// In live mode the CLI must launch this bounded foreground tool itself; the
// harness only observes its receipt and clicks the normal Cancel UI action.
export async function runLiveCancellationProbe(
  page: Page,
  app: AgentRuntimeHarness,
  project: any,
  session: any,
  cwd: string,
  options: { selfTest: boolean; turnTimeoutMs: number; promptPrefix?: string },
  beforeCancel?: () => Promise<void>
) {
  const scriptPath = path.join(cwd, 'cancel-probe.mjs');
  const tickPath = path.join(cwd, 'cancel-tick.txt');
  const receiptPath = path.join(cwd, 'cancel-worker.json');
  const nonce = randomUUID();
  const source = `import { writeFileSync } from 'node:fs';
writeFileSync('cancel-worker.json', JSON.stringify({pid:process.pid,cwd:process.cwd(),nonce:${JSON.stringify(nonce)}}));
let tick = 0;
setInterval(() => writeFileSync('cancel-tick.txt', String(++tick)), 100);
setTimeout(() => process.exit(0), ${options.turnTimeoutMs + 30_000});
`;
  await writeFile(scriptPath, source);
  await openCodingSession(page, app, project, session);
  const started = Date.now();
  await sendCodingMessage(
    page,
    options.selfTest
      ? `${options.promptPrefix ?? ''} E2E_WAIT_FOR_CANCEL`
      : `${options.promptPrefix ?? ''} Run ${quote(process.execPath)} cancel-probe.mjs as a foreground shell tool in this project. The command deliberately writes a counter and process receipt. Keep waiting for the command; I will cancel it through the UI. Do not background it, edit the script or other project files, read account configuration or environment variables, or access the network.`
  );
  let approvals = 0;
  let firstTick = '';
  const readTick = () =>
    readFile(tickPath, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
  while (Date.now() - started < options.turnTimeoutMs) {
    const allow = page.getByRole('button', { name: 'Allow', exact: true });
    if (await allow.count()) {
      if (++approvals > 12) throw new Error('Cancellation probe approval limit exceeded');
      await allow.first().click();
    }
    const tick = await readTick();
    if (tick && firstTick && tick !== firstTick) break;
    if (tick) firstTick = tick;
    await pause(100);
  }
  expect(firstTick).not.toBe('');
  expect(await readTick()).not.toBe(firstTick);
  expect((await app.api(`/api/sessions/${session.id}/run-state`)).isRunning).toBe(true);
  expect(await readFile(scriptPath, 'utf8')).toBe(source);
  let writerPid: number | null = null;
  if (!options.selfTest) {
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    expect(receipt).toMatchObject({ cwd, nonce });
    expect(Number.isSafeInteger(receipt.pid) && receipt.pid > 1).toBe(true);
    expect(receipt.pid).not.toBe(process.pid);
    writerPid = receipt.pid;
  }
  await beforeCancel?.();
  const cancelledAt = Date.now();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect
    .poll(async () => (await app.api(`/api/sessions/${session.id}/run-state`)).isRunning, {
      timeout: 10_000,
    })
    .toBe(false);
  if (writerPid) {
    await expect
      .poll(
        () => {
          try {
            process.kill(writerPid!, 0);
            return true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
            throw error;
          }
        },
        { timeout: Math.max(1, 10_000 - (Date.now() - cancelledAt)) }
      )
      .toBe(false);
  }
  const cancellationMs = Date.now() - cancelledAt;
  expect(cancellationMs).toBeLessThanOrEqual(10_000);
  const finalTick = await readTick();
  for (let sample = 0; sample < 12; sample++) {
    await pause(250);
    expect(await readTick()).toBe(finalTick);
  }
  expect(await readFile(scriptPath, 'utf8')).toBe(source);
  return {
    userTurn: 1,
    status: 'passed',
    approvals,
    durationMs: Date.now() - started,
    cancellationMs,
    postCancelObservationMs: 3000,
    writesStopped: true,
    writerBoundary: options.selfTest ? 'fixture-cli' : 'foreground-node-tool',
    writerPid,
    writerExited: options.selfTest ? null : true,
    scriptSha256: createHash('sha256').update(source).digest('hex'),
  };
}
