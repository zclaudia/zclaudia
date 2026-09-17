import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import path from 'node:path';
import type {
  ManagedRuntimeAuthProbe,
  ManagedRuntimeAuthState,
  ManagedRuntimeCompatibilityState,
  RuntimeCompatibilityDescriptor,
  RuntimeProbeDescriptor,
} from '@zclaudia/shared/plugins/managed-runtimes';
import { splitEnvList } from './types.js';

const PROCESS_OUTPUT_LIMIT = 1024 * 1024;

export interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: string;
  timedOut: boolean;
}

export interface ExecutableInspection {
  executablePath: string;
  version?: string;
  compatibilityState: ManagedRuntimeCompatibilityState;
  message?: string;
  probe?: ProcessResult;
}

export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
    if (!match) throw new Error(`Invalid runtime version: ${value}`);
    return match.slice(1).map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function compatibilityForVersion(
  version: string | undefined,
  descriptor: RuntimeCompatibilityDescriptor
): { state: ManagedRuntimeCompatibilityState; message?: string } {
  if (!version) return { state: 'unparseable', message: 'CLI version could not be parsed.' };
  const policy = descriptor.versionPolicy;
  if (policy?.knownIncompatible?.includes(version)) {
    return {
      state: 'known-incompatible',
      message: `${version} is marked as known incompatible.`,
    };
  }
  if (policy?.minimum && compareVersions(version, policy.minimum) < 0) {
    return {
      state: 'too-old',
      message: `${version} is older than required minimum ${policy.minimum}.`,
    };
  }
  if (policy?.testedMaximum && compareVersions(version, policy.testedMaximum) > 0) {
    return {
      state: 'untested-newer',
      message: `${version} is newer than tested maximum ${policy.testedMaximum}.`,
    };
  }
  return { state: 'compatible' };
}

export function usableCompatibility(state: ManagedRuntimeCompatibilityState): boolean {
  return state === 'compatible' || state === 'untested-newer';
}

function boundedAppend(current: string, chunk: Buffer | string): string {
  if (current.length >= PROCESS_OUTPUT_LIMIT) return current;
  return `${current}${chunk.toString()}`.slice(0, PROCESS_OUTPUT_LIMIT);
}

async function runProcess(
  executable: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    cwd?: string;
    timeoutMs?: number;
    stdin?: string;
  }
): Promise<ProcessResult> {
  return await new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    // Assigned after spawn so synchronous spawn failures can return without
    // creating a timer; finish() may run from child events immediately after.
    // eslint-disable-next-line prefer-const
    let timer: NodeJS.Timeout | undefined;
    let child: ReturnType<typeof spawn>;
    const finish = (result: Omit<ProcessResult, 'stdout' | 'stderr'>) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ ...result, stdout, stderr });
    };
    try {
      child = spawn(executable, args, {
        cwd: options.cwd,
        env: { ...options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      resolve({
        code: null,
        signal: null,
        stdout,
        stderr,
        error: error instanceof Error ? error.message : String(error),
        timedOut: false,
      });
      return;
    }
    child.stdout?.on('data', chunk => {
      stdout = boundedAppend(stdout, chunk);
    });
    child.stderr?.on('data', chunk => {
      stderr = boundedAppend(stderr, chunk);
    });
    child.once('error', error => {
      finish({
        code: null,
        signal: null,
        error: error.message,
        timedOut: false,
      });
    });
    child.once('close', (code, signal) => {
      finish({ code, signal, timedOut: false });
    });
    if (options.stdin !== undefined) child.stdin?.end(options.stdin);
    else child.stdin?.end();
    timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish({
        code: null,
        signal: 'SIGTERM',
        error: `Process timed out after ${options.timeoutMs ?? 10_000}ms`,
        timedOut: true,
      });
    }, options.timeoutMs ?? 10_000);
    timer.unref?.();
  });
}

async function runCompatibilityProbe(
  executable: string,
  probe: RuntimeProbeDescriptor,
  env: NodeJS.ProcessEnv
): Promise<ProcessResult> {
  if (probe.kind === 'command') {
    return await runProcess(executable, probe.args, {
      env,
      timeoutMs: probe.timeoutMs ?? 10_000,
    });
  }
  // ACP (Agent Client Protocol) initialize: a full handshake with
  // protocolVersion + clientCapabilities, requiring the agent to negotiate
  // protocol version 1 (Cursor ACP design doc §6.2).
  const acpInitializeParams =
    probe.kind === 'acp'
      ? {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: { name: 'zclaudia-managed-runtime', version: '1' },
        }
      : undefined;
  return await new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let remainder = '';
    let settled = false;
    // Assigned after spawn and listener setup so all completion paths share
    // the same cleanup function.
    // eslint-disable-next-line prefer-const
    let timer: NodeJS.Timeout | undefined;
    let child: ReturnType<typeof spawn>;
    const finish = (result: Omit<ProcessResult, 'stdout' | 'stderr'>) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (child && !child.killed) child.kill('SIGTERM');
      resolve({ ...result, stdout, stderr });
    };
    try {
      child = spawn(executable, probe.args, {
        env: { ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      resolve({
        code: null,
        signal: null,
        stdout,
        stderr,
        error: error instanceof Error ? error.message : String(error),
        timedOut: false,
      });
      return;
    }
    child.stdout?.on('data', chunk => {
      stdout = boundedAppend(stdout, chunk);
      remainder = boundedAppend(remainder, chunk);
      const lines = remainder.split(/\r?\n/);
      remainder = lines.pop() ?? '';
      for (const line of lines) {
        try {
          const message = JSON.parse(line) as {
            id?: unknown;
            result?: { protocolVersion?: unknown } | unknown;
            error?: { message?: string };
          };
          if (message.id !== 1) continue;
          if (Object.prototype.hasOwnProperty.call(message, 'result')) {
            if (
              acpInitializeParams &&
              (message.result as { protocolVersion?: unknown })?.protocolVersion !== 1
            ) {
              finish({
                code: 1,
                signal: 'SIGTERM',
                error: `Agent negotiated unsupported ACP protocol version ${
                  (message.result as { protocolVersion?: unknown })?.protocolVersion
                }.`,
                timedOut: false,
              });
              return;
            }
            finish({ code: 0, signal: 'SIGTERM', timedOut: false });
            return;
          }
          if (message.error) {
            finish({
              code: 1,
              signal: 'SIGTERM',
              error: `${
                acpInitializeParams ? 'ACP' : 'JSON-RPC'
              } initialize failed: ${message.error.message ?? 'unknown error'}.`,
              timedOut: false,
            });
            return;
          }
        } catch {
          // Runtime diagnostics may share stdout; ignore non-JSON lines.
        }
      }
    });
    child.stderr?.on('data', chunk => {
      stderr = boundedAppend(stderr, chunk);
    });
    child.once('error', error => {
      finish({
        code: null,
        signal: null,
        error: error.message,
        timedOut: false,
      });
    });
    child.once('close', (code, signal) => {
      finish({
        code,
        signal,
        error: `Process exited before ${
          acpInitializeParams ? 'ACP' : 'JSON-RPC'
        } initialize returned a result.`,
        timedOut: false,
      });
    });
    const request = `${JSON.stringify({
      jsonrpc: acpInitializeParams ? '2.0' : undefined,
      id: 1,
      method: 'initialize',
      params: acpInitializeParams ?? {
        clientInfo: { name: 'zclaudia-managed-runtime', version: '1' },
      },
    })}\n`;
    child.stdin?.write(request, error => {
      if (!error) return;
      finish({
        code: null,
        signal: null,
        error: error.message,
        timedOut: false,
      });
    });
    timer = setTimeout(() => {
      finish({
        code: null,
        signal: 'SIGTERM',
        error: `JSON-RPC initialize timed out after ${probe.timeoutMs ?? 10_000}ms.`,
        timedOut: true,
      });
    }, probe.timeoutMs ?? 10_000);
    timer.unref?.();
  });
}

export function parseVersion(
  output: string,
  descriptor: RuntimeCompatibilityDescriptor
): string | undefined {
  const pattern = descriptor.executable.versionPattern
    ? new RegExp(descriptor.executable.versionPattern, 'm')
    : /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/;
  return pattern.exec(output)?.[1];
}

export async function executableExists(executablePath: string): Promise<boolean> {
  try {
    await access(
      executablePath,
      process.platform === 'win32' ? constants.F_OK : constants.F_OK | constants.X_OK
    );
    return true;
  } catch {
    return false;
  }
}

export function findExecutable(
  command: string,
  pathValue: string | undefined,
  platform: NodeJS.Platform
): string | undefined {
  if (path.isAbsolute(command)) return existsSync(command) ? command : undefined;
  if (!pathValue) return undefined;
  const delimiter = platform === 'win32' ? ';' : ':';
  const extensions =
    platform === 'win32'
      ? splitEnvList((process.env.PATHEXT ?? '.EXE,.CMD,.BAT,.COM').replaceAll(';', ','))
      : [''];
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

export async function inspectExecutable(
  executablePath: string,
  descriptor: RuntimeCompatibilityDescriptor,
  env: NodeJS.ProcessEnv,
  runProbe = true
): Promise<ExecutableInspection> {
  if (!(await executableExists(executablePath))) {
    return { executablePath, compatibilityState: 'missing', message: 'CLI was not found.' };
  }
  const versionResult = await runProcess(executablePath, descriptor.executable.versionArgs, {
    env,
    timeoutMs: 8_000,
  });
  if (versionResult.error || versionResult.code !== 0) {
    return {
      executablePath,
      compatibilityState: 'probe-failed',
      message:
        versionResult.error || `Version command exited with status ${String(versionResult.code)}.`,
    };
  }
  const version = parseVersion(`${versionResult.stdout}\n${versionResult.stderr}`, descriptor);
  const compatibility = compatibilityForVersion(version, descriptor);
  if (!usableCompatibility(compatibility.state) || !runProbe) {
    return {
      executablePath,
      version,
      compatibilityState: compatibility.state,
      message: compatibility.message,
    };
  }
  const probe = await runCompatibilityProbe(executablePath, descriptor.probe, env);
  if (probe.error || probe.code !== 0) {
    return {
      executablePath,
      version,
      compatibilityState: 'probe-failed',
      message: probe.error || `Compatibility probe exited with status ${String(probe.code)}.`,
      probe,
    };
  }
  return {
    executablePath,
    version,
    compatibilityState: compatibility.state,
    message: compatibility.message,
    probe,
  };
}

export async function runAuthProbe(
  executablePath: string,
  probe: ManagedRuntimeAuthProbe | undefined,
  env: NodeJS.ProcessEnv
): Promise<ManagedRuntimeAuthState> {
  if (!probe) return 'unknown';
  const result = await runProcess(executablePath, probe.args, {
    env,
    timeoutMs: probe.timeoutMs ?? 10_000,
  });
  if (result.error && result.code === null) return 'probe-failed';
  const output = `${result.stdout}\n${result.stderr}`;
  if (probe.unauthenticatedPattern && new RegExp(probe.unauthenticatedPattern, 'm').test(output)) {
    return 'auth-required';
  }
  const successCodes = probe.successExitCodes ?? [0];
  if (!successCodes.includes(result.code ?? -1)) return 'auth-required';
  if (probe.authenticatedPattern && !new RegExp(probe.authenticatedPattern, 'm').test(output)) {
    return 'auth-required';
  }
  return 'authenticated';
}
