import { exerciseMcp, waitForConcurrentRelease } from './mcp.mjs';
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createInterface } from 'node:readline';

// The current Cursor adapter defaults to ACP. Keep the vendor boundary a
// deterministic fixture while exercising real host session/MCP plumbing.
async function runAcpFixture() {
  const auditPath = process.env.E2E_RUNTIME_AUDIT;
  const storePath = `${auditPath}.cursor-sessions.json`;
  const sessions = new Map(
    existsSync(storePath) ? Object.entries(JSON.parse(readFileSync(storePath, 'utf8'))) : []
  );
  const pendingPermissions = new Map();
  const running = new Map();
  const audit = record =>
    appendFileSync(
      auditPath,
      JSON.stringify({ runtime: 'cursor', pid: process.pid, ...record }) + '\n'
    );
  const send = message =>
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const persist = () => writeFileSync(storePath, JSON.stringify(Object.fromEntries(sessions)));
  const state = session => ({
    models: {
      currentModelId: session.model ?? 'fixture-model',
      availableModels: [{ modelId: 'fixture-model', name: 'Fixture Model' }],
    },
    modes: {
      currentModeId: session.mode ?? 'agent',
      availableModes: ['agent', 'plan', 'ask'].map(mode => ({ id: mode, name: mode })),
    },
  });
  const text = (sessionId, value) =>
    send({
      method: 'session/update',
      params: {
        sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: value } },
      },
    });
  const lines = createInterface({ input: process.stdin });
  // Prompt handling must not block the reader: ACP cancellation is a
  // notification, and permission decisions are replies on the same stream.
  await new Promise(resolve => {
    lines.on('close', () => {
      for (const turn of running.values()) clearInterval(turn.timer);
      resolve();
    });
    lines.on('line', line => {
      if (!line.trim()) return;
      void dispatch(JSON.parse(line)).catch(error => {
        console.error(error.message);
        process.exitCode = 1;
        lines.close();
      });
    });
  });

  async function dispatch({ id, method, params = {}, result }) {
    if (method === undefined) {
      pendingPermissions.get(id)?.(result);
      pendingPermissions.delete(id);
      return;
    }
    try {
      if (method === 'initialize') {
        send({
          id,
          result: {
            protocolVersion: 1,
            agentCapabilities: { loadSession: true },
            authMethods: [{ id: 'cursor_login', name: 'Cursor Login' }],
          },
        });
      } else if (method === 'authenticate') {
        if (existsSync(`${auditPath}.auth-required`)) {
          audit({ authenticationFailure: true });
          send({
            id,
            error: {
              code: -32000,
              message: 'Cursor CLI authentication required. Run the CLI login command.',
            },
          });
        } else send({ id, result: {} });
      } else if (method === 'session/new' || method === 'session/load') {
        const sessionId = method === 'session/load' ? params.sessionId : randomUUID();
        if (method === 'session/load' && !sessions.has(sessionId)) {
          send({ id, error: { code: -32602, message: `Session "${sessionId}" not found` } });
          return;
        }
        const session = { ...sessions.get(sessionId), ...params };
        sessions.set(sessionId, session);
        persist();
        send({
          id,
          result: { ...(method === 'session/new' ? { sessionId } : {}), ...state(session) },
        });
        session.resume = method === 'session/load' ? sessionId : undefined;
      } else if (method === 'session/set_mode' || method === 'session/set_model') {
        const session = sessions.get(params.sessionId);
        if (!session) throw new Error('Unknown fixture session');
        if (method === 'session/set_mode') session.mode = params.modeId;
        else session.model = params.modelId;
        persist();
        send({ id, result: {} });
      } else if (method === 'session/cancel') {
        const turn = running.get(params.sessionId);
        if (turn) {
          clearInterval(turn.timer);
          running.delete(params.sessionId);
          send({ id: turn.id, result: { stopReason: 'cancelled' } });
        }
      } else if (method === 'session/prompt') {
        const session = sessions.get(params.sessionId);
        if (!session) throw new Error('Unknown fixture session');
        const sessionId = params.sessionId;
        const prompt = params.prompt
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n');
        audit({
          sessionId,
          cwd: session.cwd,
          resume: session.resume,
          mode: session.mode ?? 'agent',
          model: session.model,
        });
        if (prompt.includes('E2E_CRASH') || prompt.includes('E2E_MALFORMED')) {
          audit({ sessionId, crash: prompt.includes('E2E_MALFORMED') ? 'malformed' : 'exit' });
          if (prompt.includes('E2E_MALFORMED')) process.stdout.write('{malformed-protocol\n');
          process.exit(31);
        }
        const server = session.mcpServers?.find(server => server.name === 'claudia-plugins');
        const config = server && {
          ...server,
          env: Object.fromEntries(server.env.map(({ name, value }) => [name, value])),
        };
        if (prompt.includes('E2E_MCP'))
          await exerciseMcp('cursor', [], session.cwd, prompt, config);
        if (prompt.includes('E2E_WAIT_FOR_CANCEL')) {
          text(sessionId, 'Fixture task is running');
          const timer = setInterval(
            () => writeFileSync(path.join(session.cwd, 'cancel-tick.txt'), String(Date.now())),
            100
          );
          running.set(sessionId, { id, timer });
          return;
        }
        if (session.mode === 'plan' || session.mode === 'ask') {
          readFileSync(path.join(session.cwd, 'add.mjs'), 'utf8');
          text(sessionId, `E2E_CURSOR_${session.mode.toUpperCase()}_COMPLETE`);
          send({ id, result: { stopReason: 'end_turn' } });
          return;
        }
        if (prompt.includes('E2E_PERMISSION') || prompt.includes('E2E_CONCURRENT_FINISH')) {
          const permissionId = `permission-${randomUUID()}`;
          const permission = new Promise(resolve => pendingPermissions.set(permissionId, resolve));
          const command = prompt.includes('E2E_CONCURRENT_FINISH')
            ? 'node concurrency-probe.mjs'
            : 'printf approved > approval-side-effect.txt';
          send({
            id: permissionId,
            method: 'session/request_permission',
            params: {
              sessionId,
              toolCall: {
                toolCallId: permissionId,
                title: 'Bash',
                kind: 'execute',
                status: 'pending',
                rawInput: { command },
                content: [{ type: 'content', content: { type: 'text', text: command } }],
              },
              options: [
                { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
                { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
              ],
            },
          });
          const response = await permission;
          audit({ sessionId, permissionOutcome: response.outcome });
          if (/^E2E_PERMISSION(?: check-\d+)?$/.test(prompt)) {
            const allowed = response.outcome.optionId === 'allow-once';
            audit({ sessionId, approval: allowed ? 'allow' : 'deny' });
            if (allowed)
              writeFileSync(path.join(session.cwd, 'approval-side-effect.txt'), 'approved');
            text(sessionId, allowed ? 'E2E_PERMISSION_ALLOWED' : 'E2E_PERMISSION_DENIED');
            send({ id, result: { stopReason: 'end_turn' } });
            return;
          }
          if (response.outcome.optionId !== 'allow-once') {
            send({ id, result: { stopReason: 'cancelled' } });
            return;
          }
        }
        if (prompt.includes('E2E_CONCURRENT_FINISH')) await waitForConcurrentRelease(session.cwd);
        const writeId = `write-${randomUUID()}`;
        const tool = (toolCallId, title, kind, status, rawInput) =>
          send({
            method: 'session/update',
            params: {
              sessionId,
              update: {
                sessionUpdate: status === 'in_progress' ? 'tool_call' : 'tool_call_update',
                toolCallId,
                title,
                kind,
                status,
                rawInput,
              },
            },
          });
        tool(writeId, 'Write', 'edit', 'in_progress', { file_path: 'add.mjs' });
        writeFileSync(path.join(session.cwd, 'add.mjs'), 'export const add = (a, b) => a + b;\n');
        tool(writeId, 'Write', 'edit', 'completed', { file_path: 'add.mjs' });
        const testId = `test-${randomUUID()}`;
        tool(testId, 'Bash', 'execute', 'in_progress', { command: 'node --test add.test.mjs' });
        const check = spawnSync(process.execPath, ['--test', 'add.test.mjs'], {
          cwd: session.cwd,
          encoding: 'utf8',
        });
        tool(testId, 'Bash', 'execute', check.status === 0 ? 'completed' : 'failed', {
          command: 'node --test add.test.mjs',
        });
        audit({ sessionId, testExitCode: check.status });
        if (check.status !== 0) throw new Error('Fixture coding check failed');
        text(sessionId, 'E2E_CURSOR_CODING_COMPLETE');
        send({ id, result: { stopReason: 'end_turn' } });
      } else if (id !== undefined) send({ id, result: {} });
    } catch (error) {
      if (id !== undefined) send({ id, error: { code: -32603, message: error.message } });
      else throw error;
    }
  }
}

const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('2026.9.10');
  process.exit(0);
}
if (args.includes('--help')) {
  console.log('fixture: stream-json');
  process.exit(0);
}
if (args.includes('--list-models')) {
  console.log('fixture-model - Fixture Model (default)');
  process.exit(0);
}
if (args[0] === 'acp') {
  await runAcpFixture();
  process.exit(0);
}
if (args[0] === 'mcp') process.exit(0);
const authMarker = `${process.env.E2E_RUNTIME_AUDIT}.auth-required`;
if (args[0] === 'login') {
  rmSync(authMarker, { force: true });
  process.exit(0);
}
if (existsSync(authMarker)) {
  appendFileSync(
    process.env.E2E_RUNTIME_AUDIT,
    JSON.stringify({ runtime: 'cursor', pid: process.pid, authenticationFailure: true }) + '\n'
  );
  console.error('Cursor CLI authentication required. Run the CLI login command.');
  process.exit(1);
}
const value = flag => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const prompt = value('-p') ?? '';
const sessionId = value('--resume') ?? randomUUID();
appendFileSync(
  process.env.E2E_RUNTIME_AUDIT,
  JSON.stringify({
    runtime: 'cursor',
    pid: process.pid,
    sessionId,
    resume: value('--resume'),
    model: value('--model'),
    mode: args.includes('--mode=plan') ? 'plan' : args.includes('--mode=ask') ? 'ask' : 'default',
    yolo: args.includes('--yolo'),
    autoReview: args.includes('--auto-review'),
    cwd: process.cwd(),
  }) + '\n'
);
const emit = event => console.log(JSON.stringify(event));
emit({
  type: 'system',
  subtype: 'init',
  session_id: sessionId,
  cwd: process.cwd(),
  model: 'fixture-model',
});
if (prompt.includes('E2E_CRASH') || prompt.includes('E2E_MALFORMED')) {
  appendFileSync(
    process.env.E2E_RUNTIME_AUDIT,
    JSON.stringify({
      runtime: 'cursor',
      pid: process.pid,
      crash: prompt.includes('E2E_MALFORMED') ? 'malformed' : 'exit',
    }) + '\n'
  );
  if (prompt.includes('E2E_MALFORMED')) process.stdout.write('{malformed-protocol\n');
  process.exit(31);
}
if (prompt.includes('E2E_WAIT_FOR_CANCEL')) {
  if (prompt.includes('E2E_MCP')) await exerciseMcp('cursor', args, process.cwd(), prompt);
  emit({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'Fixture task is running' }] },
  });
  setInterval(() => writeFileSync('cancel-tick.txt', String(Date.now())), 100);
} else if (prompt.includes('E2E_MODE')) {
  const mode = args.includes('--mode=plan')
    ? 'plan'
    : args.includes('--mode=ask')
      ? 'ask'
      : 'default';
  readFileSync('add.mjs', 'utf8');
  emit({
    type: 'assistant',
    message: { content: [{ type: 'text', text: `E2E_CURSOR_${mode.toUpperCase()}_COMPLETE` }] },
  });
  emit({ type: 'result', subtype: 'success', result: 'Read-only mode complete' });
} else {
  if (prompt.includes('E2E_CONCURRENT_FINISH')) await waitForConcurrentRelease(process.cwd());
  if (prompt.includes('E2E_MCP')) await exerciseMcp('cursor', args, process.cwd(), prompt);
  readFileSync('add.mjs', 'utf8');
  const file = path.join(process.cwd(), 'add.mjs');
  emit({
    type: 'tool_call',
    subtype: 'started',
    call_id: 'edit-1',
    tool_call: { editToolCall: { args: { path: file } } },
  });
  writeFileSync(file, 'export const add = (a, b) => a + b;\n');
  emit({
    type: 'tool_call',
    subtype: 'completed',
    call_id: 'edit-1',
    tool_call: {
      editToolCall: { args: { path: file }, result: { success: { message: 'File updated' } } },
    },
  });
  emit({
    type: 'tool_call',
    subtype: 'started',
    call_id: 'test-1',
    tool_call: { shellToolCall: { args: { command: 'node --test add.test.mjs' } } },
  });
  const check = spawnSync(process.execPath, ['--test', 'add.test.mjs'], { encoding: 'utf8' });
  emit({
    type: 'tool_call',
    subtype: 'completed',
    call_id: 'test-1',
    tool_call: {
      shellToolCall: {
        args: { command: 'node --test add.test.mjs' },
        result: { success: { stdout: check.stdout } },
      },
    },
  });
  appendFileSync(
    process.env.E2E_RUNTIME_AUDIT,
    JSON.stringify({ runtime: 'cursor', testExitCode: check.status }) + '\n'
  );
  emit({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'E2E_CURSOR_CODING_COMPLETE' }] },
  });
  emit({
    type: 'result',
    subtype: check.status === 0 ? 'success' : 'error',
    result: check.status === 0 ? 'Complete' : check.stderr,
  });
}
