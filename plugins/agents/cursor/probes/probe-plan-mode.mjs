// P0 probe 6/7 — plan mode isolation and cursor/create_plan extension (§2.7).
// Switches a fresh session to mode "plan", asks for a workspace write and an
// implementation plan, auto-declines cursor/create_plan approval, then checks
// the workspace has no new files.
//
// Requires a logged-in CLI. Costs one short LLM turn. Runs inside its own
// scratch directory (create one: `mktemp -d` and run from there).
import { writeFile, readdir } from 'node:fs/promises';
import { BareAcpConnection, initialize, sanitize } from './lib/jsonrpc.mjs';

const CWD = process.cwd();
const before = (await readdir(CWD)).sort();

const conn = new BareAcpConnection({ cwd: CWD });
conn.start();
const record = { probe: 'plan-mode', cwdFilesBefore: before };
try {
  await initialize(conn);
  const session = await conn.request('session/new', { cwd: CWD, mcpServers: [] });
  record.availableModes = session.modes?.availableModes?.map(m => m.id);
  await conn.request('session/set_mode', { sessionId: session.sessionId, modeId: 'plan' });

  const collectFrom = conn.notifications.length;
  const promptPromise = conn
    .request('session/prompt', {
      sessionId: session.sessionId,
      prompt: [
        {
          type: 'text',
          text: 'Write a file named probe-should-not-exist.txt containing "x". If you cannot write files in this mode, produce a short implementation plan for it instead.',
        },
      ],
    })
    .then(
      r => ({ response: r }),
      e => ({ error: String(e.message).slice(0, 300) })
    );

  // Serve plan mode for a bounded window; decline cursor/create_plan and any
  // permission request. Read-only tools (search etc.) need no approval (§2.7).
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 150));
    const req = conn.serverRequests.find(r => !r._answered);
    if (req) {
      req._answered = true;
      if (req.method === 'session/request_permission') {
        record.permissionRequestKinds ??= req.params.options?.map(o => o.kind);
        const reject = req.params.options.find(o => o.kind === 'reject_once');
        conn.respondTo(req, {
          outcome: reject
            ? { outcome: 'selected', optionId: reject.optionId }
            : { outcome: 'cancelled' },
        });
      } else {
        // cursor/create_plan and other extension requests: the session must
        // survive a -32601 reply (§2.7) — but prefer a typed decline first.
        conn.respondTo(req, { outcome: { outcome: 'cancelled' } });
      }
    }
    if (conn.pending.size === 0 && conn.serverRequests.every(r => r._answered)) break;
  }
  const { response, error } = await promptPromise;

  const after = (await readdir(CWD)).sort();
  const updates = conn.notifications.slice(collectFrom).map(n => n.params);
  record.stopReason = response?.stopReason ?? null;
  record.promptError = error ?? null;
  record.extensionRequests = conn.serverRequests
    .filter(r => r.method !== 'session/request_permission')
    .map(r => r.method);
  record.workspaceUntouched = JSON.stringify(before) === JSON.stringify(after);
  record.createPlanSeen = updates.some(u => JSON.stringify(u ?? {}).includes('create_plan'));
  record.notes = [
    'Expected: workspaceUntouched=true; plan text may land in ~/.cursor/plans/ (provider-owned state, not workspace).',
    'Expected: read-only tools run without permission requests; cursor/create_plan arrives as a server→client request with toolCallId/name/overview/plan.',
    'A -32601 reply to cursor/create_plan must not crash the session (§2.7 baseline).',
  ];
  console.log(JSON.stringify(record, null, 2));
  if (process.argv.includes('--write-fixture')) {
    await writeFile(
      new URL('./fixtures/plan-mode.json', import.meta.url),
      JSON.stringify(sanitize(record), null, 2) + '\n'
    );
  }
} finally {
  await conn.close();
}
