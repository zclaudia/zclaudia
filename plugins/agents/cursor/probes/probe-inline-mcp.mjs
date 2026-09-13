// P0 probe 4/7 — inline stdio MCP via session/new mcpServers (§2.5).
// Spawns a throwaway MCP server (this file itself, in --mcp-child mode) that
// exposes one tool returning a fixed canary. Verifies the tool is really
// called and that its tool_call arrives as a placeholder + update pair.
//
// Requires a logged-in CLI. Costs one short LLM turn.
import { writeFile } from 'node:fs/promises';
import { BareAcpConnection, initialize, sanitize } from './lib/jsonrpc.mjs';

const CANARY = 'probe-mcp-canary-0451';

if (process.argv.includes('--mcp-child')) {
  // Minimal stdio MCP server: initialize → tools/list → tools/call.
  let buffer = '';
  const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.method === 'initialize') {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'zclaudia-probe', version: '1' },
          },
        });
      } else if (msg.method === 'tools/list') {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            tools: [
              {
                name: 'probe_ping',
                description: 'returns a canary',
                inputSchema: { type: 'object', properties: {} },
              },
            ],
          },
        });
      } else if (msg.method === 'tools/call') {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [{ type: 'text', text: `${CANARY} env=${process.env.PROBE_TOKEN ?? ''}` }],
          },
        });
      } else if (msg.id !== undefined) {
        send({ jsonrpc: '2.0', id: msg.id, result: {} });
      }
    }
  });
} else {
  const childPath = new URL(import.meta.url).pathname;
  const conn = new BareAcpConnection();
  conn.start();
  const record = { probe: 'inline-mcp', canary: CANARY };
  try {
    await initialize(conn);
    const collectFrom = conn.notifications.length;
    await conn.request('session/prompt', {
      sessionId: (
        await conn.request('session/new', {
          cwd: process.cwd(),
          mcpServers: [
            {
              name: 'zclaudia-probe',
              command: process.execPath,
              args: [childPath, '--mcp-child'],
              env: [{ name: 'PROBE_TOKEN', value: 'secret-123' }],
            },
          ],
        })
      ).sessionId,
      prompt: [
        {
          type: 'text',
          text: 'Call the zclaudia-probe probe_ping tool and reply with exactly what it returns.',
        },
      ],
    });
    const updates = conn.notifications.slice(collectFrom);
    const toolEvents = updates
      .map(n => n.params?.update)
      .filter(u => u?.sessionUpdate === 'tool_call' || u?.sessionUpdate === 'tool_call_update');
    record.toolEventSequence = toolEvents.map(u => ({
      kind: u.sessionUpdate,
      title: u.title,
      status: u.status,
      rawInputKeys: u.rawInput ? Object.keys(u.rawInput) : [],
    }));
    record.canaryInTranscript = updates.some(n => JSON.stringify(n.params ?? {}).includes(CANARY));
    record.permissionRequested = updates.some(n => n.method === 'session/request_permission');
    record.notes = [
      'First tool_call is a placeholder (title "MCP: tool", kind other, rawInput {}); real identity arrives via tool_call_update (§9.1).',
      'MCP tool calls trigger session/request_permission — bridge tools must go through host approval (§8.2).',
    ];
    console.log(JSON.stringify(record, null, 2));
    if (process.argv.includes('--write-fixture')) {
      await writeFile(
        new URL('./fixtures/inline-mcp.json', import.meta.url),
        JSON.stringify(sanitize(record), null, 2) + '\n'
      );
    }
  } finally {
    await conn.close();
  }
}
