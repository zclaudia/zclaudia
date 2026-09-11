import { exerciseMcp, waitForConcurrentRelease } from './mcp.mjs';
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('2026.9.10');
  process.exit(0);
}
if (args.includes('--help')) {
  console.log('fixture: stream-json');
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
  if (prompt.includes('E2E_MCP')) await exerciseMcp('cursor', args, process.cwd());
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
  if (prompt.includes('E2E_MCP')) await exerciseMcp('cursor', args, process.cwd());
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
