// Transparent CLI boundary recorder. Never records argv, stdout, stderr or tokens.
import { appendFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const settings = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const audit = row =>
  appendFileSync(
    process.env.E2E_RUNTIME_AUDIT,
    JSON.stringify({ runtime: settings.runtime, ...row }) + '\n'
  );
const parentPid = process.ppid;
audit({ pid: process.pid, boundary: 'launcher', event: 'started' });
const child = spawn(settings.cliPath, process.argv.slice(3), {
  env: {
    ...process.env,
    PATH: [path.dirname(process.execPath), process.env.PATH].filter(Boolean).join(path.delimiter),
  },
  stdio: 'inherit',
  detached: true,
});
let shuttingDown = false;
let escalation;
const signalGroup = signal => {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
};
const stop = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  signalGroup('SIGTERM');
  escalation = setTimeout(() => signalGroup('SIGKILL'), 1000);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
const parentWatch = setInterval(() => {
  if (process.ppid <= 1 || process.ppid !== parentPid) stop();
}, 250);
child.once('spawn', () =>
  audit({ pid: child.pid, processGroup: child.pid, boundary: 'cli', event: 'started' })
);
child.once('error', error => {
  clearInterval(parentWatch);
  clearTimeout(escalation);
  // Report only the OS code: error messages may include command arguments.
  console.error(`CLI launcher failed (${error.code ?? 'spawn error'})`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  clearInterval(parentWatch);
  clearTimeout(escalation);
  // Reap any subprocesses left behind by the CLI, including on successful exit.
  signalGroup('SIGKILL');
  audit({ pid: child.pid, boundary: 'cli', event: 'exited', code, signal });
  process.exitCode = code ?? 1;
});
