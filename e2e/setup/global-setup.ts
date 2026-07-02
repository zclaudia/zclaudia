/**
 * Global Setup - Multi-service startup for E2E tests
 *
 * Replaces playwright.config.ts webServer configuration.
 * Starts gateway → server → desktop in order, waits for ports to be ready.
 */
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { createConnection } from 'net';
import * as path from 'path';
import * as fs from 'fs';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');
const GATEWAY_DIR = path.resolve(ROOT_DIR, '../zclaudia-gateway');
const E2E_DATA_DIR = path.join(ROOT_DIR, '.tmp', 'e2e-data');
const E2E_GATEWAY_PORT = 3320;
const E2E_SERVER_PORT = 3310;
const E2E_DESKTOP_PORT = 1421;

interface ServiceConfig {
  name: string;
  command: string[];
  cwd: string;
  port: number;
  timeout: number;
  env?: Record<string, string>;
  healthPath?: string;
}

interface BuildStep {
  name: string;
  command: string[];
  cwd?: string;
}

interface ServiceProbeResponse {
  status: number;
  body: string;
  contentType: string;
}

function parseRequestedModeIds(env: NodeJS.ProcessEnv): Set<string> | null {
  const rawModes = env.TEST_MODES;
  if (!rawModes?.trim()) return null;

  const modeIds = rawModes
    .split(',')
    .map(mode => mode.trim())
    .filter(Boolean);

  return modeIds.length > 0 ? new Set(modeIds) : null;
}

export function isGatewayModeRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  const requestedModeIds = parseRequestedModeIds(env);
  if (!requestedModeIds) return true;

  for (const modeId of requestedModeIds) {
    if (modeId === 'gateway' || modeId.startsWith('gateway-')) {
      return true;
    }
  }

  return false;
}

export function requireGatewayWorkspace(gatewayDir = GATEWAY_DIR): void {
  if (fs.existsSync(path.join(gatewayDir, 'package.json'))) return;

  throw new Error(
    `[Setup] TEST_MODES includes gateway, but the gateway workspace was not found at ${gatewayDir}. ` +
      'Clone/build zclaudia-gateway next to this repo, or run with TEST_MODES=local or TEST_MODES=remote.'
  );
}

export function getBuildSteps(env: NodeJS.ProcessEnv = process.env): BuildStep[] {
  const steps: BuildStep[] = [
    {
      name: 'shared build',
      command: [
        'bash',
        path.join(ROOT_DIR, 'scripts/with-project-node.sh'),
        'pnpm',
        '--filter',
        '@zclaudia/shared',
        'build',
      ],
    },
  ];

  if (isGatewayModeRequested(env)) {
    steps.push({
      name: 'gateway build',
      command: ['pnpm', 'run', 'build'],
      cwd: GATEWAY_DIR,
    });
  }

  steps.push({
    name: 'server build',
    command: [
      'bash',
      path.join(ROOT_DIR, 'scripts/with-project-node.sh'),
      'pnpm',
      '--filter',
      '@zclaudia/server',
      'build',
    ],
  });

  return steps;
}

function createGatewayService(): ServiceConfig {
  return {
    name: 'Gateway',
    command: ['node', 'dist/index.js'],
    cwd: GATEWAY_DIR,
    port: E2E_GATEWAY_PORT,
    timeout: 120000,
    env: {
      GATEWAY_PORT: String(E2E_GATEWAY_PORT),
      GATEWAY_SECRET: 'test-secret-zclaudia-2026',
      ZCLAUDIA_DATA_DIR: E2E_DATA_DIR,
    },
  };
}

function createServerService(includeGateway: boolean): ServiceConfig {
  return {
    name: 'Server',
    command: ['bash', path.join(ROOT_DIR, 'scripts/with-project-node.sh'), 'node', 'dist/index.js'],
    cwd: path.join(ROOT_DIR, 'server'),
    port: E2E_SERVER_PORT,
    timeout: 120000,
    healthPath: '/api/server/info',
    env: {
      PORT: String(E2E_SERVER_PORT),
      ...(includeGateway
        ? {
            GATEWAY_URL: `ws://localhost:${E2E_GATEWAY_PORT}`,
            GATEWAY_SECRET: 'test-secret-zclaudia-2026',
            GATEWAY_NAME: 'TestBackend',
          }
        : {}),
      ZCLAUDIA_DATA_DIR: E2E_DATA_DIR,
    },
  };
}

function createDesktopService(): ServiceConfig {
  return {
    name: 'Desktop',
    command: ['bash', path.join(ROOT_DIR, 'scripts/with-project-node.sh'), 'pnpm', 'exec', 'vite'],
    cwd: path.join(ROOT_DIR, 'apps/desktop'),
    port: E2E_DESKTOP_PORT,
    timeout: 120000,
    healthPath: '/',
    env: {
      VITE_DEV_SERVER_PORT: String(E2E_DESKTOP_PORT),
      VITE_LOCAL_SERVER_PORT: String(E2E_SERVER_PORT),
    },
  };
}

export function validateReusableServiceResponse(
  serviceName: string,
  response: ServiceProbeResponse
): boolean {
  if (response.status !== 200) return false;

  if (serviceName === 'Server') {
    if (!response.contentType.includes('application/json')) return false;
    try {
      const payload = JSON.parse(response.body) as {
        success?: boolean;
        data?: { version?: unknown; features?: unknown };
      };
      return (
        payload.success === true &&
        typeof payload.data?.version === 'string' &&
        Array.isArray(payload.data.features)
      );
    } catch {
      return false;
    }
  }

  if (serviceName === 'Desktop') {
    return response.body.includes('<title>ZClaudia</title>') && response.body.includes('id="root"');
  }

  return true;
}

export function canAttemptServiceReuse(service: Pick<ServiceConfig, 'healthPath'>): boolean {
  return Boolean(service.healthPath);
}

export function createServicePlan(env: NodeJS.ProcessEnv = process.env): ServiceConfig[] {
  const includeGateway = isGatewayModeRequested(env);
  const skipDesktop = env.E2E_SKIP_DESKTOP === '1';
  const services = [createServerService(includeGateway)];

  if (includeGateway) {
    services.unshift(createGatewayService());
  }

  if (!skipDesktop) {
    services.push(createDesktopService());
  }

  return services;
}

const processes: ChildProcess[] = [];

function runSetupCommand(name: string, args: string[], cwd = ROOT_DIR): void {
  const result = spawnSync(args[0], args.slice(1), {
    cwd,
    env: process.env,
    stdio: 'pipe',
    shell: false,
    encoding: 'utf8',
  });

  if (result.status === 0) return;

  const stderr = result.stderr?.trim();
  const stdout = result.stdout?.trim();
  throw new Error(
    `[Setup] ${name} failed with code ${result.status ?? 'unknown'}` +
      (stderr ? `\n${stderr}` : stdout ? `\n${stdout}` : '')
  );
}

/**
 * Check if a port is already in use (service already running)
 */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise(resolve => {
    // Try localhost (resolves to both IPv4 and IPv6) instead of 127.0.0.1
    const conn = createConnection({ port, host: 'localhost' });
    conn.on('connect', () => {
      conn.destroy();
      resolve(true);
    });
    conn.on('error', () => {
      resolve(false);
    });
  });
}

async function readServiceProbe(service: ServiceConfig): Promise<ServiceProbeResponse | null> {
  if (!service.healthPath) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);

  try {
    const response = await fetch(`http://localhost:${service.port}${service.healthPath}`, {
      signal: controller.signal,
    });
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      body: await response.text(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function isExpectedReusableService(service: ServiceConfig): Promise<boolean> {
  if (!canAttemptServiceReuse(service)) return false;
  const response = await readServiceProbe(service);
  return response ? validateReusableServiceResponse(service.name, response) : false;
}

async function isStartedServiceReady(service: ServiceConfig): Promise<boolean> {
  if (!(await isPortInUse(service.port))) return false;
  if (!service.healthPath) return true;
  return isExpectedReusableService(service);
}

async function waitForServiceReady(service: ServiceConfig): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < service.timeout) {
    if (await isStartedServiceReady(service)) {
      return;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`${service.name} did not become ready within ${service.timeout}ms`);
}

/**
 * Start a service as a child process
 */
function startService(config: ServiceConfig): ChildProcess {
  const [cmd, ...args] = config.command;
  const child = spawn(cmd, args, {
    cwd: config.cwd,
    env: {
      ...process.env,
      ...config.env,
    },
    stdio: 'pipe',
    shell: false,
  });

  child.stdout?.on('data', data => {
    if (process.env.DEBUG) {
      console.log(`[${config.name}] ${data.toString().trim()}`);
    }
  });

  child.stderr?.on('data', data => {
    console.error(`[${config.name}] ${data.toString().trim()}`);
  });

  child.on('error', err => {
    console.error(`[${config.name}] Process error:`, err);
  });

  child.on('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`[${config.name}] exited with code ${code}`);
      return;
    }
    if (signal) {
      console.error(`[${config.name}] exited via signal ${signal}`);
    }
  });

  return child;
}

/**
 * Vitest globalSetup entry point
 */
export async function setup() {
  const includeGateway = isGatewayModeRequested();
  if (includeGateway) {
    requireGatewayWorkspace();
  }

  fs.mkdirSync(E2E_DATA_DIR, { recursive: true });
  process.env.ZCLAUDIA_DATA_DIR = E2E_DATA_DIR;
  process.env.E2E_SERVER_PORT = String(E2E_SERVER_PORT);
  process.env.E2E_DESKTOP_PORT = String(E2E_DESKTOP_PORT);
  process.env.E2E_SERVER_URL = `http://localhost:${E2E_SERVER_PORT}`;
  process.env.E2E_BASE_URL = `http://localhost:${E2E_DESKTOP_PORT}`;
  if (includeGateway) {
    process.env.E2E_GATEWAY_PORT = String(E2E_GATEWAY_PORT);
    process.env.E2E_GATEWAY_URL = `http://localhost:${E2E_GATEWAY_PORT}`;
  } else {
    delete process.env.E2E_GATEWAY_PORT;
    delete process.env.E2E_GATEWAY_URL;
  }

  const buildSteps = getBuildSteps();
  console.log(`[Setup] Building ${buildSteps.map(step => step.name).join(', ')} for E2E...`);
  for (const step of buildSteps) {
    runSetupCommand(step.name, step.command, step.cwd ?? ROOT_DIR);
  }

  const reuseExisting = !process.env.CI;

  for (const service of createServicePlan()) {
    const alreadyRunning = await isPortInUse(service.port);

    if (alreadyRunning && reuseExisting) {
      if (!(await isExpectedReusableService(service))) {
        throw new Error(
          `[Setup] Port ${service.port} is in use, but it cannot be verified as the expected ${service.name} service. Stop that process or choose different E2E ports.`
        );
      }
      console.log(`[Setup] ${service.name} already running on port ${service.port}, reusing`);
      continue;
    }

    if (alreadyRunning && !reuseExisting) {
      console.warn(`[Setup] Port ${service.port} is in use but CI mode requires fresh servers`);
    }

    console.log(`[Setup] Starting ${service.name} on port ${service.port}...`);
    const child = startService(service);
    processes.push(child);

    await waitForServiceReady(service);
    console.log(`[Setup] ${service.name} is ready on port ${service.port}`);
  }
}

/**
 * Vitest globalSetup teardown
 */
export async function teardown() {
  for (const proc of processes) {
    try {
      proc.kill('SIGTERM');
    } catch {
      // Ignore
    }
  }

  // Wait a moment for graceful shutdown
  await new Promise(r => setTimeout(r, 1000));

  // Force kill any remaining
  for (const proc of processes) {
    try {
      if (!proc.killed) {
        proc.kill('SIGKILL');
      }
    } catch {
      // Ignore
    }
  }

  processes.length = 0;
}
