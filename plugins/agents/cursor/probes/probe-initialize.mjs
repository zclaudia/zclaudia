// P0 probe 1/7 — initialize handshake and capability surface.
// Reproduces docs/plans/2026-09-12-cursor-acp-migration.md §2.1.
//
// Usage: node probes/probe-initialize.mjs [--out probes/fixtures/initialize.json]
// Safe to run logged out: initialize does not touch the network session.
import { writeFile } from 'node:fs/promises';
import { BareAcpConnection, initialize, sanitize } from './lib/jsonrpc.mjs';

const outIndex = process.argv.indexOf('--out');
const outPath = outIndex !== -1 ? process.argv[outIndex + 1] : null;

const conn = new BareAcpConnection();
conn.start();
try {
  const result = await initialize(conn);
  const record = {
    probe: 'initialize',
    result,
    notes: [
      'mcpCapabilities declares only http/sse; stdio is baseline and still works (§2.5).',
      'acp is absent from `cursor-agent --help` Commands; availability must be probed by handshake, not help output.',
    ],
  };
  console.log(JSON.stringify(record, null, 2));
  if (outPath) await writeFile(outPath, JSON.stringify(sanitize(record), null, 2) + '\n');
  const ok =
    result?.protocolVersion === 1 &&
    typeof result?.agentCapabilities?.loadSession === 'boolean' &&
    Array.isArray(result?.authMethods);
  if (!ok) {
    console.error('Unexpected initialize shape — CLI likely changed the protocol.');
    process.exitCode = 1;
  }
} finally {
  await conn.close();
}
