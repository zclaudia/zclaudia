import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const launcher = path.resolve(
  import.meta.dirname,
  '../../../e2e/fixtures/agent-runtimes/live-cli-launcher.mjs'
);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await pause(25);
  }
  throw new Error('Launcher did not reach its expected state');
}
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
};

test('CLI launcher preserves stdin/argv and excludes their contents from its audit', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'live-cli-'));
  try {
    const cli = path.join(directory, 'cli');
    await writeFile(cli, '#!/bin/sh\nprintf "%s\\n" "$@"\ncat\n');
    await chmod(cli, 0o755);
    const config = path.join(directory, 'config.json');
    await writeFile(config, JSON.stringify({ runtime: 'codex', cliPath: cli }));
    const audit = path.join(directory, 'audit.jsonl');
    const child = spawn(process.execPath, [launcher, config, 'synthetic-secret-argument'], {
      env: { E2E_RUNTIME_AUDIT: audit, PATH: '/usr/bin:/bin' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk;
    });
    child.stdin.end('synthetic-secret-input\n');
    assert.equal(await new Promise(resolve => child.once('exit', resolve)), 0);
    assert.equal(output, 'synthetic-secret-argument\nsynthetic-secret-input\n');
    const contents = await readFile(audit, 'utf8');
    assert.equal(contents.includes('synthetic-secret'), false);
    const rows = contents.trim().split('\n').map(JSON.parse);
    assert.ok(rows.some(row => row.processGroup > 0));
    assert.ok(rows.some(row => row.event === 'exited' && row.code === 0));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const interruption of ['signal', 'parent-exit'])
  test(`CLI launcher cleans its owned process group after ${interruption}`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'live-cli-group-'));
    let child;
    let group;
    let launcherPid;
    let exitTimeout;
    try {
      const vendor = path.join(directory, 'vendor.mjs');
      await writeFile(
        vendor,
        `import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs'; const child=spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},100)'], {stdio:'ignore'}); writeFileSync(${JSON.stringify(path.join(directory, 'grandchild'))}, String(child.pid)); process.on('SIGTERM',()=>{});setInterval(()=>{},100);`
      );
      const cli = path.join(directory, 'cli');
      const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
      await writeFile(cli, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(vendor)}\n`);
      await chmod(cli, 0o755);
      const config = path.join(directory, 'config.json');
      const audit = path.join(directory, 'audit.jsonl');
      await writeFile(config, JSON.stringify({ runtime: 'cursor', cliPath: cli }));
      const launchArgs = [launcher, config];
      const childArgs =
        interruption === 'signal'
          ? launchArgs
          : [
              '-e',
              `const { spawn } = require('node:child_process'); spawn(process.execPath, ${JSON.stringify(launchArgs)}, {env:process.env,stdio:'ignore'}); setInterval(()=>{},100);`,
            ];
      child = spawn(process.execPath, childArgs, {
        env: { E2E_RUNTIME_AUDIT: audit, PATH: '/usr/bin:/bin' },
        stdio: 'ignore',
      });
      let grandchild;
      await until(async () => {
        try {
          grandchild = Number(await readFile(path.join(directory, 'grandchild'), 'utf8'));
          return !!grandchild;
        } catch (error) {
          if (error.code === 'ENOENT') return false;
          throw error;
        }
      });
      const rows = (await readFile(audit, 'utf8')).trim().split('\n').map(JSON.parse);
      group = rows.find(row => row.processGroup)?.processGroup;
      launcherPid = rows.find(row => row.boundary === 'launcher')?.pid;
      assert.ok(group > 0 && alive(group) && alive(grandchild));
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill(interruption === 'signal' ? 'SIGTERM' : 'SIGKILL');
      await Promise.race([
        exited,
        new Promise((_, reject) => {
          exitTimeout = setTimeout(() => reject(new Error('Launcher shutdown timed out')), 5000);
        }),
      ]);
      await until(
        () => !alive(group) && !alive(grandchild) && !alive(-group) && !alive(launcherPid)
      );
    } finally {
      clearTimeout(exitTimeout);
      if (group)
        try {
          process.kill(-group, 'SIGKILL');
        } catch {
          // Already gone; this cleanup must not mask the test's own failure.
        }
      if (launcherPid)
        try {
          process.kill(launcherPid, 'SIGKILL');
        } catch {
          // Already gone; see above.
        }
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await rm(directory, { recursive: true, force: true });
    }
  });
