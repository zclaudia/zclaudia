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
}

export interface BashRunResult {
  exitCode: number | null;        // null when killed (timeout/abort) or spawn error
  output: string;                 // truncated (tail) display text
  fullOutput: string;             // complete merged output
  truncated: boolean;
  timedOut: boolean;
  aborted: boolean;
  durationMs: number;
}

const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024;
const STDIO_GRACE_MS = 100;

function resolveShell(): { shell: string; args: string[] } {
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
      resolve({ exitCode: null, output: '', fullOutput: '', truncated: false, timedOut: false, aborted: true, durationMs: 0 });
      return;
    }
    const { shell, args } = resolveShell();
    const child = spawn(shell, [...args, command], {
      cwd,
      env: process.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let full = '';
    let timedOut = false;
    let aborted = false;

    const onData = (chunk: Buffer) => { full += chunk.toString('utf8'); onChunk?.(full); };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    let timer: NodeJS.Timeout | undefined;
    if (timeoutSec > 0) {
      timer = setTimeout(() => { timedOut = true; if (child.pid) killProcessTree(child.pid); }, timeoutSec * 1000);
    }
    const onAbort = () => { aborted = true; if (child.pid) killProcessTree(child.pid); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    const finish = (exitCode: number | null) => {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      const { display, truncated } = truncateTail(full, maxLines, maxBytes);
      resolve({ exitCode, output: display, fullOutput: full, truncated, timedOut, aborted, durationMs: Date.now() - startedAt });
    };

    waitForChild(child).then(finish).catch((err) => {
      full += (full ? '\n' : '') + (err instanceof Error ? err.message : String(err));
      finish(null);
    });
  });
}
