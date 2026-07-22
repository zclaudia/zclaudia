import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'fs';
import * as os from 'os';
import * as path from 'path';

import { scrubEnv } from './env-scrub.js';

export interface BashRunOptions {
  command: string;
  cwd: string;
  timeoutSec: number; // 0 disables the timeout
  signal?: AbortSignal;
  onChunk?: (accumulatedText: string) => void; // called per output chunk; tool layer throttles
  maxLines?: number; // default 2000
  maxBytes?: number; // default 50*1024
  /** When set, spawn this sandbox-wrapped argv directly (shell:false) instead of `shell -c command`. */
  sandbox?: { argv: string[]; env: NodeJS.ProcessEnv };
  /** Write this to the child's stdin then close it. Default: stdin ignored. */
  stdin?: string;
  /** Extra env vars merged over the scrubbed process.env (non-sandbox path only); explicit, so it always wins over scrubbing. */
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
  /**
   * Remove the runner's 'data' listeners so the adopter can attach its own.
   * waitForChild is already disarmed at handoff time; detach() completes the
   * ownership transfer and leaves every stream untouched for the adopter.
   */
  detach(): void;
}

export interface BashRunResult {
  exitCode: number | null; // null when killed (timeout/abort) or spawn error
  output: string; // truncated (tail) display text
  // In-memory merged output. Complete when small; once it exceeds maxBytes it is
  // tail-capped (same as `output`) and the complete content lives at fullOutputPath.
  fullOutput: string;
  truncated: boolean;
  timedOut: boolean;
  aborted: boolean;
  durationMs: number;
  /** stderr captured separately (merged output unchanged), capped at 64KB. */
  stderrOutput: string;
  /** Secure path containing full output when in-memory output was capped. */
  fullOutputPath?: string;
  /**
   * True when the spill file hit BASH_SPILL_MAX_BYTES: the file holds the head
   * plus a drop marker, while `fullOutput`/`output` still track the live tail.
   */
  fullOutputCapped?: boolean;
  /** Present when the run was handed off at autoBackgroundMs; the child is still alive. */
  handoff?: BashHandoff;
}

const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024;
const STDIO_GRACE_MS = 100;
const STDERR_CAPTURE_LIMIT = 64 * 1024;

/**
 * Hard cap on a single command's spill file. Past the cap, subsequent output
 * is dropped from the file (a marker is appended once) while the in-memory
 * tail keeps tracking the end of the stream — preserving the head-on-disk +
 * tail-in-memory shape the tool result already exposes. Without a cap, a
 * `yes`-class command would append unboundedly for up to the 600s timeout.
 */
export const BASH_SPILL_MAX_BYTES = 64 * 1024 * 1024;
const SPILL_CAP_MARKER = `\n[zclaudia: output exceeded the ${
  BASH_SPILL_MAX_BYTES / (1024 * 1024)
}MB spill cap; output after this point was dropped from this file. The result tail still reflects the command's final output.]\n`;

function resolveDataDir(): string {
  return process.env.ZCLAUDIA_DATA_DIR
    ? path.resolve(process.env.ZCLAUDIA_DATA_DIR)
    : path.join(os.homedir(), '.zclaudia');
}

// Spilled bash logs are kept only long enough for the model to Read them back
// within the session; without a sweep they accumulate forever (one file per
// command whose output exceeds maxBytes). 24h TTL, swept opportunistically on
// each new write — no background timer.
const BASH_LOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function sweepStaleBashLogs(dir: string, maxAgeMs: number): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - maxAgeMs;
  for (const name of entries) {
    if (!name.endsWith('.log')) continue;
    const filePath = path.join(dir, name);
    try {
      if (statSync(filePath).mtimeMs < cutoff) unlinkSync(filePath);
    } catch {
      // file vanished or is locked — ignore, this is best-effort
    }
  }
}

export function persistBashFullOutput(content: string): string {
  const dir = path.join(resolveDataDir(), 'bash-logs');
  mkdirSync(dir, { recursive: true });
  sweepStaleBashLogs(dir, BASH_LOG_MAX_AGE_MS);
  const filePath = path.join(dir, `${randomUUID()}.log`);
  writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 });
  return filePath;
}

export function resolveShell(): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    const candidates = [
      process.env.ProgramFiles ? `${process.env.ProgramFiles}\\Git\\bin\\bash.exe` : undefined,
      process.env['ProgramFiles(x86)']
        ? `${process.env['ProgramFiles(x86)']}\\Git\\bin\\bash.exe`
        : undefined,
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
      spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
      });
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

/**
 * Resolve when the child has exited, without hanging on stdio pipes a detached
 * descendant keeps open. Resolve on `exit`; give stdout/stderr a short grace to
 * `end`, then force-finalize (destroy the streams). Resolve on `close` if first.
 *
 * `disarm()` fully transfers stdio ownership to an adopter (handoff): every
 * listener is removed and finalize becomes a no-op, so the exit+grace destroy
 * can never tear down stdout/stderr while the adopter is still draining them.
 */
interface ChildWaitHandle {
  promise: Promise<number | null>;
  disarm(): void;
}

function waitForChild(child: ChildProcess): ChildWaitHandle {
  let settled = false;
  let exited = false;
  let exitCode: number | null = null;
  let timer: NodeJS.Timeout | undefined;
  let stdoutEnded = child.stdout === null;
  let stderrEnded = child.stderr === null;

  // Assigned synchronously by the promise executor below.
  let resolvePromise: (code: number | null) => void = () => {};
  let rejectPromise: (err: unknown) => void = () => {};

  const finalize = (code: number | null) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    child.stdout?.destroy();
    child.stderr?.destroy();
    resolvePromise(code);
  };
  const maybeFinalize = () => {
    if (exited && !settled && stdoutEnded && stderrEnded) finalize(exitCode);
  };
  const onStdoutEnd = () => {
    stdoutEnded = true;
    maybeFinalize();
  };
  const onStderrEnd = () => {
    stderrEnded = true;
    maybeFinalize();
  };
  const onExit = (code: number | null) => {
    exited = true;
    exitCode = code;
    maybeFinalize();
    if (!settled) timer = setTimeout(() => finalize(code), STDIO_GRACE_MS);
  };
  const onClose = (code: number | null) => finalize(code);
  const onError = (err: Error) => {
    if (!settled) {
      settled = true;
      rejectPromise(err);
    }
  };

  child.stdout?.on('end', onStdoutEnd);
  child.stderr?.on('end', onStderrEnd);
  child.on('exit', onExit);
  child.on('close', onClose);
  child.on('error', onError);

  const promise = new Promise<number | null>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const disarm = () => {
    if (settled) return;
    settled = true; // neuters every pending callback (grace timer, end/close)
    if (timer) clearTimeout(timer);
    child.stdout?.off('end', onStdoutEnd);
    child.stderr?.off('end', onStderrEnd);
    child.off('exit', onExit);
    child.off('close', onClose);
    child.off('error', onError);
    // Keep an inert error listener so a post-handoff child 'error' can never
    // crash the process in the gap before the adopter attaches its own.
    child.on('error', () => {});
  };
  return { promise, disarm };
}

/** Keep the last `maxLines` lines, then cap to the last `maxBytes` bytes. Trailing-newline aware. */
function truncateTail(
  full: string,
  maxLines: number,
  maxBytes: number
): { display: string; truncated: boolean } {
  let truncated = false;
  const hadTrailingNewline = full.endsWith('\n');
  const body = hadTrailingNewline ? full.slice(0, -1) : full;
  let lines = body.length === 0 ? [] : body.split('\n');
  if (lines.length > maxLines) {
    lines = lines.slice(-maxLines);
    truncated = true;
  }
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

  return new Promise(resolve => {
    if (signal?.aborted) {
      resolve({
        exitCode: null,
        output: '',
        fullOutput: '',
        truncated: false,
        timedOut: false,
        aborted: true,
        durationMs: 0,
        stderrOutput: '',
      });
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
        env: scrubEnv(process.env, opts.extraEnv),
        detached: process.platform !== 'win32',
        stdio: [stdinMode, 'pipe', 'pipe'],
        windowsHide: true,
      });
    }

    if (opts.stdin !== undefined && child.stdin) {
      child.stdin.on('error', () => {
        /* EPIPE when child exits early — harmless */
      });
      child.stdin.write(opts.stdin);
      child.stdin.end();
    }

    let full = '';
    let fullOutputPath: string | undefined;
    const stderrChunks: string[] = [];
    let stderrBytes = 0;
    let timedOut = false;
    let aborted = false;

    // Spill state: once in-memory output exceeds maxBytes the complete content
    // lives in the spill file and `full` becomes the tail. The fd is held open
    // across chunks (writeSync per chunk instead of appendFileSync's
    // open+write+close) and closed at finish/handoff; growth is hard-capped at
    // BASH_SPILL_MAX_BYTES with a drop marker (see SPILL_CAP_MARKER).
    let spillFd: number | undefined;
    let spillBytes = 0;
    let spillCapped = false;

    const writeSpill = (text: string): void => {
      if (!fullOutputPath) return;
      try {
        if (spillFd === undefined) spillFd = openSync(fullOutputPath, 'a');
        const buf = Buffer.from(text, 'utf8');
        writeSync(spillFd, buf, 0, buf.length);
        spillBytes += buf.length;
      } catch {
        // Best-effort persistence: keep collecting the in-memory tail even if
        // the disk write fails (previously this throw escaped the data handler).
      }
    };
    const closeSpill = (): void => {
      if (spillFd === undefined) return;
      try {
        closeSync(spillFd);
      } catch {
        /* already closed */
      }
      spillFd = undefined;
    };

    const appendOutput = (text: string) => {
      if (fullOutputPath) {
        if (!spillCapped) {
          if (spillBytes + Buffer.byteLength(text, 'utf8') > BASH_SPILL_MAX_BYTES) {
            spillCapped = true;
            writeSpill(SPILL_CAP_MARKER);
          } else {
            writeSpill(text);
          }
        }
      } else if (Buffer.byteLength(full + text, 'utf8') > maxBytes) {
        fullOutputPath = persistBashFullOutput(full + text);
        spillBytes = Buffer.byteLength(full + text, 'utf8');
      }
      full += text;
      if (fullOutputPath) {
        full = truncateTail(full, maxLines, maxBytes).display;
      }
      onChunk?.(full);
    };
    const onData = (chunk: Buffer) => {
      appendOutput(chunk.toString('utf8'));
    };
    const onStderrData = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (stderrBytes < STDERR_CAPTURE_LIMIT) {
        stderrChunks.push(text);
        stderrBytes += Buffer.byteLength(text, 'utf8');
      }
      appendOutput(text);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onStderrData);

    let timer: NodeJS.Timeout | undefined;
    if (timeoutSec > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        if (child.pid) killProcessTree(child.pid);
      }, timeoutSec * 1000);
    }
    const onAbort = () => {
      aborted = true;
      if (child.pid) killProcessTree(child.pid);
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    let handedOff = false;
    let finished = false;
    let handoffTimer: NodeJS.Timeout | undefined;
    const childWait = waitForChild(child);
    const performHandoff = () => {
      if (handedOff || finished) return;
      handedOff = true;
      // Disarm the kill timeout and abort listener: the child now belongs to
      // the adopter (background task) and must not die with this call.
      if (timer) clearTimeout(timer);
      if (handoffTimer) clearTimeout(handoffTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
      opts.backgroundSignal?.removeEventListener('abort', performHandoff);
      // Full stdio ownership transfers to the adopter: disarm waitForChild so
      // its exit+grace finalize can never destroy stdout/stderr out from under
      // the adopter while it is still draining the pipes (P1-4).
      childWait.disarm();
      // The spill file is sealed here — never written again after handoff —
      // which is what allows the adopter to rename it instead of copying.
      closeSpill();
      const { display, truncated } = truncateTail(full, maxLines, maxBytes);
      resolve({
        exitCode: null,
        output: display,
        fullOutput: full,
        truncated: truncated || Boolean(fullOutputPath),
        timedOut: false,
        aborted: false,
        durationMs: Date.now() - startedAt,
        stderrOutput: stderrChunks.join(''),
        ...(fullOutputPath ? { fullOutputPath } : {}),
        ...(spillCapped ? { fullOutputCapped: true } : {}),
        handoff: {
          child,
          detach: () => {
            child.stdout?.off('data', onData);
            child.stderr?.off('data', onStderrData);
            // Removing the last 'data' listener does NOT pause a flowing
            // stream — it keeps reading and silently discards output until
            // the adopter attaches. Pause explicitly so every byte survives
            // the ownership transfer (P1-4).
            child.stdout?.pause();
            child.stderr?.pause();
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
      closeSpill();
      const { display, truncated } = truncateTail(full, maxLines, maxBytes);
      resolve({
        exitCode,
        output: display,
        fullOutput: full,
        truncated: truncated || Boolean(fullOutputPath),
        timedOut,
        aborted,
        durationMs: Date.now() - startedAt,
        stderrOutput: stderrChunks.join(''),
        ...(fullOutputPath ? { fullOutputPath } : {}),
        ...(spillCapped ? { fullOutputCapped: true } : {}),
      });
    };

    childWait.promise.then(finish).catch(err => {
      full += (full ? '\n' : '') + (err instanceof Error ? err.message : String(err));
      finish(null);
    });
  });
}
