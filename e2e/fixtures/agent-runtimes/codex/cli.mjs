import { exerciseMcp, waitForConcurrentRelease } from './mcp.mjs';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('codex-cli 0.144.1');
  process.exit(0);
}
if (args[0] === 'login') {
  console.log('Logged in using fixture');
  process.exit(0);
}
const emit = event => console.log(JSON.stringify(event));
const audit = event =>
  appendFileSync(
    process.env.E2E_RUNTIME_AUDIT,
    JSON.stringify({ runtime: 'codex', pid: process.pid, ...event }) + '\n'
  );
const threadsFile = `${process.env.E2E_RUNTIME_AUDIT}.codex-threads`;
let threads = {};
try {
  threads = JSON.parse(readFileSync(threadsFile, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const active = new Map();
const permissions = new Map();
createInterface({ input: process.stdin }).on('line', async line => {
  const request = JSON.parse(line);
  const { id, method, params = {} } = request;
  if (!method && permissions.has(id)) {
    permissions.get(id)(request.result);
    permissions.delete(id);
    return;
  }
  const reply = result => emit({ id, result });
  if (method === 'initialize') {
    reply({ userAgent: 'zclaudia-e2e' });
    return;
  }
  if (method === 'thread/start') {
    const sessionId = randomUUID();
    threads[sessionId] = params.cwd;
    writeFileSync(threadsFile, JSON.stringify(threads));
    audit({ sessionId, cwd: params.cwd });
    reply({ thread: { id: sessionId } });
    return;
  }
  if (method === 'thread/resume') {
    if (!threads[params.threadId]) {
      emit({ id, error: { code: -32602, message: 'thread not found' } });
      return;
    }
    audit({ resume: params.threadId, sessionId: params.threadId, cwd: threads[params.threadId] });
    reply({ thread: { id: params.threadId } });
    return;
  }
  if (method === 'turn/interrupt') {
    clearInterval(active.get(params.threadId));
    active.delete(params.threadId);
    reply({});
    emit({
      method: 'turn/completed',
      params: { threadId: params.threadId, turn: { id: params.turnId, status: 'interrupted' } },
    });
    return;
  }
  if (method !== 'turn/start') {
    if (id !== undefined) reply({});
    return;
  }
  const threadId = params.threadId;
  const cwd = threads[threadId];
  const turnId = randomUUID();
  const notify = (method, body) => emit({ method, params: { threadId, turnId, ...body } });
  audit({ sessionId: threadId, model: params.model, cwd, turnId });
  reply({ turn: { id: turnId, status: 'inProgress' } });
  const prompt = params.input.map(block => block.text ?? '').join('\n');
  if (prompt.includes('E2E_CRASH') || prompt.includes('E2E_MALFORMED')) {
    appendFileSync(
      process.env.E2E_RUNTIME_AUDIT,
      JSON.stringify({
        runtime: 'codex',
        pid: process.pid,
        crash: prompt.includes('E2E_MALFORMED') ? 'malformed' : 'exit',
      }) + '\n'
    );
    if (prompt.includes('E2E_MALFORMED')) process.stdout.write('{malformed-protocol\n');
    process.exit(31);
  }
  if (prompt.includes('E2E_CONCURRENT_FINISH')) {
    await new Promise((resolve, reject) => {
      const requestId = randomUUID();
      permissions.set(requestId, decision => {
        if (decision?.decision === 'accept') resolve();
        else reject(new Error('Concurrent fixture command was denied'));
      });
      emit({
        id: requestId,
        method: 'item/commandExecution/requestApproval',
        params: {
          threadId,
          turnId,
          itemId: requestId,
          command: 'node concurrency-probe.mjs',
          cwd,
        },
      });
    });
    await waitForConcurrentRelease(cwd);
  }
  if (prompt.includes('E2E_PERMISSION')) {
    const requestId = randomUUID();
    permissions.set(requestId, decision => {
      const allowed = decision?.decision === 'accept';
      if (allowed) writeFileSync(path.join(cwd, 'approval-side-effect.txt'), 'approved');
      audit({ approval: allowed ? 'allow' : 'deny', sessionId: threadId });
      notify('item/agentMessage/delta', {
        delta: allowed ? 'E2E_PERMISSION_ALLOWED' : 'E2E_PERMISSION_DENIED',
      });
      notify('turn/completed', { turn: { id: turnId, status: 'completed' } });
    });
    emit({
      id: requestId,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId,
        turnId,
        itemId: requestId,
        command: 'echo approved > approval-side-effect.txt',
        cwd,
      },
    });
    return;
  }
  if (prompt.includes('E2E_WAIT_FOR_CANCEL')) {
    if (prompt.includes('E2E_MCP')) await exerciseMcp('codex', args, cwd);
    notify('item/agentMessage/delta', { delta: 'Fixture task is running' });
    active.set(
      threadId,
      setInterval(() => writeFileSync(path.join(cwd, 'cancel-tick.txt'), String(Date.now())), 100)
    );
    return;
  }
  if (prompt.includes('E2E_MCP')) await exerciseMcp('codex', args, cwd);
  const file = path.join(cwd, 'add.mjs');
  readFileSync(file, 'utf8');
  const edit = {
    id: `edit-${turnId}`,
    type: 'fileChange',
    changes: [{ path: file, kind: { type: 'update' }, diff: '-a - b\n+a + b' }],
  };
  notify('item/started', { item: edit });
  writeFileSync(file, 'export const add = (a, b) => a + b;\n');
  notify('item/completed', { item: { ...edit, status: 'completed' } });
  const command = {
    id: `test-${turnId}`,
    type: 'commandExecution',
    command: 'node --test add.test.mjs',
  };
  notify('item/started', { item: command });
  const check = spawnSync(process.execPath, ['--test', 'add.test.mjs'], { cwd, encoding: 'utf8' });
  notify('item/completed', {
    item: {
      ...command,
      status: check.status === 0 ? 'completed' : 'failed',
      aggregatedOutput: check.stdout,
      exitCode: check.status,
    },
  });
  audit({ sessionId: threadId, testExitCode: check.status });
  notify('item/agentMessage/delta', { delta: 'E2E_CODEX_CODING_COMPLETE' });
  notify('turn/completed', {
    turn: { id: turnId, status: check.status === 0 ? 'completed' : 'failed' },
  });
});
