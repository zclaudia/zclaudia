import { spawn, type ChildProcess } from 'node:child_process';
import type { Options } from '@anthropic-ai/claude-agent-sdk';

/** Own only the CLI processes created for one query, including resumed runs. */
export function createClaudeProcessOwner() {
  const children = new Set<ChildProcess>();
  const spawnClaudeCodeProcess: NonNullable<Options['spawnClaudeCodeProcess']> = options => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      signal: options.signal,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    children.add(child);
    child.once('exit', () => children.delete(child));
    child.once('close', () => children.delete(child));
    return child;
  };

  return {
    spawnClaudeCodeProcess,
    kill() {
      for (const child of children) {
        // `killed` only means a signal was sent, not that SIGTERM succeeded.
        if (child.exitCode !== null || child.signalCode !== null) continue;
        try {
          child.kill('SIGKILL');
        } catch {
          // The child may have exited between the check and the signal.
        }
      }
    },
  };
}
