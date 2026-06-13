#!/usr/bin/env node

/**
 * Session-run diagnostic.
 *
 * Bypasses the desktop UI and drives a session via direct backend API +
 * WebSocket so we can see exactly which events fire (or don't) when an
 * agent session "has no response".
 *
 * Usage:
 *   # Reuse the broken session (recommended for triage):
 *   node scripts/diagnostics/test-session-run.js --session-id <SESSION_ID> --input "hi"
 *
 *   # List existing sessions and pick one:
 *   node scripts/diagnostics/test-session-run.js --list-sessions
 *
 *   # Spin up a fresh project + agent session and run a prompt against it:
 *   node scripts/diagnostics/test-session-run.js --create --agent-profile-id <AP_ID> --input "hi"
 *
 *   # Just list agent profiles to grab an id:
 *   node scripts/diagnostics/test-session-run.js --list-agents
 *
 * Common options:
 *   --port 3100              server port (default 3100)
 *   --timeout 60000          ms to wait before giving up
 *   --input "..."            prompt to send (default: "Say hi in one sentence.")
 *   --permission-mode acceptEdits | bypassPermissions | default
 *
 * The script streams every WS event with a timestamp, color-codes the
 * obvious failure modes, and prints a summary at the end.
 */

import { randomUUID } from 'node:crypto';

// ─── Args ──────────────────────────────────────────────────
const argv = process.argv.slice(2);
function flag(name) {
  return argv.includes(name);
}
function arg(name) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
}

const PORT = arg('--port') || '3100';
const TIMEOUT_MS = parseInt(arg('--timeout') || '60000', 10);
const INPUT = arg('--input') || 'Say hi in one sentence.';
const PERMISSION_MODE = arg('--permission-mode') || 'bypassPermissions';
const SESSION_ID = arg('--session-id');
const AGENT_PROFILE_ID = arg('--agent-profile-id');
const PROJECT_ID_ARG = arg('--project-id');
const ROOT_PATH = arg('--root-path') || process.cwd();
const BASE_URL = `http://localhost:${PORT}`;
const WS_URL = `ws://localhost:${PORT}/ws`;

// ─── Colors ────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};
function color(name, s) {
  return `${c[name]}${s}${c.reset}`;
}

// ─── HTTP helpers ──────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text };
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${path}: ${text.slice(0, 200)}`);
  }
  return json;
}

// ─── List helpers ──────────────────────────────────────────
async function listSessions() {
  const r = await api('GET', '/api/sessions');
  return r.data || r.sessions || r;
}
async function listAgentProfiles() {
  const r = await api('GET', '/api/agent-profiles');
  return r.data || r;
}
async function listProjects() {
  const r = await api('GET', '/api/projects');
  return r.data || r;
}
async function getSession(id) {
  const r = await api('GET', `/api/sessions/${id}`);
  return r.data || r;
}

// ─── Setup paths ───────────────────────────────────────────
async function createProject(name) {
  const r = await api('POST', '/api/projects', {
    name,
    rootPath: ROOT_PATH,
    type: 'code',
  });
  if (!r.success || !r.data?.id) {
    throw new Error(`Project create failed: ${JSON.stringify(r)}`);
  }
  return r.data.id;
}

async function createSession({ projectId, agentProfileId }) {
  const r = await api('POST', '/api/sessions', {
    projectId,
    name: `diag-${Date.now()}`,
    type: 'agent',
    agentProfileId,
  });
  if (!r.success || !r.data?.id) {
    throw new Error(`Session create failed: ${JSON.stringify(r)}`);
  }
  return r.data.id;
}

// ─── WebSocket client ──────────────────────────────────────
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const onErr = (e) => reject(new Error(`WS error: ${e?.message ?? e}`));
    ws.addEventListener('open', () => {
      ws.removeEventListener('error', onErr);
      resolve(ws);
    });
    ws.addEventListener('error', onErr);
    setTimeout(() => reject(new Error('WS connect timeout (5s)')), 5000);
  });
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg));
}

function authenticate(ws) {
  return new Promise((resolve, reject) => {
    const handler = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'auth_result') {
          ws.removeEventListener('message', handler);
          if (msg.success) resolve(msg);
          else reject(new Error(`auth_result success=false: ${JSON.stringify(msg)}`));
        }
      } catch { /* non-JSON or unrelated frame — keep listening */ }
    };
    ws.addEventListener('message', handler);
    send(ws, { type: 'auth' });
    setTimeout(() => reject(new Error('auth timeout (5s)')), 5000);
  });
}

// ─── Pretty event logging ──────────────────────────────────
const startMs = Date.now();
function ts() {
  const dt = (Date.now() - startMs).toString().padStart(5, ' ');
  return color('dim', `+${dt}ms`);
}

function logEvent(msg) {
  const t = msg.type ?? 'unknown';
  const prefix = `${ts()} ${color('cyan', t.padEnd(28))}`;
  switch (t) {
    case 'auth_result':
      console.log(`${prefix} success=${msg.success}`);
      break;
    case 'run_started':
      console.log(`${prefix} runId=${msg.runId} sessionId=${msg.sessionId}`);
      break;
    case 'delta':
      console.log(`${prefix} ${color('green', JSON.stringify(msg.content?.slice?.(0, 80) ?? ''))}`);
      break;
    case 'thinking_delta':
      console.log(`${prefix} ${color('magenta', '<think> ' + (msg.content ?? '').slice(0, 80))}`);
      break;
    case 'tool_use':
      console.log(`${prefix} ${color('blue', msg.toolName ?? '')}  input=${JSON.stringify(msg.input).slice(0, 100)}`);
      break;
    case 'tool_result':
      console.log(`${prefix} ${color('blue', msg.toolName ?? '')}  ${(msg.output ?? '').toString().slice(0, 100)}`);
      break;
    case 'permission_request':
      console.log(`${prefix} ${color('yellow', '⚠ permission')} toolName=${msg.toolName} requestId=${msg.requestId}`);
      break;
    case 'run_completed':
      console.log(`${prefix} ${color('green', '✓ completed')} runId=${msg.runId} usage=${JSON.stringify(msg.usage ?? null).slice(0, 120)}`);
      break;
    case 'run_failed':
      console.log(`${prefix} ${color('red', '✗ failed')} runId=${msg.runId} error=${JSON.stringify(msg.error)}`);
      break;
    case 'system_info':
      console.log(`${prefix} ${color('dim', JSON.stringify(msg).slice(0, 160))}`);
      break;
    default:
      console.log(`${prefix} ${color('dim', JSON.stringify(msg).slice(0, 200))}`);
  }
}

// ─── Main ──────────────────────────────────────────────────
async function main() {
  console.log(color('bold', '== ZClaudia session-run diagnostic =='));
  console.log(`server: ${BASE_URL}`);
  console.log(`ws:     ${WS_URL}`);

  if (flag('--list-agents')) {
    const aps = await listAgentProfiles();
    console.log(JSON.stringify(aps, null, 2));
    return;
  }
  if (flag('--list-sessions')) {
    const ss = await listSessions();
    for (const s of ss) {
      console.log(
        `${s.id}  type=${s.type}  project=${s.project_id || s.projectId}  agentProfile=${s.agent_profile_id || s.agentProfileId}  name="${s.name ?? ''}"`,
      );
    }
    return;
  }
  if (flag('--list-projects')) {
    console.log(JSON.stringify(await listProjects(), null, 2));
    return;
  }

  // Resolve session
  let sessionId = SESSION_ID;
  let sessionMeta = null;
  if (!sessionId) {
    if (!flag('--create')) {
      console.error(
        color('red', 'no --session-id and no --create. Use --list-sessions to find one, or pass --create with --agent-profile-id.'),
      );
      process.exit(2);
    }
    if (!AGENT_PROFILE_ID) {
      console.error(color('red', '--create requires --agent-profile-id (use --list-agents).'));
      process.exit(2);
    }
    const projectId = PROJECT_ID_ARG ?? (await createProject(`diag-${Date.now()}`));
    console.log(`created project ${projectId}`);
    sessionId = await createSession({ projectId, agentProfileId: AGENT_PROFILE_ID });
    console.log(`created session ${sessionId}`);
  } else {
    try {
      sessionMeta = await getSession(sessionId);
      console.log(
        `reusing session ${sessionId}  type=${sessionMeta.type}  agentProfileId=${sessionMeta.agent_profile_id ?? sessionMeta.agentProfileId}  projectId=${sessionMeta.project_id ?? sessionMeta.projectId}`,
      );
    } catch (err) {
      console.error(color('red', `Failed to GET /api/sessions/${sessionId}: ${err.message}`));
      process.exit(3);
    }
  }

  // Connect + auth
  console.log(color('dim', `connecting ws...`));
  const ws = await connect();
  await authenticate(ws);
  console.log(color('green', 'auth ok'));

  // Run loop
  const clientRequestId = randomUUID();
  console.log(color('bold', `\n→ run_start  sessionId=${sessionId}  clientRequestId=${clientRequestId}`));
  console.log(`  permissionMode=${PERMISSION_MODE}`);
  console.log(`  input=${JSON.stringify(INPUT)}`);
  console.log('');

  let runId = null;
  let receivedRunStarted = false;
  let receivedFirstDelta = false;
  let receivedCompleted = false;
  let receivedFailed = false;
  let permissionAutoAllows = 0;
  let deltaCount = 0;
  let toolUseCount = 0;

  const handler = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      console.log(`${ts()} ${color('red', 'non-JSON frame')}: ${ev.data.toString().slice(0, 100)}`);
      return;
    }
    logEvent(msg);

    if (msg.type === 'run_started' && msg.clientRequestId === clientRequestId) {
      runId = msg.runId;
      receivedRunStarted = true;
    }
    if (runId && msg.runId && msg.runId !== runId) return;
    if (msg.type === 'delta') {
      receivedFirstDelta = true;
      deltaCount += 1;
    }
    if (msg.type === 'tool_use') {
      toolUseCount += 1;
    }
    if (msg.type === 'permission_request') {
      permissionAutoAllows += 1;
      send(ws, {
        type: 'permission_decision',
        requestId: msg.requestId,
        allow: true,
      });
    }
    if (msg.type === 'run_completed' && msg.runId === runId) {
      receivedCompleted = true;
      cleanup();
    }
    if (msg.type === 'run_failed' && msg.runId === runId) {
      receivedFailed = true;
      cleanup();
    }
  };
  ws.addEventListener('message', handler);

  send(ws, {
    type: 'run_start',
    clientRequestId,
    sessionId,
    input: INPUT,
    permissionMode: PERMISSION_MODE,
  });

  const timer = setTimeout(() => {
    console.log(color('yellow', `\n⏱ TIMEOUT after ${TIMEOUT_MS}ms — never received run_completed or run_failed.`));
    cleanup();
  }, TIMEOUT_MS);

  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timer);
    setTimeout(() => {
      ws.removeEventListener('message', handler);
      ws.close();
      printSummary();
      process.exit(receivedFailed ? 1 : 0);
    }, 1500);
  }

  function printSummary() {
    console.log('\n' + color('bold', '── summary ──'));
    console.log(`  run_started:    ${receivedRunStarted ? color('green', 'yes') : color('red', 'NO')}`);
    console.log(`  first delta:    ${receivedFirstDelta ? color('green', 'yes') : color('red', 'NO')}`);
    console.log(`  delta count:    ${deltaCount}`);
    console.log(`  tool_use count: ${toolUseCount}`);
    console.log(`  permission auto-allows: ${permissionAutoAllows}`);
    console.log(`  run_completed:  ${receivedCompleted ? color('green', 'yes') : color('red', 'NO')}`);
    console.log(`  run_failed:     ${receivedFailed ? color('red', 'YES') : color('green', 'no')}`);
    console.log(`  runId:          ${runId ?? '(none)'}`);
    if (!receivedRunStarted) {
      console.log(
        color(
          'yellow',
          '\nHint: never saw run_started. Check server logs around POST /run / WS handler — message may have been rejected before the runtime even spun up.',
        ),
      );
    } else if (receivedRunStarted && !receivedFirstDelta && !receivedCompleted && !receivedFailed) {
      console.log(
        color(
          'yellow',
          '\nHint: run_started fired but no delta / completion. Provider or llm-profile call is hanging. Check server logs for provider/auth errors, and inspect agent_profiles + llm_profiles rows for the session.',
        ),
      );
    } else if (receivedFailed) {
      console.log(color('yellow', '\nHint: run failed deterministically — error string above is the diagnostic.'));
    } else if (receivedCompleted && !receivedFirstDelta) {
      console.log(
        color('yellow', '\nHint: run completed without any delta — the model returned empty content. Check provider settings / model id / system prompt.'),
      );
    }
  }
}

main().catch((err) => {
  console.error(color('red', err.stack ?? err.message));
  process.exit(99);
});
