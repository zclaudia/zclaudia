import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';

// A controllable CLI-boundary task for L06 driver self-tests. The application
// and both adapters stay real; only this vendor task waits for the test release.
export async function waitForConcurrentRelease(cwd) {
  await new Promise((resolve, reject) => {
    let tick = 0;
    const timer = setInterval(() => {
      writeFileSync(path.join(cwd, 'concurrent-tick.txt'), String(++tick));
      if (existsSync(path.join(cwd, 'concurrency-release'))) {
        clearInterval(timer);
        clearTimeout(deadline);
        resolve();
      }
    }, 100);
    const deadline = setTimeout(() => {
      clearInterval(timer);
      reject(new Error('Fixture concurrent release timed out'));
    }, 30000);
  });
}

/** Resolve `${VAR}` references against this process's environment, as cursor-agent does. */
function expandEnvPlaceholders(env) {
  return Object.fromEntries(
    Object.entries(env ?? {}).map(([key, value]) => [
      key,
      typeof value === 'string'
        ? value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (literal, name) =>
            process.env[name] === undefined ? literal : process.env[name]
          )
        : value,
    ])
  );
}

// Runs the host's actual stdio proxy. No bridge URL, credential, or generated
// config is copied to the test report.
export async function exerciseMcp(runtime, args, cwd, prompt, inlineConfig) {
  assert.ok(prompt, 'The fixture must inspect the actual turn input');
  for (const section of [
    '[System Context]',
    '## Your Identity',
    '## Behavior Guidelines',
    '## Tool Usage Guide',
  ]) {
    assert.ok(!prompt.includes(section), `Unexpected automatic host prompt: ${section}`);
  }
  if (runtime === 'claude') {
    assert.ok(
      !args.includes('--append-system-prompt'),
      'Default Claude runs must use only the native preset'
    );
  }
  let config = inlineConfig;
  if (inlineConfig) {
    assert.ok(inlineConfig.command, 'ACP must provide the bridge in session/new');
  } else if (runtime === 'cursor') {
    // cursor-agent expands ${VAR} in an MCP server's env from its own process
    // environment, so the adapter references the bridge values by variable name
    // instead of writing them into the user's project file. Mirror that here,
    // otherwise this fixture sees placeholders where the real CLI sees values.
    const raw = readFileSync(path.join(cwd, '.cursor/mcp.json'), 'utf8');
    const injected = Object.values(JSON.parse(raw).mcpServers).find(
      server => server.env?.AGENT_TOOL_BRIDGE_SESSION_ID
    );
    config = injected && { ...injected, env: expandEnvPlaceholders(injected.env) };
    assert.ok(
      config?.env?.AGENT_TOOL_BRIDGE_TOKEN,
      'Adapter must supply the bridge token through the CLI environment'
    );
    assert.ok(
      !raw.includes(config.env.AGENT_TOOL_BRIDGE_TOKEN),
      'Injected .cursor/mcp.json must reference the bridge token by variable, not by value'
    );
  } else if (runtime === 'claude') {
    const raw = args[args.indexOf('--mcp-config') + 1];
    config = Object.values(JSON.parse(raw).mcpServers).find(
      server => server.env?.AGENT_TOOL_BRIDGE_SESSION_ID
    );
  } else {
    config = { env: {} };
    for (let i = 0; i < args.length; i++) {
      if (args[i] !== '-c') continue;
      const match = /^mcp_servers\.claudia-plugins\.(command|args|env\.[^=]+)=(.*)$/.exec(
        args[++i]
      );
      if (!match) continue;
      if (match[1].startsWith('env.')) config.env[match[1].slice(4)] = JSON.parse(match[2]);
      else config[match[1]] = JSON.parse(match[2]);
    }
  }
  assert.ok(config?.command, 'Adapter must inject the real MCP proxy');
  const sessionId = config.env.AGENT_TOOL_BRIDGE_SESSION_ID;
  assert.ok(sessionId);
  const child = spawn(config.command, config.args, {
    cwd,
    env: { ...process.env, ...config.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = new Promise(resolve => child.once('exit', resolve));
  appendFileSync(
    process.env.E2E_RUNTIME_AUDIT,
    JSON.stringify({ runtime, pid: child.pid, mcpSessionId: sessionId }) + '\n'
  );
  let nextId = 0;
  const pending = new Map();
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
  });
  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP ${method} timed out`));
      }, 5000);
      pending.set(id, message => {
        clearTimeout(timeout);
        pending.delete(id);
        if (message.error) reject(new Error(`MCP ${method} failed: ${message.error.message}`));
        else resolve(message.result);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  try {
    const initialized = await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e', version: '1' },
    });
    assert.equal(initialized.serverInfo.name, 'agent-tool-bridge');
    const listed = await request('tools/list');
    assert.ok(listed.tools.some(tool => tool.name === 'e2e_session_probe'));
    const pushFile = listed.tools.find(tool => tool.name === 'push_file');
    assert.ok(pushFile, 'push_file must be discoverable without a system prompt');
    assert.ok(pushFile.description.includes('local file'));
    assert.ok(pushFile.inputSchema.required.includes('filePath'));
    const fileName = `mcp-delivery-${sessionId}.txt`;
    const filePath = path.join(cwd, fileName);
    writeFileSync(filePath, `MCP delivery for ${sessionId}\n`);
    const pushed = await request('tools/call', {
      name: 'push_file',
      arguments: { filePath, description: 'MCP injection verification' },
    });
    assert.ok(!pushed.isError);
    const delivery = JSON.parse(pushed.content[0].text);
    assert.equal(delivery.success, true, JSON.stringify(delivery));
    assert.equal(delivery.fileName, fileName);
    writeFileSync(path.join(cwd, 'mcp-delivery-result.json'), JSON.stringify(delivery));
    const spoof = await fetch(
      `${config.env.AGENT_TOOL_BRIDGE_URL}/v1/tools/e2e_session_probe/call`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.env.AGENT_TOOL_BRIDGE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: 'forged-session',
          arguments: { marker: 'E2E_MCP_FORGED' },
        }),
      }
    );
    assert.equal(spoof.ok, false, 'A bridge credential cannot choose another session');
    const result = await request('tools/call', {
      name: 'e2e_session_probe',
      arguments: { marker: `E2E_MCP_${sessionId}` },
    });
    assert.equal(result.isError, undefined);
    assert.equal(JSON.parse(result.content[0].text).sessionId, sessionId);
  } finally {
    child.stdin.end();
    const timeout = setTimeout(() => child.kill('SIGKILL'), 2000);
    await exited;
    clearTimeout(timeout);
    lines.close();
  }
}
