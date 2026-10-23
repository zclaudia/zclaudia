import { exerciseMcp, waitForConcurrentRelease } from './mcp.mjs';
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('2.1.181 (Claude Code)');
  process.exit(0);
}
if (args.includes('--help')) {
  console.log('fixture: stream-json');
  process.exit(0);
}
if (args[0] === 'auth') {
  console.log('{"loggedIn":true}');
  process.exit(0);
}
const value = flag => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const sessionId = value('--resume') ?? randomUUID();
const emit = event => console.log(JSON.stringify(event));
const audit = event =>
  appendFileSync(
    process.env.E2E_RUNTIME_AUDIT,
    JSON.stringify({ runtime: 'claude', pid: process.pid, sessionId, ...event }) + '\n'
  );
let timer;
const permissions = new Map();
createInterface({ input: process.stdin }).on('line', async line => {
  const request = JSON.parse(line);
  if (request.type === 'control_response') {
    const id = request.response.request_id;
    permissions.get(id)?.(request.response.response);
    permissions.delete(id);
    return;
  }
  if (request.type === 'control_request') {
    emit({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: request.request_id,
        response: { commands: [], models: [], account: {} },
      },
    });
    if (request.request.subtype === 'interrupt') clearInterval(timer);
    return;
  }
  if (request.type !== 'user') return;
  const prompt =
    typeof request.message.content === 'string'
      ? request.message.content
      : JSON.stringify(request.message.content);
  audit({ resume: value('--resume'), model: value('--model'), cwd: process.cwd() });
  emit({
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    cwd: process.cwd(),
    model: 'fixture-model',
    tools: ['Edit', 'Bash'],
    uuid: randomUUID(),
  });
  const assistant = content =>
    emit({
      type: 'assistant',
      session_id: sessionId,
      uuid: randomUUID(),
      parent_tool_use_id: null,
      message: {
        id: randomUUID(),
        type: 'message',
        role: 'assistant',
        model: 'fixture-model',
        content,
        stop_reason: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
  const result = (id, content) =>
    emit({
      type: 'user',
      session_id: sessionId,
      uuid: randomUUID(),
      parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] },
    });
  if (prompt.includes('E2E_WAIT_FOR_CANCEL')) {
    if (prompt.includes('E2E_MCP')) await exerciseMcp('claude', args, process.cwd(), prompt);
    assistant([{ type: 'text', text: 'Fixture task is running' }]);
    timer = setInterval(() => writeFileSync('cancel-tick.txt', String(Date.now())), 100);
    return;
  }
  if (prompt.includes('E2E_RESUME_FINISH')) {
    assistant([{ type: 'text', text: 'E2E_RESUME_PARTIAL' }]);
    await waitForConcurrentRelease(process.cwd());
  }
  if (prompt.includes('E2E_CRASH') || prompt.includes('E2E_MALFORMED')) {
    appendFileSync(
      process.env.E2E_RUNTIME_AUDIT,
      JSON.stringify({
        runtime: 'claude',
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
        if (decision?.behavior === 'allow') resolve();
        else reject(new Error('Concurrent fixture command was denied'));
      });
      emit({
        type: 'control_request',
        request_id: requestId,
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Bash',
          tool_use_id: requestId,
          input: { command: 'node concurrency-probe.mjs' },
          permission_suggestions: [],
        },
      });
    });
    await waitForConcurrentRelease(process.cwd());
  }
  if (prompt.includes('E2E_PERMISSION')) {
    const requestId = randomUUID();
    permissions.set(requestId, decision => {
      const allowed = decision?.behavior === 'allow';
      if (allowed) writeFileSync('approval-side-effect.txt', 'approved');
      audit({ approval: allowed ? 'allow' : 'deny' });
      assistant([
        { type: 'text', text: allowed ? 'E2E_PERMISSION_ALLOWED' : 'E2E_PERMISSION_DENIED' },
      ]);
      emit({
        type: 'result',
        subtype: 'success',
        session_id: sessionId,
        uuid: randomUUID(),
        is_error: false,
        result: 'Permission handled',
        duration_ms: 1,
        duration_api_ms: 0,
        num_turns: 1,
        total_cost_usd: 0,
        usage: {},
        modelUsage: {},
        permission_denials: [],
      });
    });
    emit({
      type: 'control_request',
      request_id: requestId,
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        tool_use_id: requestId,
        input: { command: 'echo approved > approval-side-effect.txt' },
        permission_suggestions: [],
      },
    });
    return;
  }
  if (prompt.includes('E2E_MCP')) await exerciseMcp('claude', args, process.cwd(), prompt);
  // Deterministic design-workbench acceptance flow, through the real runtime
  // adapter and conversation transport. No provider credentials are needed.
  if (prompt.includes('E2E_DESIGN_GENERATE') || prompt.includes('E2E_DESIGN_REFINE')) {
    mkdirSync('design', { recursive: true });
    const target = path.join(process.cwd(), 'design/index.html');
    const source = prompt.includes('E2E_DESIGN_REFINE')
      ? readFileSync(target, 'utf8').replace('Original subtitle', 'Agent refined subtitle')
      : '<!doctype html><html><head><meta charset="utf-8"><title>Design fixture</title><link rel="stylesheet" href="style.css"></head><body><main><h1>Generated heading</h1><p>Original subtitle</p><img src="hero.svg" alt="Local artwork"></main></body></html>';
    assistant([
      {
        type: 'tool_use',
        id: 'design-write',
        name: 'Write',
        input: { file_path: target, content: source },
      },
    ]);
    writeFileSync(target, source);
    writeFileSync(
      'design/style.css',
      'body{font-family:sans-serif;background:#f6f4ef}main{padding:40px}h1{color:#222222}img{width:80px;height:80px}'
    );
    writeFileSync(
      'design/hero.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#668877"/></svg>'
    );
    result('design-write', 'HTML and local assets saved');
    audit({
      design: prompt.includes('E2E_DESIGN_REFINE') ? 'refine' : 'generate',
      cwd: process.cwd(),
    });
    assistant([
      {
        type: 'text',
        text: prompt.includes('E2E_DESIGN_REFINE') ? 'E2E_DESIGN_REFINED' : 'E2E_DESIGN_GENERATED',
      },
    ]);
    emit({
      type: 'result',
      subtype: 'success',
      session_id: sessionId,
      uuid: randomUUID(),
      is_error: false,
      result: 'Design saved',
      duration_ms: 1,
      duration_api_ms: 0,
      num_turns: 1,
      total_cost_usd: 0,
      usage: { input_tokens: 1, output_tokens: 1 },
      modelUsage: {},
      permission_denials: [],
    });
    return;
  }
  const file = path.join(process.cwd(), 'add.mjs');
  readFileSync(file, 'utf8');
  assistant([
    {
      type: 'tool_use',
      id: 'edit-1',
      name: 'Edit',
      input: { file_path: file, old_string: 'a - b', new_string: 'a + b' },
    },
  ]);
  writeFileSync(file, 'export const add = (a, b) => a + b;\n');
  result('edit-1', 'File updated');
  assistant([
    {
      type: 'tool_use',
      id: 'test-1',
      name: 'Bash',
      input: { command: 'node --test add.test.mjs' },
    },
  ]);
  const check = spawnSync(process.execPath, ['--test', 'add.test.mjs'], { encoding: 'utf8' });
  result('test-1', check.stdout);
  audit({ testExitCode: check.status });
  assistant([{ type: 'text', text: 'E2E_CLAUDE_CODING_COMPLETE' }]);
  emit({
    type: 'result',
    subtype: check.status === 0 ? 'success' : 'error_during_execution',
    session_id: sessionId,
    uuid: randomUUID(),
    is_error: check.status !== 0,
    result: 'Complete',
    duration_ms: 1,
    duration_api_ms: 0,
    num_turns: 1,
    total_cost_usd: 0,
    usage: { input_tokens: 1, output_tokens: 1 },
    modelUsage: {},
    permission_denials: [],
  });
});
