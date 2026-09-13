// P0 probe 5/7 — permission request shape and the deny→"completed" trap (§2.6).
// Asks the agent to run a harmless shell echo, auto-rejects every permission
// request, and records that the final tool_call_update still reports
// status "completed" — the fact behind the §9.2 client-decision override.
//
// Requires a logged-in CLI. The only command requested is `echo`; rejection is
// automatic; no destructive call is ever allowed through.
import { writeFile } from 'node:fs/promises';
import { BareAcpConnection, initialize, sanitize } from './lib/jsonrpc.mjs';

const conn = new BareAcpConnection();
conn.start();
const record = { probe: 'permissions' };
try {
  await initialize(conn);
  const session = await conn.request('session/new', { cwd: process.cwd(), mcpServers: [] });
  const collectFrom = conn.notifications.length;

  const promptPromise = conn
    .request('session/prompt', {
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Run this exact shell command: echo probe-ok' }],
    })
    .then(
      r => ({ response: r }),
      e => ({ error: String(e.message).slice(0, 300) })
    );

  // Auto-reject up to N permission requests; each request happens after the
  // tool_call_update{status:"in_progress"}, not after "pending" (§2.6).
  let rejections = 0;
  while (rejections < 5) {
    await new Promise(r => setTimeout(r, 150));
    const req = conn.serverRequests.find(
      r => r.method === 'session/request_permission' && !r._answered
    );
    if (!req) {
      if (conn.serverRequests.length && conn.pending.size === 0) break;
      continue;
    }
    req._answered = true;
    record.firstOptions ??= req.params.options;
    record.toolCallKind ??= req.params.toolCall?.kind;
    record.reasonContent ??= req.params.toolCall?.content;
    const reject = req.params.options.find(o => o.kind === 'reject_once') ?? null;
    conn.respondTo(req, {
      outcome: reject
        ? { outcome: 'selected', optionId: reject.optionId }
        : { outcome: 'cancelled' },
    });
    rejections++;
  }

  const { response, error } = await promptPromise;
  const updates = conn.notifications
    .slice(collectFrom)
    .map(n => n.params?.update)
    .filter(u => u?.sessionUpdate?.startsWith('tool_call'));
  record.rejectedPermissionRequests = rejections;
  record.stopReason = response?.stopReason ?? null;
  record.promptError = error ?? null;
  record.toolStatusSequence = updates.map(u => u.status);
  record.finalToolStatus = updates.at(-1)?.status ?? null;
  record.notes = [
    'Expected: every rejected call still ends status "completed" → mappers must override tool_finished with the local permission decision (§9.2).',
    'Expected options: allow_once / allow_always / reject_once; no reject_always. Match by kind, never by index.',
  ];
  console.log(JSON.stringify(record, null, 2));
  if (process.argv.includes('--write-fixture')) {
    await writeFile(
      new URL('./fixtures/permissions.json', import.meta.url),
      JSON.stringify(sanitize(record), null, 2) + '\n'
    );
  }
} finally {
  await conn.close();
}
