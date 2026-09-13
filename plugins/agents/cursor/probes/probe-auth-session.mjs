// P0 probe 2/7 — authenticate + session/new, modes/models payloads.
// Reproduces §2.2 (auth) and §2.3 (modes/models carry bracketed modelId).
//
// Requires a logged-in `cursor-agent` CLI. Writes sanitized session/new facts;
// the returned session id is discarded, nothing is prompted.
import { writeFile } from 'node:fs/promises';
import { BareAcpConnection, initialize, sanitize } from './lib/jsonrpc.mjs';

const conn = new BareAcpConnection();
conn.start();
try {
  const init = await initialize(conn);
  const authMethod = init.authMethods?.find(m => m.id === 'cursor_login');
  const record = { probe: 'auth-session', authMethod: authMethod?.id ?? null };

  // Official flow: authenticate before session/new even when already logged in.
  if (authMethod) {
    try {
      record.authenticate = await conn.request('authenticate', { methodId: authMethod.id });
      record.authenticateOk = true;
    } catch (error) {
      record.authenticateOk = false;
      record.authenticateError = String(error.message).slice(0, 300);
    }
  }

  const session = await conn.request('session/new', { cwd: process.cwd(), mcpServers: [] });
  record.modes = session.modes;
  record.models = {
    currentModelId: session.models?.currentModelId,
    availableModels: session.models?.availableModels?.map(m => ({
      modelId: m.modelId,
      name: m.name,
    })),
  };
  record.sessionShape = {
    hasSessionId: typeof session.sessionId === 'string',
    hasModes: !!session.modes,
    hasModels: !!session.models,
  };

  // §2.3: set_mode / set_model round-trip with the exact returned ids.
  const agentMode =
    session.modes?.availableModes?.find(m => m.id === 'agent') ?? session.modes?.currentModeId;
  record.setMode = await conn.request('session/set_mode', {
    sessionId: session.sessionId,
    modeId: agentMode,
  });
  record.setModel = await conn.request('session/set_model', {
    sessionId: session.sessionId,
    modelId: session.models?.currentModelId,
  });

  console.log(JSON.stringify(record, null, 2));
  if (process.argv.includes('--write-fixture')) {
    await writeFile(
      new URL('./fixtures/auth-session.json', import.meta.url),
      JSON.stringify(sanitize(record), null, 2) + '\n'
    );
  }
} finally {
  await conn.close();
}
