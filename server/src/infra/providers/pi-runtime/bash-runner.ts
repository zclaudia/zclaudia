import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';

export interface BashRunOptions {
  command: string;
  cwd: string;
  timeoutSec: number;             // 0 disables the timeout
  signal?: AbortSignal;
  onChunk?: (accumulatedText: string) => void;  // called per output chunk; tool layer throttles
  maxLines?: number;              // default 2000
  maxBytes?: number;              // default 50*1024
  /** When set, spawn this sandbox-wrapped argv directly (shell:false) instead of `shell -c command`. */
  sandbox?: { argv: string[]; env: NodeJS.ProcessEnv };
  /** Write this to the child's stdin then close it. Default: stdin ignored. */
  stdin?: string;
  /** Extra env vars merged over process.env (non-sandbox path only). */
  extraEnv?: Record<string, string>;
  /**
   * When set and the command is still running after this many ms, resolve early
   * with a `handoff` instead of waiting: the kill timeout and abort listener are
   * disarmed and the caller takes over the live child (auto-background).
   */
  autoBackgroundMs?: number;
  /** Fires the same handoff on demand (user-requested "send to background"). */
  backgroundSignal?: AbortSignal;
}

export interface BashHandoff {
  child: ChildProcess;
  /** Remove the runner's stdio listeners so the adopter can attach its own. */
  detach(): void;
}

export interface BashRunResult {
  exitCode: number | null;        // null when killed (timeout/abort) or spawn error
  output: string;                 // truncated (tail) display text
  fullOutput: string;             // complete merged output
  truncated: boolean;
  timedOut: boolean;
  aborted: boolean;
  durationMs: number;
  /** stderr captured separately (merged output unchanged), capped at 64KB. */
  stderrOutput: string;
  /** Present when the run was handed off at autoBackgroundMs; the child is still alive. */
  handoff?: BashHandoff;
}

const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024;
const STDIO_GRACE_MS = 100;
const STDERR_CAPTURE_LIMIT = 64 * 1024;

export function resolveShell(): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    const candidates = [
      process.env.ProgramFiles ? `${process.env.ProgramFiles}\\Git\\bin\\bash.exe` : undefined,
      process.env['ProgramFiles(x86)'] ? `${process.env['ProgramFiles(x86)']}\\Git\\bin\\bash.exe` : undefined,
    ].filter((p): p is string => typeof p === 'string');
    for (const p of candidates) if (existsSync(p)) return { shell: p, args: ['-c'] };
    return { shell: 'bash', args: ['-c'] };
  }
  if (existsSync('/bin/bash')) return { shell: '/bin/bash', args: ['-c'] };
  return { shell: 'sh', args: ['-c'] };
}

/** Kill the child's whole process tree. Unix: process-group SIGKILL (needs detached spawn). */
export function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', detached: true, windowsHide: true });
    } catch { /* ignore */ }
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

/**
 * Resolve when the child has exited, without hanging on stdio pipes a detached
 * descendant keeps open. Resolve on `exit`; give stdout/stderr a short grace to
 * `end`, then force-finalize (destroy the streams). Resolve on `close` if first.
 */
function waitForChild(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let exited = false;
    let exitCode: number | null = null;
    let timer: NodeJS.Timeout | undefined;
    let stdoutEnded = child.stdout === null;
    let stderrEnded = child.stderr === null;

    const finalize = (code: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(code);
    };
    const maybeFinalize = () => {
      if (exited && !settled && stdoutEnded && stderrEnded) finalize(exitCode);
    };
    child.stdout?.on('end', () => { stdoutEnded = true; maybeFinalize(); });
    child.stderr?.on('end', () => { stderrEnded = true; maybeFinalize(); });
    child.on('exit', (code) => {
      exited = true;
      exitCode = code;
      maybeFinalize();
      if (!settled) timer = setTimeout(() => finalize(code), STDIO_GRACE_MS);
    });
    child.on('close', (code) => finalize(code));
    child.on('error', (err) => { if (!settled) { settled = true; reject(err); } });
  });
}

/** Keep the last `maxLines` lines, then cap to the last `maxBytes` bytes. Trailing-newline aware. */
function truncateTail(full: string, maxLines: number, maxBytes: number): { display: string; truncated: boolean } {
  let truncated = false;
  const hadTrailingNewline = full.endsWith('\n');
  const body = hadTrailingNewline ? full.slice(0, -1) : full;
  let lines = body.length === 0 ? [] : body.split('\n');
  if (lines.length > maxLines) { lines = lines.slice(-maxLines); truncated = true; }
  let display = lines.join('\n');
  if (hadTrailingNewline && display.length) display += '\n';
  if (Buffer.byteLength(display, 'utf8') > maxBytes) {
    const buf = Buffer.from(display, 'utf8');
    display = buf.subarray(buf.length - maxBytes).toString('utf8');
    truncated = true;
  }
  return { display, truncated };
}

export function runBash(opts: BashRunOptions): Promise<BashRunResult> {
  const { command, cwd, timeoutSec, signal, onChunk } = opts;
  const maxLines = opts.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const startedAt = Date.now();

  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ exitCode: null, output: '', fullOutput: '', truncated: false, timedOut: false, aborted: true, durationMs: 0, stderrOutput: '' });
      return;
    }
    const stdinMode = opts.stdin !== undefined ? 'pipe' : 'ignore';
    let child;
    if (opts.sandbox) {
      child = spawn(opts.sandbox.argv[0], opts.sandbox.argv.slice(1), {
        cwd,
        env: opts.sandbox.env,
        detached: process.platform !== 'win32',
        stdio: [stdinMode, 'pipe', 'pipe'],
        windowsHide: true,
      });
    } else {
      const { shell, args } = resolveShell();
      child = spawn(shell, [...args, command], {
        cwd,
        env: opts.extraEnv ? { ...process.env, ...opts.extraEnv } : process.env,
        detached: process.platform !== 'win32',
        stdio: [stdinMode, 'pipe', 'pipe'],
        windowsHide: true,
      });
    }

    if (opts.stdin !== undefined && child.stdin) {
      child.stdin.on('error', () => { /* EPIPE when child exits early — harmless */ });
      child.stdin.write(opts.stdin);
      child.stdin.end();
    }

    let full = '';
    const stderrChunks: string[] = [];
    let stderrBytes = 0;
    let timedOut = false;
    let aborted = false;

    const onData = (chunk: Buffer) => { full += chunk.toString('utf8'); onChunk?.(full); };
    const onStderrData = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (stderrBytes < STDERR_CAPTURE_LIMIT) {
        stderrChunks.push(text);
        stderrBytes += Buffer.byteLength(text, 'utf8');
      }
      full += text;
      onChunk?.(full);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onStderrData);

    let timer: NodeJS.Timeout | undefined;
    if (timeoutSec > 0) {
      timer = setTimeout(() => { timedOut = true; if (child.pid) killProcessTree(child.pid); }, timeoutSec * 1000);
    }
    const onAbort = () => { aborted = true; if (child.pid) killProcessTree(child.pid); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    let handedOff = false;
    let finished = false;
    let handoffTimer: NodeJS.Timeout | undefined;
    const performHandoff = () => {
      if (handedOff || finished) return;
      handedOff = true;
      // Disarm the kill timeout and abort listener: the child now belongs to
      // the adopter (background task) and must not die with this call.
      if (timer) clearTimeout(timer);
      if (handoffTimer) clearTimeout(handoffTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
      opts.backgroundSignal?.removeEventListener('abort', performHandoff);
      const { display, truncated } = truncateTail(full, maxLines, maxBytes);
      resolve({
        exitCode: null, output: display, fullOutput: full, truncated,
        timedOut: false, aborted: false, durationMs: Date.now() - startedAt,
        stderrOutput: stderrChunks.join(''),
        handoff: {
          child,
          detach: () => {
            child.stdout?.off('data', onData);
            child.stderr?.off('data', onStderrData);
          },
        },
      });
    };
    if (opts.autoBackgroundMs && opts.autoBackgroundMs > 0) {
      handoffTimer = setTimeout(performHandoff, opts.autoBackgroundMs);
    }
    opts.backgroundSignal?.addEventListener('abort', performHandoff, { once: true });

    const finish = (exitCode: number | null) => {
      if (timer) clearTimeout(timer);
      if (handoffTimer) clearTimeout(handoffTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
      opts.backgroundSignal?.removeEventListener('abort', performHandoff);
      if (handedOff) return; // already resolved with a handoff; adopter owns the child
      finished = true;
      const { display, truncated } = truncateTail(full, maxLines, maxBytes);
      resolve({ exitCode, output: display, fullOutput: full, truncated, timedOut, aborted, durationMs: Date.now() - startedAt, stderrOutput: stderrChunks.join('') });
    };

    waitForChild(child).then(finish).catch((err) => {
      full += (full ? '\n' : '') + (err instanceof Error ? err.message : String(err));
      finish(null);
    });
  });
}
