import { cp, chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2).filter(arg => arg !== '--');
if (args.includes('--help')) {
  console.log(
    'Usage: pnpm test:e2e:agent-runtimes:bundle -- --artifact-dir <server-bundle> [--node-path <shipped-node>] [--grep <test-pattern>] [--gateway-entry <gateway-v3-server-module>]\nBuild the frontend and server bundle first. Uses a temporary, read-only copy with spaces and Chinese characters in its path. --gateway-entry selects the separate Gateway suite; its gateway is an external test service. Filtered runs are explicitly marked as partial acceptance.'
  );
  process.exit(0);
}
const options = {};
for (let index = 0; index < args.length; index += 2) {
  if (
    !['--artifact-dir', '--node-path', '--grep', '--gateway-entry'].includes(args[index]) ||
    !args[index + 1]
  )
    throw new Error(`Invalid argument ${args[index]}`);
  options[args[index]] = args[index] === '--grep' ? args[index + 1] : path.resolve(args[index + 1]);
}
if (!options['--artifact-dir']) throw new Error('--artifact-dir is required');
const triples = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
};
const nodePath =
  options['--node-path'] ??
  path.join(
    root,
    'apps/desktop/src-tauri/binaries',
    `node-${triples[`${process.platform}-${process.arch}`]}`
  );
const temporary = await mkdtemp(path.join(tmpdir(), 'zclaudia-bundle-'));
const artifact = path.join(temporary, 'resources');
const browserDist = path.join(temporary, 'browser-shell');
const copiedNode = path.join(temporary, 'node');
const runId = `bundle-${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
const reportPath = path.join(
  root,
  'artifacts/agent-runtime-migration',
  runId,
  'bundle-summary.json'
);
const originalModes = new Map();
async function makeReadonly(directory, readonly) {
  const mode = (await stat(directory)).mode & 0o777;
  if (readonly) originalModes.set(directory, mode);
  else await chmod(directory, originalModes.get(directory) ?? mode);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await makeReadonly(filename, readonly);
    else if (entry.isFile()) {
      const fileMode = (await stat(filename)).mode & 0o777;
      if (readonly) originalModes.set(filename, fileMode);
      await chmod(
        filename,
        readonly ? fileMode & ~0o222 : (originalModes.get(filename) ?? fileMode)
      );
    }
  }
  if (readonly) await chmod(directory, mode & ~0o222);
}
let status = 'failed';
try {
  await cp(options['--artifact-dir'], artifact, { recursive: true, verbatimSymlinks: true });
  await cp(path.join(root, 'apps/desktop/dist'), browserDist, { recursive: true });
  await cp(nodePath, copiedNode);
  await chmod(copiedNode, 0o755);
  execFileSync(
    copiedNode,
    [
      path.join(root, 'scripts/plugins/verify-builtin-agents.mjs'),
      path.join(artifact, 'builtin-plugins'),
    ],
    { stdio: 'inherit' }
  );
  // The browser shell is a separately built client; the server and adapters
  // under test come exclusively from the supplied release artifact.
  await makeReadonly(artifact, true);
  const env = {
    ...process.env,
    ZCLAUDIA_E2E_SERVER_ENTRY: path.join(artifact, 'server.mjs'),
    ZCLAUDIA_E2E_NODE_PATH: copiedNode,
    ZCLAUDIA_E2E_BROWSER_DIST: browserDist,
    AGENT_RUNTIME_E2E_RUN_ID: runId,
    ...(options['--gateway-entry']
      ? { ZCLAUDIA_E2E_GATEWAY_ENTRY: options['--gateway-entry'] }
      : {}),
  };
  if (process.platform === 'darwin') {
    const profile = path.join(temporary, 'no-source.sb');
    await writeFile(
      profile,
      `(version 1)\n(allow default)\n(deny file-read* (subpath ${JSON.stringify(root)}) (subpath ${JSON.stringify(path.resolve(root, '../zclaudia-plugins'))}))\n(deny file-write* (subpath ${JSON.stringify(artifact)}))\n`
    );
    env.ZCLAUDIA_E2E_SANDBOX_PROFILE = profile;
  }
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      'pnpm',
      [
        'exec',
        'playwright',
        'test',
        '--config',
        options['--gateway-entry']
          ? 'e2e/playwright.agent-runtime-gateway.config.ts'
          : 'e2e/playwright.agent-runtimes.config.ts',
        ...(options['--grep'] ? ['--grep', options['--grep']] : []),
      ],
      { cwd: root, env, stdio: 'inherit' }
    );
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (code !== 0) throw new Error(`Artifact E2E exited ${code}`);
  await makeReadonly(artifact, false);
  execFileSync(
    copiedNode,
    [
      path.join(root, 'scripts/plugins/verify-builtin-agents.mjs'),
      path.join(artifact, 'builtin-plugins'),
    ],
    { stdio: 'inherit' }
  );
  status = 'passed';
} finally {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        status,
        platform: process.platform,
        arch: process.arch,
        artifact: options['--artifact-dir'],
        fullSuite: !options['--grep'],
        suite: options['--gateway-entry'] ? 'gateway-v3' : 'core',
        testFilter: options['--grep'] ?? null,
        sourceReadDenied: process.platform === 'darwin',
        resourceWriteDenied: process.platform === 'darwin',
        client: 'separately built browser shell',
        nodeVersion: execFileSync(nodePath, ['--version'], { encoding: 'utf8' }).trim(),
      },
      null,
      2
    )
  );
  await makeReadonly(artifact, false).catch(() => {});
  await rm(temporary, { recursive: true, force: true });
}
