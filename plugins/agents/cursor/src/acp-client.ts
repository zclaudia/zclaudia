import { spawn } from 'child_process';
import { Writable, Readable } from 'stream';
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Client,
  type SessionUpdate,
  type Stream,
} from '@agentclientprotocol/sdk';
import type { ProviderToolBridgeEntry } from '@zclaudia/plugin-sdk/providers';
import type { AcpPermissionBridge } from './acp-permissions.js';
import {
  CursorAcpError,
  LOGIN_HELP,
  errorCodeFromJsonRpcError,
  sanitizeErrorDetail,
} from './errors.js';
import {
  createCursorExtensionHandlers,
  type CursorAcpExtensionHooks,
} from './cursor-acp-extensions-handler.js';
import { resolveCursorCliFromPath } from './resolve-cli.js';

/**
 * One ACP connection: spawn `<cursor-agent> acp`, run the SDK handshake, and
 * expose typed agent methods (design doc §7.1–§7.2, §12.1).
 *
 * Client capabilities declare only what this adapter implements — no
 * filesystem, no terminal. Cursor keeps using its own tool system. Everything
 * optional is gated on the handshake response, never on CLI version strings
 * (`acp` is absent from `cursor-agent --help`; only the handshake proves it).
 */

export const MAX_STDERR_TAIL_BYTES = 64 * 1024;
const CLOSE_GRACE_MS = 2_000;
const SIGTERM_GRACE_MS = 1_000;
const HANDSHAKE_TIMEOUT_MS = 30_000;

/**
 * Every live `cursor-agent acp` child, so deactivate can converge stragglers
 * even when their owning run was abandoned without draining (§12.2).
 */
const activeAcpProcesses = new Set<ReturnType<typeof spawn>>();

export interface AcpClientConnectOptions {
  cwd: string;
  cliPath?: string;
  env?: Record<string, string>;
  bridge: ProviderToolBridgeEntry | null | undefined;
  permissionBridge: AcpPermissionBridge;
  extensionHooks: CursorAcpExtensionHooks;
  abortSignal: AbortSignal;
}

export interface AcpInitializeResult {
  protocolVersion: number;
  loadSession: boolean;
}

/** Resolved CLI path (§7.1): no shell expansion; callers spawn explicit argv. */
export function resolveAcpCliPath(
  cliPath: string | undefined,
  pathEnv: string | undefined
): string {
  return cliPath || resolveCursorCliFromPath(pathEnv) || 'cursor-agent';
}

export class AcpClient {
  private connection: ClientSideConnection | undefined;
  private proc: ReturnType<typeof spawn> | undefined;
  private stderrTail = '';
  private closeRequested = false;

  initializeResult: AcpInitializeResult | undefined;
  /** Sink for standard `session/update` notifications (set by the runner). */
  onUpdate: ((update: SessionUpdate) => void) | undefined;

  /** Sanitized stderr tail, for error reporting only. */
  stderr(): string {
    return sanitizeErrorDetail(this.stderrTail.slice(-MAX_STDERR_TAIL_BYTES));
  }

  async connect(options: AcpClientConnectOptions): Promise<AcpInitializeResult> {
    const binary = resolveAcpCliPath(options.cliPath, options.env?.PATH ?? process.env.PATH);
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(binary, ['acp'], {
        cwd: options.cwd,
        env: { ...process.env, ...(options.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CursorAcpError(
        'CURSOR_ACP_UNSUPPORTED',
        `Failed to start ${binary} acp: ${message}. Install the Cursor CLI from https://cursor.com/cli.`
      );
    }
    this.proc = proc;
    activeAcpProcesses.add(proc);
    proc.once('close', () => activeAcpProcesses.delete(proc));
    const spawnFailure = new Promise<never>((_, reject) => {
      proc.once('error', (error: NodeJS.ErrnoException) => {
        reject(
          new CursorAcpError(
            error.code === 'ENOENT' ? 'CURSOR_ACP_UNSUPPORTED' : 'CURSOR_PROCESS_EXIT',
            error.code === 'ENOENT'
              ? `cursor-agent not found at ${binary}: ${error.message}. Install the Cursor CLI from https://cursor.com/cli or verify the configured wrapper.`
              : `Failed to start ${binary} acp: ${error.message}`
          )
        );
      });
    });
    proc.stderr?.setEncoding('utf8');
    proc.stderr?.on('data', (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-MAX_STDERR_TAIL_BYTES);
    });
    const exitDuringHandshake = new Promise<never>((_, reject) => {
      proc.once('close', (code, signal) => {
        if (this.closeRequested) return;
        reject(
          new CursorAcpError(
            'CURSOR_PROCESS_EXIT',
            `${binary} acp exited before completing the handshake (${code === null ? `signal ${signal ?? 'unknown'}` : `code ${code}`}).${this.stderrTail.trim() ? ` stderr: ${this.stderrTail.trim().slice(-500)}` : ''}`
          )
        );
      });
    });

    const stream: Stream = ndJsonStream(
      Writable.toWeb(proc.stdin as Writable),
      Readable.toWeb(proc.stdout as Readable) as ReadableStream<Uint8Array>
    );

    const clientImplementation: Client & {
      extMethod: (
        method: string,
        params: Record<string, unknown>
      ) => Promise<Record<string, unknown>>;
      extNotification: (method: string, params: Record<string, unknown>) => Promise<void>;
    } = {
      requestPermission: params =>
        options.permissionBridge.handleRequest(params, options.abortSignal),
      sessionUpdate: params => {
        this.onUpdate?.(params.update);
        return Promise.resolve();
      },
      // Cursor private methods (`cursor/create_plan`, `cursor/ask_question`,
      // and the fire-and-forget notifications) arrive here (design doc §10).
      extMethod: (method, params) =>
        createCursorExtensionHandlers(options.extensionHooks).request(method, params),
      extNotification: (method, params) => {
        createCursorExtensionHandlers(options.extensionHooks).notification(method, params);
        return Promise.resolve();
      },
    };

    const connection = new ClientSideConnection(() => clientImplementation, stream);
    this.connection = connection;

    const handshake = connection
      .initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: { name: 'zclaudia', version: '1' },
      })
      .then(initializeResult => {
        if (typeof initializeResult.protocolVersion !== 'number') {
          throw new CursorAcpError(
            'CURSOR_ACP_HANDSHAKE_FAILED',
            'Agent returned an invalid initialize response.'
          );
        }
        if (initializeResult.protocolVersion !== PROTOCOL_VERSION) {
          throw new CursorAcpError(
            'CURSOR_ACP_UNSUPPORTED',
            `Agent negotiated ACP protocol ${initializeResult.protocolVersion}; this adapter speaks version ${PROTOCOL_VERSION}.`
          );
        }
        return initializeResult;
      })
      .catch(error => {
        if (error instanceof CursorAcpError) throw error;
        throw new CursorAcpError(
          'CURSOR_ACP_HANDSHAKE_FAILED',
          `${binary} acp initialize failed: ${error instanceof Error ? error.message : String(error)}`
        );
      });

    const initializeResult = await raceWithAbortAndTimeout(
      Promise.race([handshake, exitDuringHandshake, spawnFailure]),
      options.abortSignal,
      HANDSHAKE_TIMEOUT_MS,
      new CursorAcpError(
        'CURSOR_ACP_HANDSHAKE_FAILED',
        `Timed out waiting for ${binary} acp initialize response.`
      )
    );

    // Official Cursor flow: authenticate after initialize when the method is
    // advertised. Pre-logged-in users get a fast non-interactive check (§7.2).
    const authMethod = initializeResult.authMethods?.find(method => method.id === 'cursor_login');
    if (authMethod) {
      try {
        await raceWithAbortAndTimeout(
          connection.authenticate({ methodId: authMethod.id }),
          options.abortSignal,
          HANDSHAKE_TIMEOUT_MS,
          new CursorAcpError(
            'CURSOR_ACP_HANDSHAKE_FAILED',
            `Timed out waiting for ${binary} acp authentication response.`
          )
        );
      } catch (error) {
        if (options.abortSignal.aborted || error instanceof CursorAcpError) throw error;
        throw authError(error, binary);
      }
    }

    this.initializeResult = {
      protocolVersion: initializeResult.protocolVersion,
      loadSession: initializeResult.agentCapabilities?.loadSession === true,
    };
    return this.initializeResult;
  }

  get agent(): ClientSideConnection {
    if (!this.connection)
      throw new CursorAcpError(
        'CURSOR_ACP_PROTOCOL_ERROR',
        'ACP connection used before initialize.'
      );
    return this.connection;
  }

  /** Ordered shutdown ladder (§12.1): stdin close → SIGTERM(1s) → SIGKILL. */
  async close(): Promise<void> {
    if (this.closeRequested) return;
    this.closeRequested = true;
    const proc = this.proc;
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;

    let closeSettled = false;
    const closePromise = new Promise<void>(resolve => {
      proc.once('close', () => {
        closeSettled = true;
        resolve();
      });
    });
    proc.stdin?.end();
    await waitFor(closePromise, CLOSE_GRACE_MS);
    if (closeSettled) return;
    proc.kill('SIGTERM');
    await waitFor(closePromise, SIGTERM_GRACE_MS);
    if (closeSettled) return;
    proc.kill('SIGKILL');
    await closePromise;
  }
}

export function authError(error: unknown, binary: string): CursorAcpError {
  const message = error instanceof Error ? error.message : String(error);
  if (/auth|unauthorized|login/i.test(message)) {
    return new CursorAcpError(
      'CURSOR_AUTH_REQUIRED',
      `Cursor CLI is not signed in (${message}). ${LOGIN_HELP}`
    );
  }
  return new CursorAcpError(
    'CURSOR_ACP_HANDSHAKE_FAILED',
    `${binary} acp authentication failed: ${message}`
  );
}

export function jsonRpcErrorToAcpError(method: string, error: unknown): CursorAcpError {
  const shaped = error as { code?: number; message?: string; data?: unknown };
  if (error instanceof CursorAcpError) return error;
  if (typeof shaped?.code === 'number') {
    const code = errorCodeFromJsonRpcError(method, shaped);
    return new CursorAcpError(
      code,
      `${method} failed (${shaped.code}): ${shaped.message ?? 'unknown error'}`
    );
  }
  return new CursorAcpError(
    'CURSOR_ACP_PROTOCOL_ERROR',
    `${method} failed: ${error instanceof Error ? error.message : String(error)}`
  );
}

async function waitFor(promise: Promise<void>, ms: number): Promise<void> {
  await Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]).catch(() => undefined);
}

function raceWithAbortAndTimeout<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
  timeoutError: Error
): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    const finishResolve = (value: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => finishReject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => finishReject(timeoutError), timeoutMs);
    timer.unref?.();
    promise.then(
      value => finishResolve(value),
      error => finishReject(error instanceof Error ? error : new Error(String(error)))
    );
  });
}

/** Terminate every live ACP child process (deactivate path, §12.2). */
export async function destroyAllAcpProcesses(): Promise<void> {
  await Promise.all(
    [...activeAcpProcesses].map(async proc => {
      if (proc.exitCode !== null || proc.signalCode !== null) return;
      proc.kill('SIGTERM');
      const close = new Promise<void>(resolve => proc.once('close', () => resolve()));
      await Promise.race([
        close,
        new Promise<void>(resolve => {
          setTimeout(() => {
            if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
            resolve();
          }, 1_000);
        }),
      ]);
      await close.catch(() => undefined);
    })
  );
  activeAcpProcesses.clear();
}
