import { spawn } from 'child_process';
import { createInterface } from 'readline';

export interface RipgrepResult {
  lines: string[];
  truncated: boolean;
  /** rg exit code: 0 = matches, 1 = no matches, 2 = error. null if killed. */
  exitCode: number | null;
  stderr: string;
}

export interface RipgrepOptions {
  /** Stop collecting after this many output lines (then kill rg). */
  maxLines: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Run ripgrep, streaming stdout line-by-line so a huge result set never
 * buffers past `maxLines` (avoids the ENOBUFS ceiling of execFile's maxBuffer).
 */
export function runRipgrep(args: string[], options: RipgrepOptions): Promise<RipgrepResult> {
  const { maxLines, signal, timeoutMs = 30_000 } = options;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Operation aborted'));
      return;
    }
    const child = spawn('rg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const rl = createInterface({ input: child.stdout });
    const lines: string[] = [];
    let truncated = false;
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      truncated = true;
      child.kill();
    }, timeoutMs);
    const onAbort = () => {
      child.kill();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      rl.close();
    };

    rl.on('line', line => {
      if (lines.length >= maxLines) {
        truncated = true;
        child.kill();
        return;
      }
      lines.push(line);
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', err => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Failed to run rg: ${err.message}`));
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      cleanup();
      if (signal?.aborted) {
        reject(new Error('Operation aborted'));
        return;
      }
      resolve({ lines, truncated, exitCode: code, stderr: stderr.trim() });
    });
  });
}
