import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inventoryPlugin } from '../plugins/artifact-integrity.mjs';

const args = process.argv.slice(2).filter(value => value !== '--');
if (args.includes('--help')) {
  console.log(
    'Usage: node test-builtin-runtime-artifact-smoke.mjs --artifact-dir <read-only-server-bundle> --node-path <shipped-node> --fixtures-dir <cli-fixtures> --output-dir <new-directory>'
  );
  console.log(
    'Public API smoke test for an isolated POSIX container. Requires read-only artifact resources; uses private CLI fixtures, never vendor accounts. Does not certify native UI, real CLI, or installer upgrades.'
  );
  process.exit(0);
}
if (process.platform === 'win32') throw new Error('Artifact smoke currently requires POSIX');
const options = {};
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  if (
    !['--artifact-dir', '--node-path', '--fixtures-dir', '--output-dir'].includes(key) ||
    !args[i + 1] ||
    options[key]
  )
    throw new Error(`Invalid argument: ${key}`);
  options[key] = path.resolve(args[i + 1]);
}
for (const key of ['--artifact-dir', '--node-path', '--fixtures-dir', '--output-dir']) {
  if (!options[key]) throw new Error(`Required: ${key}`);
}
const artifact = await realpath(options['--artifact-dir']);
const node = await realpath(options['--node-path']);
const fixtures = await realpath(options['--fixtures-dir']);
const output = options['--output-dir'];
await mkdir(output, { mode: 0o700 }); // Never overwrite a prior report.
const report = {
  mode: 'isolated-artifact-api-with-cli-fixtures',
  status: 'running',
  platform: process.platform,
  arch: process.arch,
  results: [],
  nativeUiVerified: false,
  realCliVerified: false,
};
const save = () => writeFile(path.join(output, 'summary.json'), JSON.stringify(report, null, 2));
const sha = async filename =>
  createHash('sha256')
    .update(await readFile(filename))
    .digest('hex');
let child;
let url;
let logs = '';
const auditFile = path.join(output, 'cli-audit.jsonl');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
};
async function audit() {
  return (await readFile(auditFile, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}
async function api(endpoint, method = 'GET', body) {
  const response = await fetch(url + endpoint, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  assert.ok(response.ok && result.success, `${method} ${endpoint}: ${JSON.stringify(result)}`);
  return result.data;
}
async function start() {
  let startup = '';
  child = spawn(node, [path.join(artifact, 'server.mjs')], {
    cwd: output,
    env: {
      PATH: `${path.dirname(node)}:/usr/bin:/bin`,
      HOME: path.join(output, 'home'),
      NODE_ENV: 'test',
      PORT: '0',
      HOST: '127.0.0.1',
      SERVER_HOST: '127.0.0.1',
      ZCLAUDIA_DATA_DIR: path.join(output, 'data'),
      ZCLAUDIA_AGENT_CONFIG_ROOT: path.join(output, 'provider-config'),
      E2E_RUNTIME_AUDIT: auditFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const append = chunk => {
    logs += chunk.toString();
    startup += chunk.toString();
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  let spawnError;
  child.once('error', error => {
    spawnError = error;
  });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    const match = /SERVER_READY:(\d+)/.exec(startup);
    if (match) {
      url = `http://127.0.0.1:${match[1]}`;
      return;
    }
    assert.equal(child.exitCode, null, 'Packaged server exited during startup');
    assert.equal(child.signalCode, null, 'Packaged server was terminated during startup');
    await pause(100);
  }
  throw new Error('Packaged server startup timed out');
}
async function stop() {
  const server = child;
  if (!server) return;
  const began = Date.now();
  if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM');
  while (server.exitCode === null && server.signalCode === null && Date.now() - began < 10000)
    await pause(50);
  if (server.exitCode === null && server.signalCode === null) {
    server.kill('SIGKILL');
    throw new Error('Packaged server did not exit gracefully within 10 seconds');
  }
  child = undefined;
  const pids = [
    ...new Set(
      (await audit()).map(event => event.pid).filter(pid => Number.isSafeInteger(pid) && pid > 1)
    ),
  ];
  while (pids.some(alive) && Date.now() - began < 10000) await pause(50);
  const remaining = pids.filter(alive);
  report.cleanup = {
    serverExitCode: server.exitCode,
    signal: server.signalCode,
    durationMs: Date.now() - began,
    remainingFixturePids: remaining,
  };
  assert.deepEqual(remaining, [], 'Fixture processes survived server shutdown');
}
async function verifyResources() {
  const catalog = JSON.parse(
    await readFile(path.join(artifact, 'builtin-plugins/catalog.json'), 'utf8')
  );
  assert.equal(catalog.plugins.length, 3);
  for (const runtime of ['claude', 'codex', 'cursor']) {
    const entry = catalog.plugins.find(item => item.runtime === runtime);
    assert.equal(entry?.id, `com.zclaudia.${runtime}`);
    const actual = await inventoryPlugin(path.join(artifact, 'builtin-plugins', runtime));
    assert.ok(actual.files.every(file => !file.link));
    assert.equal(actual.treeSha256, entry.treeSha256);
    assert.deepEqual(actual.files, entry.files);
  }
  return catalog;
}

try {
  const canary = path.join(artifact, `.readonly-probe-${randomUUID()}`);
  let denied = false;
  try {
    await writeFile(canary, 'probe', { flag: 'wx' });
  } catch (error) {
    if (!['EROFS', 'EPERM', 'EACCES'].includes(error.code)) throw error;
    denied = true;
  }
  if (!denied) {
    await rm(canary);
    throw new Error('Artifact must be mounted read-only');
  }
  report.resourceWriteDenied = true;
  const catalog = await verifyResources();
  report.artifactBaseline = {
    sourceCommit: catalog.sourceCommit,
    sourceDirty: catalog.sourceDirty,
    serverSha256: await sha(path.join(artifact, 'server.mjs')),
    catalogSha256: await sha(path.join(artifact, 'builtin-plugins/catalog.json')),
    nodeSha256: await sha(node),
  };
  await mkdir(path.join(output, 'home'));
  await mkdir(path.join(output, 'provider-config'));
  await writeFile(auditFile, '');
  await cp(path.join(fixtures, 'mcp.mjs'), path.join(output, 'mcp.mjs'));
  await start();
  const profiles = await api('/api/agent-profiles');
  assert.equal(profiles.length, 3);
  const plugins = await api('/api/plugins');
  assert.equal(
    plugins.filter(plugin => plugin.source === 'builtin' && plugin.status === 'active').length,
    3
  );
  const pluginDir = path.join(output, 'data/plugins/artifact-probe');
  await mkdir(pluginDir, { recursive: true });
  const receiptsFile = path.join(output, 'mcp-receipts.jsonl');
  const nonce = randomUUID();
  await writeFile(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify({
      id: 'e2e.artifact-probe',
      name: 'Artifact probe',
      description: 'Private artifact acceptance MCP session probe',
      version: '1.0.0',
      main: 'main.mjs',
    })
  );
  await writeFile(
    path.join(pluginDir, 'main.mjs'),
    `import {appendFileSync} from 'node:fs'; export function activate(ctx) { ctx.tools.registerTool({ id:'e2e_session_probe', name:'e2e_session_probe', description:'Artifact session probe', parameters:{type:'object',properties:{marker:{type:'string'}}}, handler:async(args,context)=>{const result={sessionId:context.sessionId,marker:args.marker,nonce:${JSON.stringify(nonce)}};appendFileSync(${JSON.stringify(receiptsFile)},JSON.stringify(result)+'\\n');return JSON.stringify(result);} }); } export function deactivate(){}`
  );
  await api('/api/plugins/discover', 'POST');
  await api('/api/plugins/e2e.artifact-probe/activate', 'POST');
  const sessions = [];
  for (const runtime of ['claude', 'codex', 'cursor']) {
    const profile = profiles.find(item => item.runtimeType === runtime);
    assert.equal(profile.llmProfileId, '');
    const cwd = path.join(output, 'workspace', runtime);
    await mkdir(cwd, { recursive: true });
    await writeFile(path.join(cwd, 'add.mjs'), 'export const add = (a, b) => a - b;\n');
    await writeFile(
      path.join(cwd, 'add.test.mjs'),
      "import {test} from 'node:test';import assert from 'node:assert/strict';import {add} from './add.mjs';test('addition',()=>assert.equal(add(2,3),5));\n"
    );
    const script = path.join(output, `${runtime}-fixture.mjs`);
    await cp(path.join(fixtures, runtime, 'cli.mjs'), script);
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
    const cliPath = path.join(output, `${runtime}-fixture`);
    await writeFile(cliPath, `#!/bin/sh\nexec ${quote(node)} ${quote(script)} "$@"\n`, {
      mode: 0o755,
    });
    await api(`/api/agent-profiles/${profile.id}`, 'PATCH', { cliPath });
    const project = await api('/api/projects', 'POST', {
      name: `${runtime} artifact smoke`,
      rootPath: cwd,
      defaultAgentProfileId: profile.id,
    });
    const workflow = await api(`/api/projects/${project.id}/workflows`, 'POST', {
      name: 'Artifact coding',
      status: 'active',
      definition: {
        entryNodeId: 'coding',
        edges: [],
        nodes: [
          {
            id: 'coding',
            name: 'Coding',
            type: 'task',
            position: { x: 0, y: 0 },
            config: {
              taskType: 'agent',
              prompt: 'E2E_MCP then fix addition and run its test.',
              wait: true,
            },
          },
        ],
      },
    });
    const triggered = await api(`/api/workflows/${workflow.id}/trigger`, 'POST');
    const deadline = Date.now() + 40000;
    let completed;
    do {
      completed = await api(`/api/workflow-runs/${triggered.id}`);
      if (['completed', 'failed', 'cancelled'].includes(completed.run.status)) break;
      await pause(100);
    } while (Date.now() < deadline);
    assert.equal(completed.run.status, 'completed', JSON.stringify(completed));
    assert.match(await readFile(path.join(cwd, 'add.mjs'), 'utf8'), /a \+ b/);
    const events = (await audit()).filter(event => event.runtime === runtime);
    assert.ok(events.some(event => event.cwd === cwd));
    assert.ok(events.some(event => event.testExitCode === 0));
    const taskSession = (await api(`/api/sessions?projectId=${project.id}`)).find(
      session => session.type === 'agent'
    );
    assert.ok(taskSession?.sdkSessionId);
    const receipts = (await readFile(receiptsFile, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    assert.ok(
      receipts.some(receipt => receipt.sessionId === taskSession.id && receipt.nonce === nonce)
    );
    sessions.push(taskSession);
    report.results.push({
      runtime,
      status: 'passed',
      sessionId: taskSession.id,
      providerSessionId: taskSession.sdkSessionId,
      profileId: profile.id,
      codingTestExitCode: 0,
      mcpReceiptVerified: true,
    });
    await save();
  }
  await api('/api/plugins/com.zclaudia.codex/deactivate', 'POST');
  await stop();
  await start();
  const restoredProfiles = await api('/api/agent-profiles');
  assert.deepEqual(
    restoredProfiles.map(profile => profile.id).sort(),
    profiles.map(profile => profile.id).sort()
  );
  const restoredPlugins = await api('/api/plugins');
  assert.equal(restoredPlugins.find(plugin => plugin.id === 'com.zclaudia.codex').enabled, false);
  for (const session of sessions)
    assert.equal((await api(`/api/sessions/${session.id}`)).sdkSessionId, session.sdkSessionId);
  await api('/api/plugins/com.zclaudia.codex/activate', 'POST');
  report.restartPersistence = 'passed';
  report.resourceIntegrityAfter = (await verifyResources()).plugins.length === 3;
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error);
  process.exitCode = 1;
} finally {
  try {
    await stop();
  } catch (error) {
    report.status = 'failed';
    report.cleanupError = String(error);
    process.exitCode = 1;
  }
  await writeFile(path.join(output, 'server.log'), logs);
  await save();
  console.log(JSON.stringify(report, null, 2));
}
