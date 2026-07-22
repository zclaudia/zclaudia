/**
 * Agent Tools — registered to toolRegistry with scope 'agent-assistant'.
 * Injected into agent-mode sessions via MCP bridge.
 *
 * Security: shell and file-ops are restricted to the project working directory.
 */

import * as path from 'path';
import { toolRegistry } from '../../../application/plugins/index.js';
import { MemoryStore } from '../memory/memory-store.js';
import { isBlockedHostname } from './network-guard.js';
import { readResponseBodyWithBudget } from './stream-read.js';
import { scrubEnv } from '../../../infra/providers/pi-runtime/env-scrub.js';
import { wrapCommand } from '../../../infra/providers/pi-runtime/sandbox.js';
import type Database from 'better-sqlite3';
import type { ProcessSupervisor } from '../../../infra/services/process-supervisor.js';

/** Resolve the project working directory for a session */
function resolveProjectCwd(db: Database.Database, sessionId?: string): string | null {
  if (!sessionId) return null;
  const row = db
    .prepare(
      `
    SELECT COALESCE(s.working_directory, p.root_path) as cwd
    FROM sessions s
    LEFT JOIN projects p ON s.project_id = p.id
    WHERE s.id = ?
  `
    )
    .get(sessionId) as { cwd: string | null } | undefined;
  return row?.cwd ?? null;
}

/** Find the nearest existing ancestor path for a given path (lstat: does NOT follow symlinks) */
async function findExistingAncestor(filePath: string): Promise<string> {
  const { lstat } = await import('fs/promises');
  let current = filePath;
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return current; // Reached root
      current = parent;
    }
  }
}

/** Check if a real path stays within the base directory (after symlink resolution) */
async function isRealPathWithinBase(realPath: string, realBase: string): Promise<boolean> {
  return realPath.startsWith(realBase + path.sep) || realPath === realBase;
}

/** Resolve and validate a file path against the project directory.
 *  Also checks the real path (after symlink resolution) to prevent symlink traversal.
 *
 *  P1-14: the final path is lstat'd and rejected outright if it is a symlink
 *  (policy: no symlinks, aligned with memory-provider). The previous
 *  stat-based ancestor check followed symlinks, so a DANGLING symlink inside
 *  the project pointing outside failed stat, fell back to the (inside) parent,
 *  and fs.writeFile then followed the link and wrote the external target. */
async function safePath(filePath: string, baseDir: string): Promise<string | null> {
  const resolved = path.resolve(baseDir, filePath);
  const resolvedBase = path.resolve(baseDir);

  // Basic path containment check
  if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
    return null;
  }

  try {
    const { realpath, lstat } = await import('fs/promises');
    // Reject any symlink at the final path (dangling or not), before any
    // read/write/list operation can follow it.
    const finalEntry = await lstat(resolved).catch(() => null);
    if (finalEntry?.isSymbolicLink()) {
      return null;
    }

    const realBase = await realpath(resolvedBase);
    const existingPath = await findExistingAncestor(resolved);
    const realExistingPath = await realpath(existingPath);

    if (!(await isRealPathWithinBase(realExistingPath, realBase))) {
      return null;
    }
  } catch {
    return null;
  }

  return resolved;
}

const MAX_CONCURRENT_SHELLS = 5;
let activeShells = 0;

// Shell hardening knobs (P1-16). Timeout/kill-grace are env-overridable
// primarily so tests can exercise the SIGTERM→SIGKILL escalation quickly.
const SHELL_DEFAULT_TIMEOUT_MS = 30_000;
const SHELL_DEFAULT_KILL_GRACE_MS = 3_000;
const SHELL_STDOUT_HEAD_CHARS = 8 * 1024;
const SHELL_STDOUT_TAIL_CHARS = 8 * 1024;
const SHELL_STDERR_HEAD_CHARS = 2 * 1024;
const SHELL_STDERR_TAIL_CHARS = 2 * 1024;

function shellTimeoutMs(): number {
  const parsed = Number(process.env.ZCLAUDIA_AGENT_SHELL_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : SHELL_DEFAULT_TIMEOUT_MS;
}

function shellKillGraceMs(): number {
  const parsed = Number(process.env.ZCLAUDIA_AGENT_SHELL_KILL_GRACE_MS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : SHELL_DEFAULT_KILL_GRACE_MS;
}

const sleep = (ms: number): Promise<null> =>
  new Promise(resolve => setTimeout(() => resolve(null), ms));

/**
 * Bounded stdout/stderr accumulator (P1-16): keeps the first `headChars` and
 * last `tailChars` characters (head+tail, consistent with the bash-runner
 * budget) so runaway output never accumulates in memory.
 */
function createStreamCollector(headChars: number, tailChars: number) {
  let head = '';
  let tail = '';
  let totalChars = 0;
  return {
    append(chunk: Buffer | string): void {
      let text = chunk.toString();
      totalChars += text.length;
      if (head.length < headChars) {
        const take = headChars - head.length;
        head += text.slice(0, take);
        text = text.slice(take);
        if (!text) return;
      }
      tail = (tail + text).slice(-tailChars);
    },
    result(): { text: string; truncated: boolean } {
      const keptChars = head.length + tail.length;
      if (totalChars <= keptChars) {
        return { text: head + tail, truncated: false };
      }
      const omitted = totalChars - keptChars;
      return {
        text: `${head}\n... [${omitted} chars omitted] ...\n${tail}`,
        truncated: true,
      };
    },
  };
}

interface ShellExit {
  code: number | null;
  signal: string | null;
}

const SHELL_STDIO_GRACE_MS = 100;

/**
 * Resolve when a stream ends (i.e. the child closed its side of the pipe).
 * Used to avoid losing trailing output when the `exit` event fires before the
 * last stdout/stderr chunks have been delivered (same race bash-runner
 * handles with its STDIO grace).
 */
function streamEnded(stream: NodeJS.ReadableStream): Promise<void> {
  return new Promise(resolve => {
    if ((stream as { readableEnded?: boolean }).readableEnded) {
      resolve();
      return;
    }
    stream.once('end', () => resolve());
  });
}

/**
 * Await process exit with a hard timeout (P1-16): on timeout send SIGTERM,
 * then escalate to SIGKILL after a grace period if the process ignores it.
 * The losing branch of each Promise.race gets a no-op catch so a late
 * rejection can never surface as an unhandled rejection.
 */
async function awaitShellExit(
  exitPromise: Promise<ShellExit>,
  kill: (signal: NodeJS.Signals) => void,
  timeoutMs: number,
  graceMs: number
): Promise<ShellExit & { timedOut: boolean }> {
  exitPromise.catch(() => {
    /* handled via the races below; prevents unhandled rejection on the losing branch */
  });
  const timeoutResult = await Promise.race([exitPromise, sleep(timeoutMs)]);
  if (timeoutResult) {
    return { ...timeoutResult, timedOut: false };
  }
  kill('SIGTERM');
  const graceResult = await Promise.race([exitPromise, sleep(graceMs)]);
  if (graceResult) {
    return { ...graceResult, timedOut: true };
  }
  kill('SIGKILL');
  const finalResult = await Promise.race([exitPromise, sleep(graceMs)]);
  if (finalResult) {
    return { ...finalResult, timedOut: true };
  }
  return { code: null, signal: 'SIGKILL', timedOut: true };
}

export function registerAgentTools(config: {
  getDb: () => Database.Database;
  getProcessSupervisor?: () => ProcessSupervisor;
}): void {
  // ============================================
  // shell — execute shell commands (project-scoped)
  // ============================================
  toolRegistry.register({
    id: 'agent_shell',
    source: 'interaction',
    scope: ['agent-assistant'],
    definition: {
      type: 'function',
      function: {
        name: 'agent_shell',
        description: 'Execute a shell command in the project directory.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to execute' },
          },
          required: ['command'],
        },
      },
    },
    handler: async (args, context) => {
      const db = config.getDb();
      const cwd = resolveProjectCwd(db, context?.sessionId as string | undefined);
      if (!cwd) {
        return JSON.stringify({ error: 'Cannot resolve project directory for this session' });
      }

      if (activeShells >= MAX_CONCURRENT_SHELLS) {
        return JSON.stringify({
          error: `Too many concurrent shell commands (limit: ${MAX_CONCURRENT_SHELLS})`,
        });
      }

      const command = args.command as string;
      const processSupervisor = config.getProcessSupervisor?.();
      activeShells++;
      try {
        // P1-16: route through the shared sandbox wrapper (same one as the
        // pi-runtime Bash tool). When sandboxing is available, the wrapped
        // argv replaces the raw `/bin/sh -c`; otherwise fall back to a
        // secret-scrubbed environment.
        const wrap = await wrapCommand(command, { workspaceRoot: cwd });
        const spawnSpec =
          wrap.sandboxed && wrap.argv && wrap.argv.length > 0
            ? { command: wrap.argv[0], args: wrap.argv.slice(1), env: wrap.env }
            : { command: '/bin/sh', args: ['-c', command], env: scrubEnv(process.env) };

        const stdout = createStreamCollector(SHELL_STDOUT_HEAD_CHARS, SHELL_STDOUT_TAIL_CHARS);
        const stderr = createStreamCollector(SHELL_STDERR_HEAD_CHARS, SHELL_STDERR_TAIL_CHARS);

        let kill: (signal: NodeJS.Signals) => void;
        let exitPromise: Promise<ShellExit>;

        const shellResult = processSupervisor
          ? await processSupervisor.trackCommand({
              command: spawnSpec.command,
              args: spawnSpec.args,
              cwd,
              env: spawnSpec.env as Record<string, string | undefined>,
              owner: {
                sessionId: context?.sessionId as string | undefined,
              },
            })
          : null;

        if (shellResult?.handle.stdout && shellResult.handle.stderr) {
          shellResult.handle.stdout.on('data', (chunk: Buffer | string) => stdout.append(chunk));
          shellResult.handle.stderr.on('data', (chunk: Buffer | string) => stderr.append(chunk));
          kill = signal => shellResult.handle.kill(signal);
          // The supervisor's exitPromise resolves on `exit`, which can fire
          // before the final output chunks arrive; give the streams a short
          // grace to flush before reporting.
          const stdoutDone = streamEnded(shellResult.handle.stdout);
          const stderrDone = streamEnded(shellResult.handle.stderr);
          exitPromise = shellResult.handle.exitPromise.then(async exit => {
            await Promise.race([
              Promise.all([stdoutDone, stderrDone]),
              sleep(SHELL_STDIO_GRACE_MS),
            ]);
            return exit;
          });
        } else {
          const { spawn } = await import('child_process');
          const child = spawn(spawnSpec.command, spawnSpec.args, {
            cwd,
            env: spawnSpec.env,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          child.stdout?.on('data', (chunk: Buffer) => stdout.append(chunk));
          child.stderr?.on('data', (chunk: Buffer) => stderr.append(chunk));
          kill = signal => {
            try {
              child.kill(signal);
            } catch {
              /* already exited */
            }
          };
          exitPromise = new Promise<ShellExit>(resolve => {
            child.once('error', () => resolve({ code: null, signal: null }));
            // `close` fires after stdio streams are closed, so trailing output
            // is already flushed into the collectors.
            child.once('close', (code, signal) => resolve({ code, signal }));
          });
        }

        const outcome = await awaitShellExit(
          exitPromise,
          kill,
          shellTimeoutMs(),
          shellKillGraceMs()
        );
        const stdoutResult = stdout.result();
        const stderrResult = stderr.result();
        const exitCode = outcome.timedOut ? 124 : (outcome.code ?? 1);
        return JSON.stringify({
          stdout: stdoutResult.text,
          stderr:
            stderrResult.text || (exitCode !== 0 ? 'Command exited with non-zero status' : ''),
          exitCode,
          ...(outcome.timedOut && { timedOut: true }),
          ...((stdoutResult.truncated || stderrResult.truncated) && { truncated: true }),
        });
      } catch (err: unknown) {
        const execErr = err as {
          stdout?: string;
          stderr?: string;
          message?: string;
          code?: number;
        };
        return JSON.stringify({
          stdout: (execErr.stdout || '').slice(0, 4000),
          stderr: (execErr.stderr || execErr.message || '').slice(0, 1000),
          exitCode: execErr.code ?? 1,
        });
      } finally {
        activeShells--;
      }
    },
  });

  // ============================================
  // file_ops — read/write/list files (project-scoped)
  // ============================================
  toolRegistry.register({
    id: 'agent_file_ops',
    source: 'interaction',
    scope: ['agent-assistant'],
    definition: {
      type: 'function',
      function: {
        name: 'agent_file_ops',
        description: 'Read, write, or list files. Paths are relative to the project directory.',
        parameters: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['read', 'write', 'list'],
              description: 'File operation type',
            },
            path: {
              type: 'string',
              description: 'File or directory path (relative to project root)',
            },
            content: { type: 'string', description: 'Content to write (for write operation)' },
          },
          required: ['operation', 'path'],
        },
      },
    },
    handler: async (args, context) => {
      const db = config.getDb();
      const projectCwd = resolveProjectCwd(db, context?.sessionId as string | undefined);
      if (!projectCwd) {
        return JSON.stringify({ error: 'Cannot resolve project directory for this session' });
      }

      const filePath = await safePath(args.path as string, projectCwd);
      if (!filePath) {
        return JSON.stringify({ error: 'Path is outside the project directory' });
      }

      const fs = await import('fs/promises');
      try {
        switch (args.operation) {
          case 'read': {
            // P1-16: cap reads — never stringify an unbounded file into the
            // result. Read at most MAX_READ_BYTES + 1 and report truncation.
            const MAX_READ_BYTES = 64 * 1024;
            const fileStat = await fs.stat(filePath);
            const handle = await fs.open(filePath, 'r');
            try {
              const buffer = Buffer.alloc(MAX_READ_BYTES + 1);
              const { bytesRead } = await handle.read(buffer, 0, MAX_READ_BYTES + 1, 0);
              const truncated = fileStat.size > MAX_READ_BYTES;
              const content = buffer
                .subarray(0, Math.min(bytesRead, MAX_READ_BYTES))
                .toString('utf-8');
              return JSON.stringify({
                content,
                path: path.relative(projectCwd, filePath),
                ...(truncated && {
                  truncated: true,
                  totalBytes: fileStat.size,
                  message: `Content truncated to ${MAX_READ_BYTES} of ${fileStat.size} bytes`,
                }),
              });
            } finally {
              await handle.close();
            }
          }
          case 'write': {
            // P1-16: reject unbounded write payloads.
            const MAX_WRITE_BYTES = 1024 * 1024;
            const content = args.content as string | undefined;
            if (typeof content !== 'string') {
              return JSON.stringify({ error: 'content is required for write' });
            }
            const sizeBytes = Buffer.byteLength(content, 'utf8');
            if (sizeBytes > MAX_WRITE_BYTES) {
              return JSON.stringify({
                error: `Content exceeds the ${MAX_WRITE_BYTES}-byte write limit (${sizeBytes} bytes)`,
              });
            }
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, content, 'utf-8');
            return JSON.stringify({ success: true, path: path.relative(projectCwd, filePath) });
          }
          case 'list': {
            const entries = await fs.readdir(filePath, { withFileTypes: true });
            return JSON.stringify(
              entries.map(e => ({
                name: e.name,
                type: e.isDirectory() ? 'directory' : 'file',
              }))
            );
          }
          default:
            return JSON.stringify({ error: `Unknown operation: ${args.operation}` });
        }
      } catch (err: unknown) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  });

  // ============================================
  // http_request — make HTTP calls (block private IPs)
  // ============================================
  toolRegistry.register({
    id: 'agent_http_request',
    source: 'interaction',
    scope: ['agent-assistant'],
    definition: {
      type: 'function',
      function: {
        name: 'agent_http_request',
        description:
          'Make an HTTP request to an external URL. Internal/private network addresses are blocked.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Request URL (must be external)' },
            method: {
              type: 'string',
              enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
              description: 'HTTP method (default: GET)',
            },
            headers: { type: 'object', description: 'Request headers' },
            body: { type: 'string', description: 'Request body (for POST/PUT/PATCH)' },
          },
          required: ['url'],
        },
      },
    },
    handler: async args => {
      const urlStr = args.url as string;
      const MAX_RESPONSE_BYTES = 16 * 1024; // 16 KB
      // P1-16: overall request timeout (previously the AbortController only
      // tripped on the byte cap, so a stalled server hung the tool forever).
      // Env-overridable so tests can exercise the timeout quickly.
      const parsedTimeout = Number(process.env.ZCLAUDIA_AGENT_HTTP_TIMEOUT_MS);
      const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 30_000;
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const parsed = new URL(urlStr);
        if (await isBlockedHostname(parsed.hostname)) {
          return JSON.stringify({ error: 'Requests to private/internal addresses are blocked' });
        }

        const response = await fetch(urlStr, {
          method: (args.method as string) || 'GET',
          headers: (args.headers as Record<string, string>) || {},
          body: args.body as string | undefined,
          redirect: 'error',
          signal: controller.signal,
        });

        // Stream-read up to MAX_RESPONSE_BYTES to avoid OOM on large responses
        const { text: bodyText, truncated } = await readResponseBodyWithBudget(
          response,
          MAX_RESPONSE_BYTES,
          () => controller.abort()
        );

        return JSON.stringify({
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: bodyText.slice(0, 8000),
          truncated,
        });
      } catch (err: unknown) {
        if (timedOut) {
          return JSON.stringify({ error: `Request timed out after ${timeoutMs}ms` });
        }
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      } finally {
        clearTimeout(timeout);
      }
    },
  });

  // ============================================
  // memory — persistent key-value store (project-scoped)
  // ============================================
  toolRegistry.register({
    id: 'agent_memory',
    source: 'interaction',
    scope: ['agent-assistant'],
    definition: {
      type: 'function',
      function: {
        name: 'agent_memory',
        description:
          'Read and write persistent memories that survive across sessions. Use to remember user preferences, project knowledge, and insights.',
        parameters: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['get', 'set', 'list', 'delete'],
              description: 'Memory operation',
            },
            namespace: {
              type: 'string',
              description:
                'Memory category (e.g., "preference", "habit", "insight"). Default: "default"',
            },
            key: { type: 'string', description: 'Memory key (required for get/set/delete)' },
            value: { type: 'string', description: 'Memory value (required for set)' },
          },
          required: ['operation'],
        },
      },
    },
    handler: async (args, context) => {
      const db = config.getDb();
      const store = new MemoryStore(db);
      const sessionId = context?.sessionId as string | undefined;
      const projectId = sessionId
        ? ((
            db.prepare('SELECT project_id FROM sessions WHERE id = ?').get(sessionId) as
              | { project_id: string }
              | undefined
          )?.project_id ?? null)
        : null;
      const namespace = (args.namespace as string) || 'default';

      switch (args.operation) {
        case 'get':
          if (!args.key) return JSON.stringify({ error: 'key is required for get' });
          return (
            store.get(projectId, namespace, args.key as string) ?? JSON.stringify({ found: false })
          );
        case 'set':
          if (!args.key || !args.value)
            return JSON.stringify({ error: 'key and value are required for set' });
          store.set(projectId, namespace, args.key as string, args.value as string);
          return JSON.stringify({ success: true, key: args.key, namespace });
        case 'list':
          return JSON.stringify(store.list(projectId, namespace));
        case 'delete':
          if (!args.key) return JSON.stringify({ error: 'key is required for delete' });
          return JSON.stringify({
            deleted: store.delete(projectId, namespace, args.key as string),
          });
        default:
          return JSON.stringify({ error: `Unknown operation: ${args.operation}` });
      }
    },
  });
}
