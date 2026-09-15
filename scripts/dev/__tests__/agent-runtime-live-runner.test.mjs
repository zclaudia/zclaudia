import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const runner = path.resolve(import.meta.dirname, '../test-builtin-runtime-live.mjs');
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
};
async function until(check) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await pause(25);
  }
  throw new Error('Runner did not reach its expected state');
}

test('interrupting the runner fails acceptance and kills an unresponsive owned process group', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'live-runner-interrupt-'));
  let child;
  let pids = [];
  let cleanupFailure;
  try {
    const ready = path.join(directory, 'ready.json');
    const fixture = path.join(directory, 'fake-pnpm.mjs');
    const grandchild = `process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 100);`;
    await writeFile(
      fixture,
      `
      import { spawn } from 'node:child_process';
      import { mkdirSync, writeFileSync } from 'node:fs';
      mkdirSync(${JSON.stringify(path.join(directory, 'report/test-results'))}, { recursive: true });
      writeFileSync(${JSON.stringify(path.join(directory, 'report/test-results/error-context.md'))}, 'synthetic private page text');
      process.on('SIGTERM', () => {});
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      child.on('message', () => writeFileSync(${JSON.stringify(ready)}, JSON.stringify([process.pid, child.pid])));
      setInterval(() => {}, 100);
    `
    );
    const executable = path.join(directory, 'pnpm');
    await writeFile(executable, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fixture)}\n`);
    await chmod(executable, 0o755);
    const report = path.join(directory, 'report');
    child = spawn(
      process.execPath,
      [runner, '--runtime', 'codex', '--self-test', '--output-dir', report],
      {
        env: { PATH: `${directory}:/usr/bin:/bin` },
        stdio: 'ignore',
      }
    );
    const exited = new Promise(resolve =>
      child.once('exit', (code, signal) => resolve({ code, signal }))
    );
    await until(async () => {
      try {
        pids = JSON.parse(await readFile(ready, 'utf8'));
        return pids.length === 2;
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    });
    assert.ok(pids.every(alive));
    child.kill('SIGTERM');
    await until(() => child.exitCode !== null || child.signalCode !== null);
    assert.deepEqual(await exited, { code: 1, signal: null });
    await until(() => pids.every(pid => !alive(pid)) && !alive(-pids[0]));
    const result = JSON.parse(await readFile(path.join(report, 'runner-result.json'), 'utf8'));
    assert.equal(result.status, 'interrupted');
    assert.equal(result.exitCode, 1);
    assert.equal(result.selfTest, true);
    await assert.rejects(readFile(path.join(report, 'test-results/error-context.md')), {
      code: 'ENOENT',
    });
    await assert.rejects(readFile(path.join(report, 'acceptance-evidence.json')), {
      code: 'ENOENT',
    });
  } finally {
    if (pids[0]) {
      try {
        process.kill(-pids[0], 'SIGKILL');
      } catch (error) {
        // Recorded, not thrown: a throw here would replace whatever the test
        // body actually failed with.
        if (error.code !== 'ESRCH') cleanupFailure = error;
      }
    }
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGKILL');
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
  // Reached only when the body passed; an unexpected kill failure still fails
  // the test.
  if (cleanupFailure) throw cleanupFailure;
});
