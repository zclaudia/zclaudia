// P0 probe 7/7 — session/cancel latency and clean shutdown (§2.8).
// Starts a long turn, sends session/cancel as a notification, and measures how
// quickly the pending session/prompt converges to stopReason "cancelled".
// Then closes stdin and verifies the process exits without SIGTERM.
//
// Requires a logged-in CLI. Costs a few seconds of one turn.
import { writeFile } from 'node:fs/promises';
import { BareAcpConnection, initialize, sanitize } from './lib/jsonrpc.mjs';

const conn = new BareAcpConnection();
conn.start();
const record = { probe: 'cancel' };
try {
  await initialize(conn);
  const session = await conn.request('session/new', { cwd: process.cwd(), mcpServers: [] });

  const startedAt = Date.now();
  const promptPromise = conn
    .request('session/prompt', {
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Count slowly from 1 to 200, one number per line.' }],
    })
    .then(
      r => ({ response: r, at: Date.now() }),
      e => ({ error: String(e.message).slice(0, 300), at: Date.now() })
    );

  await new Promise(r => setTimeout(r, 2_000));
  conn.notify('session/cancel', { sessionId: session.sessionId });
  const cancelSentAt = Date.now();
  const settled = await promptPromise;

  record.cancelToTerminalMs = settled.at - cancelSentAt;
  record.stopReason = settled.response?.stopReason ?? null;
  record.promptError = settled.error ?? null;

  conn.proc.stdin.end();
  const exited = await Promise.race([
    conn.exitPromise.then(code => ({ code })),
    new Promise(resolve => setTimeout(() => resolve(null), 5_000)),
  ]);
  record.exitedWithoutSignal = exited !== null;
  record.exitCode = exited?.code ?? null;
  record.sigtermUsed = false;
  record.notes = [
    'Expected: stopReason "cancelled" within single-digit/low tens of ms of the cancel notification; stdin close ends the process; SIGTERM/SIGKILL unused (§2.8).',
  ];
  console.log(JSON.stringify(record, null, 2));
  if (process.argv.includes('--write-fixture')) {
    await writeFile(
      new URL('./fixtures/cancel.json', import.meta.url),
      JSON.stringify(sanitize(record), null, 2) + '\n'
    );
  }
} finally {
  if (!conn.closed) {
    conn.proc.kill('SIGTERM');
    await conn.exitPromise;
  }
}
