import { spawn } from 'child_process';
import { createInterface } from 'readline';

/** stderr is a diagnostic channel, not a result stream — keep only the head. */
const MAX_STDERR_CHARS = 8 * 1024;
/** Grace period between SIGTERM and the SIGKILL escalation. */
const KILL_GRACE_MS = 1_000;

export interface RipgrepResult {
  lines: string[];
  truncated: boolean;
  /** rg exit code: 0 = matches, 1 = no matches, 2 = error. null if killed. */
  exitCode: number | null;
  stderr: string;
  /** true when stderr exceeded the cap and only its head was kept. */
  stderrTruncated: boolean;
}

export interface RipgrepOptions {
  /** Stop collecting after this many output lines (then kill the child). */
  maxLines: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Run a child process, streaming stdout line-by-line so a huge result set
 * never buffers past `maxLines` (avoids the ENOBUFS ceiling of execFile's
 * maxBuffer). stderr is capped at 8KB (head kept). A child that ignores the
 * SIGTERM sent on timeout/abort/line-cap is SIGKILLed after a short grace
 * period so the returned promise always settles.
 */
export function runStreamingProcess(
  command: string,
  args: string[],
  options: RipgrepOptions
): Promise<RipgrepResult> {
  const { maxLines, signal, timeoutMs = 30_000 } = options;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Operation aborted'));
      return;
    }
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const rl = createInterface({ input: child.stdout });
    const lines: string[] = [];
    let truncated = false;
    let stderr = '';
    let stderrTruncated = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;

    const terminate = () => {
      if (killTimer) return; // escalation already scheduled
      child.kill();
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
      killTimer.unref();
    };

    const timer = setTimeout(() => {
      truncated = true;
      terminate();
    }, timeoutMs);
    const onAbort = () => {
      terminate();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
      rl.close();
    };

    rl.on('line', line => {
      if (lines.length >= maxLines) {
        truncated = true;
        terminate();
        return;
      }
      lines.push(line);
    });
    child.stderr?.on('data', chunk => {
      if (stderrTruncated) return;
      stderr += chunk.toString();
      if (stderr.length > MAX_STDERR_CHARS) {
        stderr = stderr.slice(0, MAX_STDERR_CHARS);
        stderrTruncated = true;
      }
    });
    child.on('error', err => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Failed to run ${command}: ${err.message}`));
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      cleanup();
      if (signal?.aborted) {
        reject(new Error('Operation aborted'));
        return;
      }
      resolve({ lines, truncated, exitCode: code, stderr: stderr.trim(), stderrTruncated });
    });
  });
}

export function runRipgrep(args: string[], options: RipgrepOptions): Promise<RipgrepResult> {
  return runStreamingProcess('rg', args, options);
}
