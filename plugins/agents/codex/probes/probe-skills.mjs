// URIP §14.2 precondition probe: does the pinned Codex App Server expose
// skills/list, skills/changed, and structured skill input?
// Read-only probe: initialize → skills/list → (report). No turn is started.
import { spawn } from 'node:child_process';

const BIN = process.env.CODEX_BIN ?? 'codex';
const child = spawn(BIN, ['app-server', '--listen', 'stdio://'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buffer = '';
const pending = new Map();
let nextId = 1;

child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    } else if (msg.method) {
      console.log('[notify]', msg.method);
    }
  }
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', c => process.stderr.write(`[codex-stderr] ${c}`));

function request(method, params, timeoutMs = 10_000) {
  const id = nextId++;
  const payload = JSON.stringify({ id, method, params: params ?? {} }) + '\n';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method}: timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, {
      resolve: msg => {
        clearTimeout(timer);
        resolve(msg);
      },
    });
    child.stdin.write(payload);
  });
}

const results = {};
try {
  const init = await request('initialize', {
    clientInfo: { name: 'zclaudia-urip-probe', version: '1' },
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  results.initialize = init.error
    ? { error: init.error }
    : { userAgent: init.result?.userAgent, codexHome: init.result?.codexHome };

  // §14.2 probe targets:
  for (const method of ['skills/list', 'skill/list', 'skills/listCompanies']) {
    try {
      const reply = await request(method, { cwd: process.cwd() });
      results[method] = reply.error
        ? { supported: false, error: { code: reply.error.code, message: reply.error.message } }
        : { supported: true, result: reply.result };
    } catch (error) {
      results[method] = { supported: 'timeout', error: String(error.message) };
    }
  }

  // Also check the config protocol version hints if exposed.
  try {
    const cfg = await request('config/read', { cwd: process.cwd() });
    results['config/read'] = cfg.error ? { error: cfg.error } : { ok: true };
  } catch (error) {
    results['config/read'] = { error: String(error.message) };
  }
} finally {
  child.kill('SIGTERM');
}

console.log(JSON.stringify(results, null, 2));
