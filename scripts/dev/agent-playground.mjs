import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function valueAfter(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

function parseArgs(argv) {
  const parsed = {
    pluginPath: '',
    runtime: undefined,
    cwd: process.cwd(),
    hostPort: 4310,
    uiPort: 4311,
    build: true,
    watch: true,
    open: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--plugin':
        parsed.pluginPath = valueAfter(argv, index, arg);
        index += 1;
        break;
      case '--runtime':
        parsed.runtime = valueAfter(argv, index, arg);
        index += 1;
        break;
      case '--cwd':
        parsed.cwd = valueAfter(argv, index, arg);
        index += 1;
        break;
      case '--host-port':
        parsed.hostPort = Number(valueAfter(argv, index, arg));
        index += 1;
        break;
      case '--ui-port':
        parsed.uiPort = Number(valueAfter(argv, index, arg));
        index += 1;
        break;
      case '--no-build':
        parsed.build = false;
        break;
      case '--no-watch':
        parsed.watch = false;
        break;
      case '--no-open':
        parsed.open = false;
        break;
      default:
        throw new Error(`Unknown Agent Playground option: ${arg}`);
    }
  }
  if (!parsed.pluginPath) throw new Error('--plugin is required');
  if (!Number.isInteger(parsed.hostPort) || parsed.hostPort < 1 || parsed.hostPort > 65535) {
    throw new Error(`Invalid --host-port value: ${parsed.hostPort}`);
  }
  if (!Number.isInteger(parsed.uiPort) || parsed.uiPort < 1 || parsed.uiPort > 65535) {
    throw new Error(`Invalid --ui-port value: ${parsed.uiPort}`);
  }
  if (parsed.hostPort === parsed.uiPort) {
    throw new Error('--host-port and --ui-port must be different');
  }
  parsed.pluginPath = path.resolve(process.cwd(), parsed.pluginPath);
  parsed.cwd = path.resolve(process.cwd(), parsed.cwd);
  return parsed;
}

function spawnChild(command, args, options = {}) {
  return spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    stdio: options.stdio ?? 'inherit',
    detached: false,
  });
}

function runOnce(command, args, options, registry) {
  return new Promise((resolve, reject) => {
    const child = spawnChild(command, args, options);
    registry.push(child);
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function waitForUrl(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The process is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function openUrl(url) {
  if (process.platform === 'darwin') return spawn('open', [url], { stdio: 'ignore' });
  if (process.platform === 'win32') {
    return spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', windowsHide: true });
  }
  return spawn('xdg-open', [url], { stdio: 'ignore' });
}

function printHelp() {
  console.log(`Usage:
  pnpm agent:playground --plugin <path> [options]

Options:
  --plugin <path>     Agent plugin package containing plugin.json (required)
  --runtime <type>    Runtime contribution to load (defaults to the first)
  --cwd <path>        Working directory passed to the agent
  --host-port <port>  Lightweight Dev Host port (default: 4310)
  --ui-port <port>    Playground Vite port (default: 4311)
  --no-build          Skip the initial plugin build
  --no-watch          Disable plugin TypeScript watch and automatic reload
  --no-open           Do not open the Playground in a browser
  --help, -h          Show this help`);
}

if (process.argv.slice(2).some(argument => argument === '--help' || argument === '-h')) {
  printHelp();
  process.exit(0);
}

const options = parseArgs(process.argv.slice(2));
const token = randomBytes(24).toString('hex');
const children = [];
let closing = false;

async function cleanup(exitCode = 0) {
  if (closing) return;
  closing = true;
  const running = children.filter(child => child.exitCode === null && !child.killed);
  for (const child of running) {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  }
  await Promise.race([
    Promise.all(
      running.map(
        child =>
          new Promise(resolve => {
            if (child.exitCode !== null) resolve();
            else child.once('exit', resolve);
          })
      )
    ),
    new Promise(resolve => setTimeout(resolve, 1_000)),
  ]);
  for (const child of running) {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  process.exit(exitCode);
}

process.once('SIGINT', () => void cleanup(0));
process.once('SIGTERM', () => void cleanup(0));

try {
  console.log('[AgentPlayground] Building the shared Playground protocol');
  await runOnce('pnpm', ['--filter', '@zclaudia/shared', 'run', 'build'], undefined, children);

  if (options.build) {
    console.log(`[AgentPlayground] Building ${options.pluginPath}`);
    await runOnce('pnpm', ['--dir', options.pluginPath, 'run', 'build'], undefined, children);
  }

  const hostArgs = [
    '--filter',
    '@zclaudia/server',
    'exec',
    'tsx',
    'src/dev/agent-playground/index.ts',
    '--plugin',
    options.pluginPath,
    '--port',
    String(options.hostPort),
    '--token',
    token,
    '--cwd',
    options.cwd,
  ];
  if (options.runtime) hostArgs.push('--runtime', options.runtime);
  if (!options.watch) hostArgs.push('--no-watch');

  const host = spawnChild('pnpm', hostArgs);
  children.push(host);

  if (options.watch) {
    const compiler = spawnChild(
      'pnpm',
      [
        '--dir',
        options.pluginPath,
        'exec',
        'tsc',
        '-p',
        'tsconfig.json',
        '--watch',
        '--preserveWatchOutput',
      ],
      { cwd: options.pluginPath }
    );
    children.push(compiler);
  }

  const serverUrl = `http://127.0.0.1:${options.hostPort}`;
  const uiUrl = `http://127.0.0.1:${options.uiPort}/agent-playground.html`;
  const ui = spawnChild(
    'pnpm',
    [
      '--filter',
      '@zclaudia/desktop',
      'exec',
      'vite',
      '--host',
      '127.0.0.1',
      '--port',
      String(options.uiPort),
      '--strictPort',
    ],
    {
      env: {
        VITE_AGENT_PLAYGROUND_SERVER_URL: serverUrl,
        VITE_AGENT_PLAYGROUND_TOKEN: token,
      },
    }
  );
  children.push(ui);

  for (const child of children) {
    child.once('error', error => {
      console.error(`[AgentPlayground] ${error.message}`);
      void cleanup(1);
    });
    child.once('exit', (code, signal) => {
      if (!closing) {
        console.error(
          `[AgentPlayground] A child process exited unexpectedly (${
            signal ? `signal ${signal}` : `code ${code}`
          })`
        );
        void cleanup(code && code > 0 ? code : 1);
      }
    });
  }

  await Promise.all([waitForUrl(`${serverUrl}/health`), waitForUrl(uiUrl)]);
  console.log(`[AgentPlayground] Ready: ${uiUrl}`);
  if (options.open) openUrl(uiUrl);
} catch (error) {
  console.error(`[AgentPlayground] ${error instanceof Error ? error.message : String(error)}`);
  await cleanup(1);
}
