// P0 probe 3/7 — session/load semantics: cross-process resume, history replay,
// and the load failure for stream-json session ids (§2.4).
//
// Requires a logged-in CLI. This probe costs one short LLM turn.
import { writeFile } from 'node:fs/promises';
import { BareAcpConnection, initialize, sanitize } from './lib/jsonrpc.mjs';

const CWD = process.cwd();

async function newSession(conn) {
  return await conn.request('session/new', { cwd: CWD, mcpServers: [] });
}

async function prompt(conn, sessionId, text) {
  const response = await conn.request('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text }],
  });
  return response;
}

const conn = new BareAcpConnection();
conn.start();
const record = { probe: 'session-load' };
try {
  await initialize(conn);

  // 1. ACP-built session survives a process restart via session/load and the
  //    load replays history (user/agent/thought chunks) before its response.
  const secret = `probe-canary-${Date.now().toString(36)}`;
  const first = await newSession(conn);
  await prompt(
    conn,
    first.sessionId,
    `Remember this exact token and reply with just "ok": ${secret}`
  );

  const conn2 = new BareAcpConnection();
  conn2.start();
  try {
    await initialize(conn2);
    const collectFrom = conn2.notifications.length;
    const replayTurn = await prompt(conn2, first.sessionId, 'Reply with just "ok".');
    const replayUpdates = conn2.notifications.slice(collectFrom);
    record.crossProcessLoad = {
      ok: true,
      stopReason: replayTurn.stopReason,
      replayedUpdateTypes: replayUpdates
        .map(n => n.params?.update?.sessionUpdate ?? n.method)
        .filter(Boolean),
      sawUserChunkOnReplay: replayUpdates.some(
        n => n.params?.update?.sessionUpdate === 'user_message_chunk'
      ),
      contextContinuous: replayUpdates.some(n =>
        JSON.stringify(n.params?.update ?? {}).includes(secret)
      ),
    };
  } finally {
    await conn2.close();
  }

  // 2. A session id from the legacy `stream-json` CLI cannot be loaded (§2.4).
  //    Pass LEGACY_SESSION_ID=<id> to exercise; without it the check is skipped.
  const legacyId = process.env.LEGACY_SESSION_ID;
  if (legacyId) {
    try {
      await conn.request('session/load', { sessionId: legacyId, cwd: CWD, mcpServers: [] });
      record.legacyIdLoad = { ok: true };
    } catch (error) {
      record.legacyIdLoad = { ok: false, error: String(error.message).slice(0, 200) };
    }
  } else {
    record.legacyIdLoad = { skipped: 'set LEGACY_SESSION_ID=<stream-json session id> to run' };
  }

  console.log(JSON.stringify(record, null, 2));
  if (process.argv.includes('--write-fixture')) {
    await writeFile(
      new URL('./fixtures/session-load.json', import.meta.url),
      JSON.stringify(sanitize(record), null, 2) + '\n'
    );
  }
} finally {
  await conn.close();
}
